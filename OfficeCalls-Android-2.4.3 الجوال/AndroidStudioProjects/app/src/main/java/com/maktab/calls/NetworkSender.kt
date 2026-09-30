package com.maktab.calls

import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.Executors
import java.util.UUID

object NetworkSender {
    const val PREFS_NAME = "office_calls_settings"
    const val KEY_HOST = "windows_host"
    const val KEY_PORT = "windows_port"
    const val KEY_HTTP_HOST = "http_host"
    const val KEY_HTTP_PORT = "http_port"
    const val KEY_LEGACY_TCP = "legacy_tcp"
    const val AUTH_PREFS_NAME = "office_calls_auth"
    const val KEY_TOKEN = "bearer_token"
    const val DEFAULT_HOST = "192.168.0.104"
    const val DEFAULT_PORT = 9006
    const val ACTION_SEND_STATUS = "com.maktab.calls.SEND_STATUS"
    const val EXTRA_STATUS = "status"
    private const val TAG = "MaktabCalls"
    private val executor = Executors.newFixedThreadPool(4)

    fun sendTest(context: Context) {
        if (!usesLegacyTcp(context)) {
            sendHttp(context, UUID.randomUUID().toString(), "0599000000", System.currentTimeMillis())
            return
        }
        send(context, JSONObject().apply {
        put("eventId", UUID.randomUUID().toString())
        put("type", "test")
        put("caller", "0599000000")
        put("number", "0599000000")
        put("displayName", "اختبار الاتصال")
        put("timestamp", System.currentTimeMillis())
        put("device", "${Build.MANUFACTURER} ${Build.MODEL}")
        })
    }

    fun sendCall(context: Context, eventId: String, caller: String, number: String, displayName: String, packageName: String, timestamp: Long) {
        if (!usesLegacyTcp(context)) {
            sendHttp(context, eventId, number, timestamp)
            return
        }
        send(context, JSONObject().apply {
            put("eventId", eventId)
            put("type", "incoming_call")
            put("caller", caller)
            put("number", number)
            put("displayName", displayName)
            put("package", packageName)
            put("timestamp", timestamp)
            put("device", "${Build.MANUFACTURER} ${Build.MODEL}")
        })
    }

    private fun usesLegacyTcp(context: Context) = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getBoolean(KEY_LEGACY_TCP, false)

    private fun sendHttp(context: Context, eventId: String, number: String, timestamp: Long) {
        val appContext = context.applicationContext
        val prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val token = appContext.getSharedPreferences(AUTH_PREFS_NAME, Context.MODE_PRIVATE).getString(KEY_TOKEN, "").orEmpty().trim()
        val url: java.net.URL
        val body: String
        try {
            url = CallHttpTransport.endpoint(prefs.getString(KEY_HTTP_HOST, DEFAULT_HOST).orEmpty().trim(), prefs.getInt(KEY_HTTP_PORT, DEFAULT_PORT))
            require(token.length >= 32 && token.none { it == '\r' || it == '\n' })
            body = CallHttpPayload(eventId, number, timestamp).json()
        } catch (error: IllegalArgumentException) {
            report(appContext, "تحقق من عنوان الكمبيوتر ورمز Bearer ورقم المتصل")
            return
        }
        executor.execute {
            repeat(3) { attempt ->
                try {
                    // Serialize once: all retries keep exactly the same eventId, phone and timestamp.
                    CallHttpTransport.post(url, token, body)
                    report(appContext, "تم تسجيل المكالمة في لوحة المكتب ✓")
                    return@execute
                } catch (error: Exception) {
                    Log.w(TAG, "HTTP send attempt ${attempt + 1} failed", error)
                    if (attempt < 2) Thread.sleep(500)
                    else report(appContext, "تعذر إرسال المكالمة: ${error.message}. تحقق من الشبكة ورمز Bearer")
                }
            }
        }
    }

    private fun send(context: Context, payload: JSONObject) {
        val appContext = context.applicationContext
        val prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val host = prefs.getString(KEY_HOST, "")?.trim().orEmpty()
        val port = prefs.getInt(KEY_PORT, 5050)
        if (host.isBlank()) {
            report(appContext, "لم يتم ضبط عنوان IP للكمبيوتر")
            return
        }
        executor.execute {
            var lastError: Exception? = null
            val eventId = payload.optString("eventId")
            repeat(3) { attempt ->
                try {
                    Socket().use { socket ->
                        socket.connect(InetSocketAddress(host, port), 1200)
                        socket.soTimeout = 1600
                        val writer = OutputStreamWriter(socket.getOutputStream(), Charsets.UTF_8)
                        writer.write(payload.toString())
                        writer.write("\n")
                        writer.flush()
                        val acknowledgement = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.UTF_8)).readLine().orEmpty()
                        if (acknowledgement != "OK $eventId") throw IllegalStateException("Invalid receiver acknowledgement")
                    }
                    report(appContext, "تم الاتصال بالكمبيوتر بنجاح ✓")
                    return@execute
                } catch (error: Exception) {
                    lastError = error
                    Log.w(TAG, "Send attempt ${attempt + 1} failed", error)
                    if (attempt < 2) Thread.sleep(250)
                }
            }
            Log.e(TAG, "Could not send to Windows after retries", lastError)
            report(appContext, "فشل الاتصال بالكمبيوتر بعد 3 محاولات: تحقق من IP والشبكة وبرنامج الاستقبال")
        }
    }

    private fun report(context: Context, message: String) {
        context.sendBroadcast(Intent(ACTION_SEND_STATUS).apply {
            setPackage(context.packageName)
            putExtra(EXTRA_STATUS, message)
        })
    }
}
