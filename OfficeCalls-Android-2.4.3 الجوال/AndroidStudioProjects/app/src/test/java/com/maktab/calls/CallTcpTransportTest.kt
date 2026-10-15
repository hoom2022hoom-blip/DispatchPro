package com.maktab.calls

import org.junit.Assert.*
import org.junit.Test
import java.net.ServerSocket
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class CallTcpTransportTest {
    private fun receiver(ack: String, test: (Int) -> Unit): String {
        val server = ServerSocket(0)
        server.soTimeout = 5000
        val worker = Executors.newSingleThreadExecutor()
        val received = worker.submit<String> { server.accept().use { socket ->
            socket.soTimeout = 5000
            val body = socket.getInputStream().bufferedReader().readLine()
            socket.getOutputStream().write((ack + "\n").toByteArray())
            body
        } }
        try { test(server.localPort); return received.get(5, TimeUnit.SECONDS) }
        finally { server.close(); worker.shutdownNow() }
    }
    @Test fun existingUtf8LineProtocolAndExactAck() {
        val body = """{"eventId":"stable-1","type":"incoming_call","number":"0591234567"}"""
        assertEquals(body, receiver("OK stable-1") { CallTcpTransport.send("127.0.0.1", it, body, "stable-1") })
    }
    @Test fun wrongAckDoesNotConfirmEvent() {
        receiver("OK other-id") { port ->
            assertTrue(runCatching { CallTcpTransport.send("127.0.0.1", port, "{}", "stable-1") }.isFailure)
        }
    }
    @Test fun connectionFailureIsRetryable() {
        val closedPort = ServerSocket(0).use { it.localPort }
        assertTrue(runCatching { CallTcpTransport.send("127.0.0.1", closedPort, "{}", "stable-1") }.isFailure)
    }
    @Test fun diagnosticProbeSendsNoCustomerPayload() {
        val server = ServerSocket(0)
        server.soTimeout = 5000
        val worker = Executors.newSingleThreadExecutor()
        val read = worker.submit<Int> { server.accept().use { it.soTimeout = 5000; it.getInputStream().read() } }
        try { CallTcpTransport.probe("127.0.0.1", server.localPort); assertEquals(-1, read.get(5, TimeUnit.SECONDS).toInt()) }
        finally { server.close(); worker.shutdownNow() }
    }
}
