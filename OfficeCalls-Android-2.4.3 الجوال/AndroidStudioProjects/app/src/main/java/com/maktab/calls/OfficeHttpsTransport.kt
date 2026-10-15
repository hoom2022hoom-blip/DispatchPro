package com.maktab.calls

import org.json.JSONObject
import java.net.URL
import javax.net.ssl.HttpsURLConnection

internal object OfficeHttpsTransport {
    const val BASE = "https://api.nablustaxi.com/api/v1/officecalls"
    class HttpFailure(val code: Int, val reason: String = "") : java.io.IOException("HTTPS HTTP $code" + if(reason.isNotBlank()) "; $reason" else "")
    fun request(path: String, token: String, body: JSONObject? = null): JSONObject {
        if(path!="/pair/complete") require(token.isNotBlank()) {"DEVICE_NOT_PAIRED"}
        require(path.startsWith('/') && !path.contains("..") && !path.contains('?'))
        val connection = URL(BASE + path).openConnection() as HttpsURLConnection
        // Platform CA trust and hostname verification are never replaced.
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 5000; connection.readTimeout = 10000
            connection.requestMethod = if (body == null) "GET" else "POST"
            if (token.isNotBlank()) {
                require(Regex("oc3_[A-F0-9]{64}").matches(token))
                connection.setRequestProperty("Authorization", "Bearer $token")
            }
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                val bytes = body.toString().toByteArray(Charsets.UTF_8)
                connection.setFixedLengthStreamingMode(bytes.size)
                connection.outputStream.use { it.write(bytes) }
            }
            if (connection.responseCode !in 200..299) {
                // Record a bounded machine code, never an HTML error page, phone or token.
                val reason = runCatching {connection.errorStream?.use {JSONObject(String(it.readBytesLimited(4096),Charsets.UTF_8)).optString("code")}.orEmpty()}
                    .getOrDefault("").takeIf {Regex("[A-Z0-9_]{1,80}").matches(it)}.orEmpty()
                throw HttpFailure(connection.responseCode,reason)
            }
            val response = connection.inputStream.use { input ->
                val bytes = input.readBytesLimited(16384)
                String(bytes, Charsets.UTF_8)
            }
            return JSONObject(response)
        } finally { connection.disconnect() }
    }
    private fun java.io.InputStream.readBytesLimited(limit: Int): ByteArray {
        val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(2048)
        while (true) { val count = read(buffer); if (count < 0) break; require(output.size() + count <= limit); output.write(buffer, 0, count) }
        return output.toByteArray()
    }
    fun payload(body: JSONObject): JSONObject {
        val timestamp = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
        return JSONObject().put("eventId", body.getString("eventId")).put("phone", body.optString("phoneE164").ifBlank {body.optString("phoneIdentity").ifBlank {body.getString("number")}})
            .put("sourcePackage", body.getString("package")).put("timestamp", timestamp.format(java.util.Date(body.getLong("timestamp"))))
    }
}
