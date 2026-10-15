package com.maktab.calls

import java.net.Socket
import java.net.InetSocketAddress

internal object CallTcpTransport {
    class Failure(val phase: String, cause: Exception): IllegalStateException("${phase}_FAILED",cause)
    fun send(host: String, port: Int, body: String, eventId: String, onWritten: () -> Unit = {}) {
        var phase="TCP"
        try {
        Socket().use { socket ->
            socket.connect(InetSocketAddress(host, port), 2500)
            socket.soTimeout = 3500
            socket.getOutputStream().write((body + "\n").toByteArray(Charsets.UTF_8))
            socket.getOutputStream().flush()
            onWritten()
            phase="ACK"
            // Bound the ACK, including malicious or broken receivers which never terminate a line.
            val input = socket.getInputStream()
            val ack = StringBuilder()
            while (ack.length <= 200) {
                val ch = input.read()
                if (ch < 0) throw IllegalStateException("ACK_EOF")
                if (ch == 10) break
                ack.append(ch.toChar())
            }
            check(ack.toString().trimEnd('\r') == "OK $eventId") { "INVALID_ACK" }
        }
        } catch(error: Exception) { throw Failure(phase,error) }
    }
    fun probe(host: String, port: Int) {
        // No payload: the existing receiver cannot create a customer call from this test.
        Socket().use { it.connect(InetSocketAddress(host, port), 2500) }
    }
}
