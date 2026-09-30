package com.maktab.calls

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CallEventTrackerTest {
    @Test
    fun tenRingsProduceOneSendClaim() {
        val tracker = CallEventTracker(newEventId = { "call-1" })
        val first = tracker.claim("whatsapp", "notification")
        assertTrue(first.shouldResolve)
        assertTrue(tracker.markSent("whatsapp", first.eventId))
        repeat(9) {
            val update = tracker.claim("whatsapp", "notification-$it")
            assertEquals("call-1", update.eventId)
            assertFalse(update.shouldResolve)
        }
    }

    @Test
    fun closingCallAllowsSameNotificationKeyImmediately() {
        var sequence = 0
        val tracker = CallEventTracker(newEventId = { "call-${++sequence}" })
        val first = tracker.claim("whatsapp", "same-key")
        tracker.markSent("whatsapp", first.eventId)
        tracker.closeNotification("whatsapp", "same-key")
        val second = tracker.claim("whatsapp", "same-key")
        assertTrue(second.shouldResolve)
        assertNotEquals(first.eventId, second.eventId)
    }

    @Test
    fun differentCallsCanProceedBackToBack() {
        var sequence = 0
        val tracker = CallEventTracker(newEventId = { "call-${++sequence}" })
        val first = tracker.claim("whatsapp", "key-a")
        val second = tracker.claim("whatsapp-business", "key-b")
        assertTrue(first.shouldResolve)
        assertTrue(second.shouldResolve)
        assertNotEquals(first.eventId, second.eventId)
    }

    @Test
    fun failedNumberLookupCanBeRetriedWithoutChangingEventId() {
        val tracker = CallEventTracker(newEventId = { "stable-id" })
        val first = tracker.claim("whatsapp", "key")
        tracker.releaseResolution("whatsapp", first.eventId)
        val retry = tracker.claim("whatsapp", "key")
        assertEquals(first.eventId, retry.eventId)
        assertTrue(retry.shouldResolve)
    }
}
