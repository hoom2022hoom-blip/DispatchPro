package com.maktab.calls

import android.content.Context
import android.content.Intent
import org.json.JSONObject
import java.util.concurrent.Executors

object NetworkSender {
    const val PREFS_NAME = "office_calls_settings"
    const val KEY_HOST = "windows_host"
    const val KEY_PORT = "windows_port"
    const val KEY_HTTP_HOST = "http_host"
    const val KEY_HTTP_PORT = "http_port"
    const val KEY_LEGACY_TCP = "legacy_tcp"
    const val AUTH_PREFS_NAME = "office_calls_auth"
    const val KEY_TOKEN = "bearer_token"
    const val DEFAULT_HOST = ""
    const val DEFAULT_OFFICE_HOST = ""
    const val DEFAULT_PORT = 5051
    const val ACTION_SEND_STATUS = "com.maktab.calls.SEND_STATUS"
    const val EXTRA_STATUS = "status"
    private val executor = Executors.newSingleThreadExecutor()
    internal var clock: () -> Long = System::currentTimeMillis
    internal var transport: (String,String,JSONObject?) -> JSONObject = OfficeHttpsTransport::request
    @Volatile var connectionStatus = "لم يتم اختبار الاتصال"
        private set

    fun sendTest(context: Context) {
        val app = context.applicationContext
        if(LocalReceiverTransport.enabled(app)) {
            connectionStatus="جارٍ فحص الاتصال المحلي المشفّر…";report(app,connectionStatus)
            executor.execute {
                val started=System.currentTimeMillis()
                val result=runCatching {LocalReceiverTransport.request(app)}
                val store=CallStore.get(app)
                val finished=System.currentTimeMillis()
                val serverTime=result.getOrNull()?.optLong("serverTime",0L) ?: 0L
                store.setState("local_clock_delta",if(serverTime>0) (serverTime-(started+(finished-started)/2)).toString() else "")
                store.setState("local_health_time",if(result.isSuccess) System.currentTimeMillis().toString() else "")
                store.setState("local_health_target",LocalReceiverTransport.endpoint(app))
                store.log(status=if(result.isSuccess) "LOCAL_HEALTH_PASS" else "LOCAL_HEALTH_FAILED",detail=result.exceptionOrNull()?.javaClass?.simpleName.orEmpty())
                connectionStatus=if(result.isSuccess) "الاتصال ناجح" else friendlyError(result.exceptionOrNull())
                report(app,connectionStatus)
                if(result.isSuccess) {
                    store.writableDatabase.execSQL("CREATE TABLE IF NOT EXISTS local_retry(id TEXT PRIMARY KEY, revision INTEGER, retries INTEGER DEFAULT 0, next_attempt INTEGER DEFAULT 0)")
                    store.writableDatabase.execSQL("UPDATE local_retry SET next_attempt=0")
                    resume(app)
                }
            };return
        }
        val request=transport
        connectionStatus = "جارٍ فحص HTTPS وصلاحية الجهاز…"
        report(app,connectionStatus)
        executor.execute {
            val store=CallStore.get(app)
            val result = runCatching {
                val token=DevicePairingManager.token(app)
                val response=request("/health",token,null)
                require(response.optBoolean("approved") && response.optString("officeId")==DevicePairingManager.office(app)) { "OFFICE_IDENTITY_MISMATCH" }
                store.setState("server_health_time",System.currentTimeMillis().toString())
                store.setState("server_health_office",DevicePairingManager.office(app))
                store.setState("pairing_state","مربوط ومصرح به")
                store.setState("agent_last_seen",response.optString("windowsAgentLastSeen").takeUnless {it=="null"}.orEmpty())
                store.setState("local_agent_keys",response.optJSONArray("localAgentKeys")?.toString() ?: "[]")
                store.setState("local_authorization_until",(System.currentTimeMillis()+5*60_000L).toString())
            }
            connectionStatus = if (result.isSuccess) "نجح فحص HTTPS وصلاحية الجهاز؛ لم تُرسل مكالمة" else "فشل الفحص: ${result.exceptionOrNull()?.message.orEmpty()}"
            if(result.isFailure) store.setState("server_health_time","")
            store.log(status=if(result.isSuccess) "HTTPS_HEALTH_PASS" else "HTTPS_HEALTH_FAILED",detail=result.exceptionOrNull()?.message.orEmpty())
            report(app,connectionStatus)
        }
    }
    fun pair(context: Context, qr: String, completed: ((Result<Unit>)->Unit)? = null) {
        val app=context.applicationContext
        connectionStatus="جارٍ الاتصال…";report(app,connectionStatus)
        executor.execute {
            val local=qr.trim().startsWith('{')
            val result=runCatching {if(local) LocalReceiverTransport.importPairing(app,qr) else {DevicePairingManager.complete(app,qr);app.getSharedPreferences(PREFS_NAME,0).edit().putString("delivery_mode","cloud").commit()};Unit}
            if(local) logPairing(app,result)
            connectionStatus=if(result.isSuccess) "تم الربط بنجاح" else friendlyError(result.exceptionOrNull())
            report(app,connectionStatus)
            completed?.let {callback->android.os.Handler(android.os.Looper.getMainLooper()).post {callback(result)}}
            if(result.isSuccess){sendTest(app);resume(app)}
        }
    }
    fun pairWithCode(context:Context,host:String,port:Int,code:String) {
        val app=context.applicationContext;connectionStatus="جارٍ ربط الكمبيوتر…";report(app,connectionStatus)
        executor.execute {
            val result=runCatching {LocalReceiverTransport.pairWithCode(app,host.trim(),port,code.trim())}
            connectionStatus=if(result.isSuccess) "تم حفظ الربط؛ جارٍ اختبار الاتصال" else friendlyError(result.exceptionOrNull())
            logPairing(app,result)
            report(app,connectionStatus);if(result.isSuccess){sendTest(app);resume(app)}
        }
    }
    private fun logPairing(context:Context,result:Result<*>) {
        val error=result.exceptionOrNull()
        val reason=error?.message.orEmpty().takeIf {it.matches(Regex("[A-Z_0-9]{1,64}"))} ?: error?.javaClass?.simpleName.orEmpty()
        val status=if(result.isSuccess) "LOCAL_PAIR_PASS" else "LOCAL_PAIR_FAILED"
        CallStore.get(context).log(status=status,detail=reason)
        android.util.Log.i("OfficeCalls", "$status $reason")
    }
    internal fun friendlyError(error:Throwable?):String {
        val message=error?.message.orEmpty()
        return when {
            message.contains("RECEIVER_UPDATE_REQUIRED")->"حدّث برنامج الكمبيوتر إلى الإصدار المتوافق ثم افتح رمزًا جديدًا."
            message.contains("PAIRING_EXPIRED")||message.contains("PAIRING_NOT_OPEN")||message.contains("LOCAL_HTTP_410")->"انتهت صلاحية رمز الاقتران أو استُبدل. افتح رمزًا جديدًا على الكمبيوتر ثم أعد المسح."
            message.contains("INVALID_PAIRING_QR")->"هذا ليس رمز اقتران OfficeCalls صالحًا. افتح رمز البرنامج على الكمبيوتر."
            message.contains("PAIRING_REQUIRED")->"تعذر الاتصال: افتح إعداد الاتصال وامسح رمز الكمبيوتر."
            message.contains("INVALID_LOCAL_ADDRESS")->"تحقق من عنوان الكمبيوتر والمنفذ؛ يجب أن يكون الهاتف والكمبيوتر على الشبكة نفسها."
            message.contains("INVALID_PAIRING_CODE")||error is javax.crypto.AEADBadTagException ->"تعذر الربط: تحقق من رمز الاقتران الظاهر على الكمبيوتر."
            error is javax.net.ssl.SSLException||message.contains("CERTIFICATE")||message.contains("MISMATCH")->"تعذر التحقق من هوية الكمبيوتر. افتح رمز اقتران جديدًا من البرنامج المعتمد."
            message.contains("LOCAL_HTTP_403")->"تعذر الاتصال: أعد الاقتران بهذا الكمبيوتر."
            else->"تعذر الاتصال: تحقق من تشغيل برنامج المكتب وعنوانه والشبكة والجدار الناري."
        }
    }
    internal class Cancellation { @Volatile var cancelled = false }
    fun flush(context: Context, completed: (Boolean) -> Unit = {}) = flushCancellable(context,Cancellation(),completed)
    internal fun flushCancellable(context: Context, cancellation: Cancellation, completed: (Boolean) -> Unit = {}) {
        val app = context.applicationContext
        val request=transport
        val now=clock
        executor.execute {
            val store = CallStore.get(app)
            store.resolvePendingContacts()
            if(LocalReceiverTransport.enabled(app)) {
                try {flushLocal(app,store,cancellation)} finally {completed(store.pending().isNotEmpty())}
                return@execute
            }
            try {
                val queue=ReliableDeliveryQueue(app,now)
                queue.prune()
                val token=DevicePairingManager.token(app)
                for ((id, body) in store.pending().sortedByDescending { JSONObject(it.second).optLong("timestamp") }) {
                    if(cancellation.cancelled) break
                    val payload=JSONObject(body);val pkg=payload.optString("package");val number=payload.optString("number")
                    val timestamp=payload.optLong("timestamp")
                    // The existing cloud contract requires a confirmed number. Keep unknown
                    // calls durably for the local receiver instead of posting PHONE_INVALID forever.
                    if(number.isBlank()) {
                        if(store.state("unknown_cloud_event")!=id) {
                            store.setState("unknown_cloud_event",id)
                            store.log(pkg,status="LOCAL_RECEIVER_REQUIRED",detail="eventId=$id; unknown number retained; cloud contract requires phone")
                        }
                        connectionStatus="مكالمة بلا رقم محفوظة؛ اربط برنامج الكمبيوتر المحلي لإرسالها"
                        report(app,connectionStatus);continue
                    }
                    if(!queue.due(id,timestamp)) continue
                    if(now()-timestamp>24L*60*60*1000) {queue.expire(id,pkg,number);continue}
                    if(payload.optString("officeId").isNotBlank() && payload.optString("officeId")!=DevicePairingManager.office(app)) {
                        queue.failure(id,"QUEUED_EVENT_OFFICE_MISMATCH");continue
                    }
                    if(token!=DevicePairingManager.token(app)) {queue.failure(id,"PAIRING_CHANGED_DURING_SEND");continue}
                    try {
                        store.sending(id,pkg,number)
                        val response=request("/events",token,OfficeHttpsTransport.payload(payload))
                        store.log(pkg,number,"HTTPS_SENT","eventId=$id")
                        queue.acknowledged(id,response)
                        store.ack(id,pkg,number,OfficeHttpsTransport.BASE,body)
                        store.setState("last_ack_office",DevicePairingManager.office(app))
                        BackgroundRuntime.delivered(app,id,OfficeHttpsTransport.BASE)
                        connectionStatus="الخادم أكد الحفظ؛ DispatchPro=${response.optString("dispatchPro")}; GRIDCMS=${response.optString("gridCms")}"
                        report(app,connectionStatus)
                    } catch(error: Exception) {
                        runCatching {NetworkConnectionManager.fallback(app,OfficeHttpsTransport.payload(payload))}.getOrNull()?.let { local ->
                            store.log(pkg,number,"LOCAL_RECEIVER_ACK","eventId=$id; grid=${local.optString("gridCms")}; serverAck=false; HTTPS event retained")
                            store.setState("grid_delivery",local.optString("gridCms"))
                        }
                        queue.failure(id,error.message ?: error.javaClass.simpleName)
                        connectionStatus="الإرسال محفوظ لإعادة المحاولة: ${error.message.orEmpty()}"
                        report(app,connectionStatus)
                    }
                }
                for(id in queue.awaiting().take(3)) {
                    if(cancellation.cancelled || store.pending().isNotEmpty()) break
                    runCatching {queue.update(id,request("/events/$id",token,null))}
                }
            } finally { completed(store.pending().isNotEmpty() || ReliableDeliveryQueue(app).awaiting().isNotEmpty()) }
        }
    }
    internal var localRequest: (Context,JSONObject?) -> JSONObject = LocalReceiverTransport::request
    private fun flushLocal(app: Context, store: CallStore, cancellation: Cancellation) {
        store.pruneHistory()
        val db=store.writableDatabase
        db.execSQL("CREATE TABLE IF NOT EXISTS local_retry(id TEXT PRIMARY KEY, revision INTEGER, retries INTEGER DEFAULT 0, next_attempt INTEGER DEFAULT 0)")
        for((id,body) in store.pending()) {
            if(cancellation.cancelled) break
            val payload=JSONObject(body);val revision=payload.optInt("revision",1)
            val row=db.rawQuery("SELECT revision,retries,next_attempt FROM local_retry WHERE id=?",arrayOf(id)).use {if(it.moveToFirst()) Triple(it.getInt(0),it.getInt(1),it.getLong(2)) else null}
            if(row?.first==revision && row.third>clock())continue
            try {
                store.sending(id,payload.optString("package"),payload.optString("number"))
                val response=localRequest(app,payload)
                require(response.optBoolean("receiverAcknowledged") && response.optString("eventId")==id && response.optInt("revision")==revision) {"INVALID_LOCAL_ACK"}
                store.ack(id,payload.optString("package"),payload.optString("number"),LocalReceiverTransport.endpoint(app),body)
                db.execSQL("DELETE FROM local_retry WHERE id=? AND revision=?",arrayOf(id,revision))
                store.setState("grid_delivery",response.optString("gridCms"));store.setState("last_error","")
                store.setState("local_health_time",clock().toString());store.setState("local_health_target",LocalReceiverTransport.endpoint(app))
                BackgroundRuntime.delivered(app,id,LocalReceiverTransport.endpoint(app))
                connectionStatus="الاتصال ناجح — حُفظت المكالمة على الكمبيوتر"
                report(app,connectionStatus)
            } catch(error: Exception) {
                val retries=if(row?.first==revision) row.second+1 else 1
                val delay=(1000L shl retries.coerceAtMost(5)).coerceAtMost(30000L)
                db.execSQL("INSERT OR REPLACE INTO local_retry VALUES(?,?,?,?)",arrayOf(id,revision,retries,clock()+delay))
                store.log(status="LOCAL_SEND_FAILED",detail="eventId=$id; revision=$revision; error=${error.javaClass.simpleName}; retryMs=$delay")
                store.setState("last_error","LOCAL_SEND_FAILED; eventId=$id")
                store.setState("local_health_time","")
                connectionStatus="غير متصل — المكالمات محفوظة لإعادة الإرسال";report(app,connectionStatus)
                break // One unavailable receiver never costs a timeout for every queued call.
            }
        }
    }
    fun resume(context: Context) {
        RetryJobService.schedule(context)
        flush(context)
    }
    private fun report(context: Context, message: String) {
        context.sendBroadcast(Intent(ACTION_SEND_STATUS).setPackage(context.packageName).putExtra(EXTRA_STATUS, message))
    }
}
