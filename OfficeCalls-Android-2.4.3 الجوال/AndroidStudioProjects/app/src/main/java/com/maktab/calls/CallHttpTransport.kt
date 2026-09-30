package com.maktab.calls

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

internal data class CallHttpPayload(val eventId: String, val phone: String, val timestamp: Long) {
    init {
        require(Regex("[A-Za-z0-9._:-]{1,160}").matches(eventId)) { "Invalid eventId" }
        require(Regex("[+0-9][0-9 ()-]{0,39}").matches(phone) && phone.count(Char::isDigit) >= 7) { "Phone number required; contact names are never sent" }
    }

    fun json(): String {
        val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        format.timeZone = TimeZone.getTimeZone("UTC")
        // All interpolated strings are restricted above to characters that need no JSON escaping.
        return """{"eventId":"$eventId","source":"WHATSAPP","phone":"$phone","timestamp":"${format.format(Date(timestamp))}"}"""
    }
}

internal object CallHttpTransport {
    fun endpoint(host: String, port: Int): URL {
        val octets = host.split('.').map { it.toIntOrNull() }
        require(octets.size == 4 && octets.all { it != null && it in 0..255 }) { "Enter the computer LAN IPv4 address" }
        require(octets[0] == 10 || (octets[0] == 192 && octets[1] == 168) || (octets[0] == 172 && octets[1]!! in 16..31)) { "Only private LAN addresses are supported" }
        require(port in 1..65535) { "Invalid port" }
        return URL("http://$host:$port/api/calls")
    }

    fun post(url: URL, token: String, payload: String) {
        require(token.length >= 32 && token.none { it == '\r' || it == '\n' }) { "Bearer token is missing or invalid" }
        val connection = url.openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 4000
            connection.readTimeout = 20000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.setRequestProperty("Authorization", "Bearer $token")
            val bytes = payload.toByteArray(Charsets.UTF_8)
            connection.setFixedLengthStreamingMode(bytes.size)
            connection.outputStream.use { it.write(bytes) }
            val status = connection.responseCode
            if (status != 200 && status != 201) throw IOException("Office endpoint HTTP $status")
            connection.inputStream.use { it.readBytes() }
        } finally {
            connection.disconnect()
        }
    }
}
