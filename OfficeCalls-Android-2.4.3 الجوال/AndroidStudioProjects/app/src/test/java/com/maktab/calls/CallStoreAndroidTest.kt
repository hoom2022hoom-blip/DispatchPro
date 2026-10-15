package com.maktab.calls

import android.content.Context
import org.junit.Assert.*
import org.junit.Before
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CallStoreAndroidTest {
    private lateinit var context: Context
    private lateinit var store: CallStore
    @Before fun setup() {
        context = RuntimeEnvironment.getApplication()
        store = CallStore(context)
        for (table in listOf("outbox", "sessions", "aliases", "diagnostics", "state")) store.writableDatabase.delete(table, null, null)
    }
    @After fun close() { store.close() }
    @Test fun restartKeepsPendingPayloadAndActiveDedupeAfterAck() {
        assertTrue(store.capture("com.whatsapp", "key", "0591234567", 1000))
        val pending = store.pending().single()
        store.close()
        store = CallStore(context)
        assertEquals(listOf(pending), store.pending())
        assertFalse(store.capture("com.whatsapp", "key", "0591234567", 2000))
        store.ack(pending.first, "com.whatsapp", "0591234567")
        assertTrue(store.pending().isEmpty())
        store.close(); store = CallStore(context)
        assertFalse(store.capture("com.whatsapp", "key", "0591234567", 3000))
        assertTrue(store.pending().isEmpty())
    }
    @Test fun realSecondCallAfterRemovalGetsNewId() {
        store.capture("com.whatsapp", "key", "0591234567", 1000)
        val first = store.pending().single().first
        store.removed("key")
        assertTrue(store.capture("com.whatsapp", "key", "0591234567", 1100))
        assertNotEquals(first, store.pending().last().first)
    }
    @Test fun groupsAndUpdatesDeduplicateButDistinctCallersAndBusinessDoNot() {
        assertTrue(store.capture("com.whatsapp", "child", "0591234567", 1000))
        repeat(10) { assertFalse(store.capture("com.whatsapp", "child", "0591234567", 1001L + it)) }
        assertFalse(store.capture("com.whatsapp", "group", "0591234567", 2000))
        assertTrue(store.capture("com.whatsapp", "other", "0561234567", 2001))
        assertTrue(store.capture("com.whatsapp.w4b", "business", "0591234567", 2001))
        assertEquals(3, store.pending().size)
        store.ended("child")
        assertTrue(store.capture("com.whatsapp", "child", "0591234567", 2100))
    }
    @Test fun reconcileAfterOfflineRemovalPermitsNextCall() {
        store.capture("com.whatsapp", "old", "0591234567", 1000)
        store.reconcile(emptySet())
        assertTrue(store.capture("com.whatsapp", "new", "0591234567", 1001))
    }
    @Test fun clearDiagnosticLogDoesNotClearPendingAndLogIsBounded() {
        store.capture("com.whatsapp", "key", "0591234567", 1000)
        repeat(210) { store.log(status = "RETRY") }
        assertEquals(200, store.logs().size)
        store.clearLog()
        assertTrue(store.logs().isEmpty())
        assertEquals(1, store.pending().size)
    }
    @Test fun lingeringSummaryDoesNotBlockSecondCallAfterChildRemoval() {
        store.capture("com.whatsapp", "child", "0591234567", 1000)
        assertFalse(store.capture("com.whatsapp", "summary", "0591234567", 1001, groupSummary = true))
        store.removed("child")
        assertTrue(store.capture("com.whatsapp", "child", "0591234567", 1002))
        assertEquals(2, store.pending().size)
    }
}
