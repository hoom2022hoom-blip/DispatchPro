package com.maktab.calls

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.SystemClock
import android.util.Size
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.*
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size as ComposeSize
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.google.zxing.*
import com.google.zxing.common.HybridBinarizer
import org.json.JSONObject
import java.nio.ByteBuffer
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

internal object LiveQrDecoder {
    fun luminance(buffer:ByteBuffer,width:Int,height:Int,rowStride:Int,pixelStride:Int):ByteArray {
        require(width in 1..4096 && height in 1..4096 && pixelStride>0 && rowStride>0)
        require(rowStride.toLong()>=(width-1L)*pixelStride+1)
        require(buffer.remaining().toLong()>=(height-1L)*rowStride+(width-1L)*pixelStride+1)
        val origin=buffer.position();val data=ByteArray(width*height)
        for(y in 0 until height) for(x in 0 until width) data[y*width+x]=buffer.get(origin+y*rowStride+x*pixelStride)
        return data
    }
    fun decode(data:ByteArray,width:Int,height:Int):String? {
        val source=PlanarYUVLuminanceSource(data,width,height,0,0,width,height,false)
        for(luma in listOf(source,source.invert())) {
            try {return com.google.zxing.qrcode.QRCodeReader().decode(BinaryBitmap(HybridBinarizer(luma)),mapOf(DecodeHintType.TRY_HARDER to true)).text}
            catch(_:ReaderException) { /* A frame without a readable QR is normal. */ }
        }
        return null
    }
}

internal object LivePairingPayload {
    fun validate(text:String):String {
        val value=text.trim();require(value.length in 1..8192) {"INVALID_PAIRING_QR"}
        if(value.startsWith('{')) {
            val j=JSONObject(value)
            require(j.optString("type")=="officecalls-local-v1" && LocalReceiverTransport.validHost(j.optString("host")) && j.optInt("port") in 1..65535 &&
                j.optString("token").matches(Regex("[a-f0-9]{64}")) && j.optString("pin").matches(Regex("[a-f0-9]{64}"))) {"INVALID_PAIRING_QR"}
            LocalReceiverTransport.validatePairingWindow(j,System.currentTimeMillis())
        } else {
            val uri=android.net.Uri.parse(value)
            require(uri.scheme=="officecalls" && uri.host=="pair" &&
                runCatching {java.util.UUID.fromString(uri.getQueryParameter("sessionId"))}.isSuccess &&
                uri.getQueryParameter("secret").orEmpty().matches(Regex("[A-Fa-f0-9]{64}"))) {"INVALID_PAIRING_QR"}
        }
        return value
    }
}

internal class LiveQrGate {
    private val consumed=AtomicBoolean(false)
    fun acquire()=consumed.compareAndSet(false,true)
    fun reset(){consumed.set(false)}
}

internal class LiveQrState:ViewModel() {
    enum class Phase { SCANNING, CONNECTING, SUCCESS, ERROR }
    var phase by mutableStateOf(Phase.SCANNING);private set
    var message by mutableStateOf("وجّه الكاميرا إلى QR داخل الإطار");private set
    private val gate=LiveQrGate()
    private var active=true
    fun candidate(context:Context,text:String) {
        if(!gate.acquire())return
        val validated=runCatching {LivePairingPayload.validate(text)}
        if(validated.isFailure){failure(context,validated.exceptionOrNull());return}
        liveQrLog(context,"LIVE_QR_READ_PASS")
        phase=Phase.CONNECTING;message="جارٍ الاتصال…"
        NetworkSender.pair(context,validated.getOrThrow()) {result->
            if(active) {
                phase=if(result.isSuccess)Phase.SUCCESS else Phase.ERROR
                message=if(result.isSuccess)"تم الربط بنجاح" else NetworkSender.friendlyError(result.exceptionOrNull())
                liveQrLog(context,if(result.isSuccess)"LIVE_QR_PAIR_PASS" else "LIVE_QR_PAIR_FAILED",result.exceptionOrNull()?.javaClass?.simpleName.orEmpty())
            }
        }
    }
    fun failure(context:Context,error:Throwable?) {
        phase=Phase.ERROR
        message=if(error is SecurityException)"اسمح للتطبيق باستخدام الكاميرا لقراءة QR." else if(error?.message?.contains("PAIRING")==true)NetworkSender.friendlyError(error) else "تعذر فتح الكاميرا أو قراءة الرمز. أعد المحاولة أو استخدم الاقتران اليدوي."
        liveQrLog(context,"LIVE_QR_FAILED",error?.javaClass?.simpleName.orEmpty())
    }
    fun retry(){gate.reset();phase=Phase.SCANNING;message="وجّه الكاميرا إلى QR داخل الإطار"}
    override fun onCleared(){active=false}
}

internal fun liveQrLog(context:Context,status:String,detail:String="") {
    android.util.Log.i("OfficeCalls","$status $detail")
    CallStore.get(context).log(status=status,detail=detail)
}

class LiveQrActivity:ComponentActivity() {
    override fun onCreate(savedInstanceState:Bundle?) {
        super.onCreate(savedInstanceState)
        val state=ViewModelProvider(this)[LiveQrState::class.java]
        liveQrLog(this,"LIVE_QR_OPEN")
        setContent {
            MaterialTheme(colorScheme=if(isSystemInDarkTheme())darkColorScheme() else lightColorScheme()) {
                CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) { ScannerContent(this,state) }
            }
        }
    }
}

