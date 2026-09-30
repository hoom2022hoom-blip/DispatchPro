package com.maktab.calls

import java.util.UUID

/**
 * Tracks the lifecycle of one active WhatsApp call notification.
 * The phone number is deliberately not part of the identity: closing the
 * notification ends the event, so the same number may call again immediately.
 */
internal class CallEventTracker(
    private val clock: () -> Long = System::currentTimeMillis,
    private val newEventId: () -> String = { UUID.randomUUID().toString() },
    private val staleAfterMs: Long = 5L * 60L * 1000L
) {
    data class Claim(val eventId: String, val shouldResolve: Boolean)

    private data class ActiveCall(
        val eventId: String,
        var resolving: Boolean,
        var sent: Boolean,
        var lastSeenAt: Long,
        val notificationKeys: MutableSet<String>
    )

    private val activeCalls = mutableMapOf<String, ActiveCall>()

    @Synchronized
    fun claim(callScope: String, notificationKey: String): Claim {
        val now = clock()
        removeStale(now)
        val call = activeCalls.getOrPut(callScope) {
            ActiveCall(newEventId(), resolving = false, sent = false, lastSeenAt = now, notificationKeys = mutableSetOf())
        }
        call.notificationKeys.add(notificationKey)
        call.lastSeenAt = now
        if (call.sent || call.resolving) return Claim(call.eventId, false)
        call.resolving = true
        return Claim(call.eventId, true)
    }

    @Synchronized
    fun markSent(callScope: String, eventId: String): Boolean {
        val call = activeCalls[callScope] ?: return false
        if (call.eventId != eventId || call.sent) return false
        call.resolving = false
        call.sent = true
        call.lastSeenAt = clock()
        return true
    }

    @Synchronized
    fun releaseResolution(callScope: String, eventId: String) {
        val call = activeCalls[callScope] ?: return
        if (call.eventId == eventId && !call.sent) call.resolving = false
    }

    @Synchronized
    fun closeNotification(callScope: String, notificationKey: String) {
        val call = activeCalls[callScope] ?: return
        call.notificationKeys.remove(notificationKey)
        if (call.notificationKeys.isEmpty()) activeCalls.remove(callScope)
    }

    @Synchronized
    fun closeScope(callScope: String) {
        activeCalls.remove(callScope)
    }

    private fun removeStale(now: Long) {
        activeCalls.entries.removeAll { now - it.value.lastSeenAt > staleAfterMs }
    }
}
