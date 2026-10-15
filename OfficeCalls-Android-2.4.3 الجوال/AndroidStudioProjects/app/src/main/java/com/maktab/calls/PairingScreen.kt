package com.maktab.calls

import android.content.Context
import android.graphics.Bitmap
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.google.zxing.*
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.common.GlobalHistogramBinarizer

internal object PairingQrDecoder {
    private const val MAX_SIZE=2048
    fun photo(open:()->java.io.InputStream?):Bitmap {
        val bounds=android.graphics.BitmapFactory.Options().apply {inJustDecodeBounds=true}
        open().use {android.graphics.BitmapFactory.decodeStream(it,null,bounds)}
        require(bounds.outWidth>0 && bounds.outHeight>0)
        val options=android.graphics.BitmapFactory.Options().apply {inSampleSize=1}
        while(maxOf(bounds.outWidth,bounds.outHeight)/options.inSampleSize>MAX_SIZE)options.inSampleSize*=2
        return requireNotNull(open().use {android.graphics.BitmapFactory.decodeStream(it,null,options)})
    }
    fun decode(bitmap: Bitmap): String {
        val ratio=minOf(1.0,MAX_SIZE.toDouble()/maxOf(bitmap.width,bitmap.height))
        val scaled=if(ratio<1.0) Bitmap.createScaledBitmap(bitmap,(bitmap.width*ratio).toInt().coerceAtLeast(1),(bitmap.height*ratio).toInt().coerceAtLeast(1),true) else bitmap
        try {
            val pixels=IntArray(scaled.width*scaled.height);scaled.getPixels(pixels,0,scaled.width,0,0,scaled.width,scaled.height)
            val luminance=RGBLuminanceSource(scaled.width,scaled.height,pixels)
            val hints=mapOf(DecodeHintType.TRY_HARDER to true)
            for(source in listOf(luminance,luminance.invert())) for(global in listOf(false,true)) {
                try {return com.google.zxing.qrcode.QRCodeReader().decode(BinaryBitmap(if(global) GlobalHistogramBinarizer(source) else HybridBinarizer(source)),hints).text}
                catch(_:ReaderException) { /* Try the next bounded contrast strategy. */ }
            }
            throw NotFoundException.getNotFoundInstance()
        } finally {if(scaled!==bitmap)scaled.recycle()}
    }
}
@Composable
internal fun PairingScreen(context: Context) {
    var qr by remember {mutableStateOf("")};var error by remember {mutableStateOf("")}
    fun log(status:String,detail:String="") {
        CallStore.get(context).log(status=status,detail=detail)
        android.util.Log.i("OfficeCalls","$status $detail")
    }
    fun decode(bitmap: Bitmap?) {
        val result=runCatching {requireNotNull(bitmap);PairingQrDecoder.decode(bitmap)}
        if(result.isSuccess){qr=result.getOrThrow();error="";log("QR_READ_PASS");NetworkSender.pair(context,qr)}
        else {log("QR_READ_FAILED",result.exceptionOrNull()?.javaClass?.simpleName.orEmpty());error="لم يُعثر على QR واضح في الصورة. قرّب الرمز ليملأ معظم الصورة، وتجنب انعكاس الشاشة، ثم التقط الصورة وأكدها بعلامة ✓."}
    }
    val camera=rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {}
    val image=rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) {uri->
        if(uri!=null) runCatching {PairingQrDecoder.photo {context.contentResolver.openInputStream(uri)}}.onSuccess {bitmap->log("QR_IMAGE_LOADED","${bitmap.width}x${bitmap.height}");try{decode(bitmap)}finally{bitmap.recycle()}}.onFailure {log("QR_IMAGE_FAILED",it.javaClass.simpleName);error="تعذر فتح الصورة المختارة؛ اختر صورة QR واضحة."}
    }
    Text("اربط الجهاز بالمكتب",style=MaterialTheme.typography.titleLarge)
    Text("على الكمبيوتر افتح «اقتران هاتف»، ثم امسح الرمز الظاهر. يُحفظ الاتصال الآمن تلقائيًا. أبقِ الهاتف والكمبيوتر على الشبكة نفسها.")
    Text("وجّه الكاميرا إلى رمز الكمبيوتر؛ تتم القراءة والاتصال تلقائيًا دون تصوير.")
    Button({error="";runCatching {camera.launch(android.content.Intent(context,LiveQrActivity::class.java))}.onFailure {log("LIVE_QR_CAMERA_UNAVAILABLE",it.javaClass.simpleName);error="تعذر فتح الماسح؛ اختر صورة الرمز أو استخدم رمز الاقتران."}},Modifier.fillMaxWidth().heightIn(min=48.dp)){Text("مسح رمز الكمبيوتر")}
    OutlinedButton({image.launch("image/*")},Modifier.fillMaxWidth().heightIn(min=48.dp)){Text("قراءة صورة QR")}
    var manual by remember {mutableStateOf(false)}
    OutlinedButton({manual=!manual},Modifier.fillMaxWidth().heightIn(min=48.dp)){Text("استخدام رمز اقتران بدل الكاميرا")}
    if(manual){
        val prefs=remember {context.getSharedPreferences(NetworkSender.PREFS_NAME,0)}
        var host by remember {mutableStateOf(prefs.getString(NetworkSender.KEY_HOST,"").orEmpty())}
        var port by remember {mutableStateOf("5051")};var code by remember {mutableStateOf("")}
        OutlinedTextField(host,{host=it},label={Text("عنوان الكمبيوتر")},singleLine=true,modifier=Modifier.fillMaxWidth())
        OutlinedTextField(port,{port=it},label={Text("المنفذ الظاهر على الكمبيوتر")},singleLine=true,modifier=Modifier.fillMaxWidth())
        OutlinedTextField(code,{code=it},label={Text("رمز الاقتران الظاهر على الكمبيوتر")},singleLine=true,modifier=Modifier.fillMaxWidth())
        Button({NetworkSender.pairWithCode(context,host,port.toIntOrNull()?:0,code)},Modifier.fillMaxWidth().heightIn(min=48.dp)){Text("ربط الكمبيوتر")}
    }
    if(error.isNotBlank()) Text(error,color=MaterialTheme.colorScheme.error)
}