@Composable
private fun ScannerContent(activity:LiveQrActivity,state:LiveQrState) {
    var permitted by remember {mutableStateOf(ContextCompat.checkSelfPermission(activity,Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED)}
    val permission=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {granted->
        permitted=granted
        liveQrLog(activity,if(granted)"LIVE_QR_PERMISSION_GRANTED" else "LIVE_QR_PERMISSION_DENIED")
        if(granted)state.retry() else state.failure(activity,SecurityException())
    }
    LaunchedEffect(Unit){if(!permitted)permission.launch(Manifest.permission.CAMERA)}
    val scanning=permitted && state.phase==LiveQrState.Phase.SCANNING
    DisposableEffect(scanning) {
        if(scanning)activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onDispose {activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)}
    }
    Surface(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(16.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.SpaceBetween) {
                Text("مسح رمز الكمبيوتر",style=MaterialTheme.typography.titleLarge,modifier=Modifier.weight(1f))
                TextButton({activity.finish()},Modifier.heightIn(min=48.dp)){Text("إغلاق")}
            }
            Box(Modifier.weight(1f).fillMaxWidth(),contentAlignment=Alignment.Center) {
                if(scanning)CameraPreview(activity,{state.candidate(activity,it)},{state.failure(activity,it)})
                else if(state.phase==LiveQrState.Phase.CONNECTING)CircularProgressIndicator()
                else Text(if(state.phase==LiveQrState.Phase.SUCCESS)"تم الربط بنجاح" else "الكاميرا متوقفة",style=MaterialTheme.typography.titleLarge)
            }
            Text(state.message,Modifier.fillMaxWidth().semantics {liveRegion=LiveRegionMode.Polite},color=if(state.phase==LiveQrState.Phase.ERROR)MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
            when(state.phase) {
                LiveQrState.Phase.SCANNING->Text("تتم القراءة والاتصال تلقائيًا. قرّب الرمز وتجنب انعكاس الشاشة.")
                LiveQrState.Phase.ERROR->Button({if(permitted)state.retry() else permission.launch(Manifest.permission.CAMERA)},Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(if(permitted)"مسح رمز جديد" else "السماح بالكاميرا")}
                LiveQrState.Phase.SUCCESS->Button({activity.finish()},Modifier.fillMaxWidth().heightIn(min=48.dp)){Text("العودة إلى إعداد الاتصال")}
                else->Text("يُتحقق من صلاحية الرمز وهوية الكمبيوتر قبل حفظ الربط.")
            }
        }
    }
}

@Composable
private fun CameraPreview(activity:LiveQrActivity,onCode:(String)->Unit,onError:(Throwable)->Unit) {
    val view=remember {PreviewView(activity).apply {implementationMode=PreviewView.ImplementationMode.COMPATIBLE;scaleType=PreviewView.ScaleType.FIT_CENTER}}
    val code=rememberUpdatedState(onCode);val error=rememberUpdatedState(onError)
    DisposableEffect(activity,view) {
        val disposed=AtomicBoolean(false);val detected=AtomicBoolean(false)
        val executor=Executors.newSingleThreadExecutor();val main=ContextCompat.getMainExecutor(activity)
        val preview=Preview.Builder().build().apply {surfaceProvider=view.surfaceProvider}
        val analysis=ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setResolutionSelector(ResolutionSelector.Builder().setResolutionStrategy(ResolutionStrategy(Size(1280,960),ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER)).build()).build()
        var last=0L;var first=true
        analysis.setAnalyzer(executor) {frame->
            try {
                if(disposed.get() || detected.get())return@setAnalyzer
                val now=SystemClock.elapsedRealtime();if(now-last<125)return@setAnalyzer;last=now
                if(first){first=false;liveQrLog(activity,"LIVE_QR_FRAME_READY","${frame.width}x${frame.height}")}
                val plane=frame.planes[0]
                val data=LiveQrDecoder.luminance(plane.buffer,frame.width,frame.height,plane.rowStride,plane.pixelStride)
                val text=LiveQrDecoder.decode(data,frame.width,frame.height)
                if(text!=null && detected.compareAndSet(false,true))main.execute {if(!disposed.get())code.value(text)}
            } catch(e:Exception) {
                if(detected.compareAndSet(false,true))main.execute {if(!disposed.get())error.value(e)}
            } finally {frame.close()}
        }
        var provider:ProcessCameraProvider?=null
        val future=ProcessCameraProvider.getInstance(activity.applicationContext)
        future.addListener({
            if(!disposed.get())try {
                provider=future.get()
                provider!!.bindToLifecycle(activity,CameraSelector.DEFAULT_BACK_CAMERA,preview,analysis)
                liveQrLog(activity,"LIVE_QR_CAMERA_BOUND")
            }catch(e:Exception){error.value(e)}
        },main)
        onDispose {
            disposed.set(true);analysis.clearAnalyzer();provider?.unbind(preview,analysis);executor.shutdown()
            liveQrLog(activity,"LIVE_QR_CAMERA_STOPPED")
        }
    }
    Box(Modifier.fillMaxSize()) {
        AndroidView(factory={view},modifier=Modifier.fillMaxSize())
        Canvas(Modifier.fillMaxSize()) {
            val side=minOf(size.width,size.height)*0.78f;val x=(size.width-side)/2;val y=(size.height-side)/2
            val path=Path().apply {fillType=PathFillType.EvenOdd;addRect(Rect(Offset.Zero,size));addRect(Rect(x,y,x+side,y+side))}
            drawPath(path,Color.Black.copy(alpha=0.45f))
            drawRect(Color.Black,Offset(x,y),ComposeSize(side,side),style=Stroke(6.dp.toPx()))
            drawRect(Color.White,Offset(x,y),ComposeSize(side,side),style=Stroke(3.dp.toPx()))
        }
    }
}
