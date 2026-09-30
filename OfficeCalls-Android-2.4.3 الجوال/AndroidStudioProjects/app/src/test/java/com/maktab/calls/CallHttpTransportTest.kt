package com.maktab.calls

import org.junit.Assert.*
import org.junit.Test
import java.net.ServerSocket
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class CallHttpTransportTest {
    @Test fun payloadContainsOnlyRawPhoneAndStableCallFields() {
        val payload = CallHttpPayload("call-123", "+970599123456", 0L)
        assertEquals("""{"eventId":"call-123","source":"WHATSAPP","phone":"+970599123456","timestamp":"1970-01-01T00:00:00.000Z"}""", payload.json())
        assertEquals(payload.json(), payload.json())
        assertFalse(payload.json().contains("displayName"))
        assertFalse(payload.json().contains("caller"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun contactNameCannotBeSentAsPhone() { CallHttpPayload("call-1", "إبراهيم", 0L) }

    @Test(expected = IllegalArgumentException::class)
    fun publicHostRejected() { CallHttpTransport.endpoint("8.8.8.8", 9006) }

    @Test fun officeEndpointIsCorrect() {
        assertEquals("http://192.168.0.104:9006/api/calls", CallHttpTransport.endpoint("192.168.0.104", 9006).toString())
    }

    @Test fun httpCarriesBearerAndSamePayloadOnReplay() {
        val server = ServerSocket(0)
        server.soTimeout = 10000
        val executor = Executors.newSingleThreadExecutor()
        val token = "test-token-" + "x".repeat(32)
        val payload = CallHttpPayload("retry-1", "0599123456", 0L).json()
        val received = executor.submit<List<String>> {
            (0..1).map { index ->
                server.accept().use { socket ->
                    socket.soTimeout = 10000
                    val reader = socket.getInputStream().bufferedReader(Charsets.UTF_8)
                    assertEquals("POST /api/calls HTTP/1.1", reader.readLine())
                    val headers = mutableMapOf<String, String>()
                    while (true) {
                        val line = reader.readLine() ?: error("Missing headers")
                        if (line.isEmpty()) break
                        headers[line.substringBefore(':').lowercase()] = line.substringAfter(':').trim()
                    }
                    assertEquals("Bearer $token", headers["authorization"])
                    assertTrue(headers["content-type"].orEmpty().startsWith("application/json"))
                    val chars = CharArray(headers.getValue("content-length").toInt())
                    var offset = 0
                    while (offset < chars.size) {
                        val read = reader.read(chars, offset, chars.size - offset)
                        check(read > 0)
                        offset += read
                    }
                    val status = if (index == 0) "201 Created" else "200 OK"
                    socket.getOutputStream().write("HTTP/1.1 $status\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}".toByteArray())
                    String(chars)
                }
            }
        }
        try {
            val url = URL("http://127.0.0.1:${server.localPort}/api/calls")
            repeat(2) { CallHttpTransport.post(url, token, payload) }
            assertEquals(listOf(payload, payload), received.get(10, TimeUnit.SECONDS))
        } finally { server.close(); executor.shutdownNow() }
    }
}
