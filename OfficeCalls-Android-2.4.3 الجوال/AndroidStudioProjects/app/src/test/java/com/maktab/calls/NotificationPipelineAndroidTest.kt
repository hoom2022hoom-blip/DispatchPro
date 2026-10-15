package com.maktab.calls

import android.app.Notification
import android.app.Person
import android.content.Context
import android.service.notification.StatusBarNotification
import android.os.UserHandle
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NotificationPipelineAndroidTest {
    @org.junit.After fun resetTransport() {LegacyReceiverTestAdapter.reset()}
    private lateinit var context: Context
    private lateinit var store: CallStore
    @Before fun setup() {
        context = RuntimeEnvironment.getApplication()
        store = CallStore.get(context)
        for (table in listOf("outbox", "sessions", "aliases", "diagnostics", "state")) store.writableDatabase.delete(table, null, null)
        LegacyReceiverTestAdapter.install(context)
        context.getSharedPreferences(NetworkSender.PREFS_NAME, Context.MODE_PRIVATE).edit().clear().commit()
    }
    private fun notification(n: Notification, pkg: String = "com.whatsapp"): StatusBarNotification = StatusBarNotification(
        pkg, pkg, 7, null, 1000, 0, 0, n, UserHandle.getUserHandleForUid(0), 1000L)
    @Test fun nameOnlyHasClearReasonAndMessageBodyIsNeverCaptured() {
        val service = Robolectric.buildService(WhatsAppNotificationListener::class.java).create().get()
        val saved = Notification.Builder(context, "calls").setSmallIcon(android.R.drawable.sym_call_incoming)
            .setContentTitle("Alice").setContentText("Incoming voice call").setCategory(Notification.CATEGORY_CALL).build()
        service.processSafely(notification(saved))
        assertTrue(store.pending().isEmpty())
        assertTrue(store.logs().any { it.contains("CONTACT_NAME_ONLY") })
        store.clearLog()
        val message = Notification.Builder(context, "messages").setSmallIcon(android.R.drawable.sym_action_chat)
            .setContentTitle("0591234567").setContentText("Incoming voice call").setCategory(Notification.CATEGORY_MESSAGE).build()
        service.processSafely(notification(message))
        assertTrue(store.pending().isEmpty())
        assertTrue(store.logs().isEmpty())
    }
    @Test fun publicVersionAndCallStyleMetadataCaptureBusinessNumberOnce() {
        val service = Robolectric.buildService(WhatsAppNotificationListener::class.java).create().get()
        val public = Notification.Builder(context, "calls").setSmallIcon(android.R.drawable.sym_call_incoming)
            .setContentTitle("+970 (56) 123-4567").setContentText("Incoming video call").setCategory(Notification.CATEGORY_CALL).build()
        val n = Notification.Builder(context, "calls").setSmallIcon(android.R.drawable.sym_call_incoming).setPublicVersion(public).build()
        // Only create queue rows here, with no configured receiver, so sending cannot succeed.
        service.processSafely(notification(n, "com.whatsapp.w4b"))
        service.processSafely(notification(n, "com.whatsapp.w4b"))
        assertEquals(1, store.pending().size)
        assertTrue(store.pending().single().second.contains("0561234567"))
        val caller = Person.Builder().setName("Alice").setUri("tel:+970561234567").build()
        n.extras.putInt(Notification.EXTRA_CALL_TYPE, Notification.CallStyle.CALL_TYPE_INCOMING)
        n.extras.putParcelable("android.callPerson", caller)
        service.processSafely(notification(n, "com.whatsapp.w4b"))
        assertEquals(1, store.pending().size)
    }
    @Test fun failedAckKeepsIdenticalPayloadUntilRealAckAndNeverReplaysConfirmedEvent() {
        store.capture("com.whatsapp", "key", "0591234567", 1000)
        val original = store.pending().single()
        val server = ServerSocket(0)
        server.soTimeout = 10000
        val worker = Executors.newSingleThreadExecutor()
        val received = worker.submit<List<String>> {
            (0..1).map { attempt -> server.accept().use { socket ->
                socket.soTimeout = 5000
                val line = socket.getInputStream().bufferedReader().readLine()
                socket.getOutputStream().write((if (attempt == 0) "OK wrong-id\n" else "OK ${original.first}\n").toByteArray())
                line
            } }
        }
        context.getSharedPreferences(NetworkSender.PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putString(NetworkSender.KEY_HOST, "127.0.0.1").putInt(NetworkSender.KEY_PORT, server.localPort).commit()
        fun flush(): Boolean {
            val latch = CountDownLatch(1)
            var pending = false
            LegacyReceiverTestAdapter.advanceRetry(context); NetworkSender.flush(context) { pending = it; latch.countDown() }
            assertTrue(latch.await(10, TimeUnit.SECONDS))
            return pending
        }
        try {
            assertTrue(flush())
            assertEquals(listOf(original), store.pending())
            assertFalse(flush())
            assertTrue(store.pending().isEmpty())
            assertEquals(listOf(original.second, original.second), received.get(10, TimeUnit.SECONDS))
            assertFalse(flush())
            assertTrue(store.state("last_ack").contains(original.first))
            assertTrue(store.logs().any { it.contains("RETRY") })
            for (status in listOf("QUEUED", "SENT", "ACK")) {
                store.readableDatabase.rawQuery("SELECT COUNT(*) FROM diagnostics WHERE status=?", arrayOf(status)).use {
                    assertTrue(it.moveToFirst()); assertEquals(status, 1, it.getInt(0))
                }
            }
            assertTrue(store.logs().any { it.contains("RETRY_ATTEMPT") && it.contains(original.first) })
        } finally { server.close(); worker.shutdownNow() }
    }
    @Test fun messagingMetadataDoesNotParseOrPersistBodyAndContactUrisAreNotPhoneNumbers() {
        val service = Robolectric.buildService(WhatsAppNotificationListener::class.java).create().get()
        val person = Person.Builder().setName("Alice").setUri("tel:0591234567").build()
        val style = Notification.MessagingStyle(Person.Builder().setName("Self").build())
            .addMessage("private-message 0561234567", 1000, person)
        val call = Notification.Builder(context, "calls").setSmallIcon(android.R.drawable.sym_call_incoming)
            .setCategory(Notification.CATEGORY_CALL).setStyle(style).build()
        call.extras.putInt(Notification.EXTRA_CALL_TYPE, Notification.CallStyle.CALL_TYPE_INCOMING)
        service.processSafely(notification(call))
        assertEquals(1, store.pending().size)
        assertTrue(store.pending().single().second.contains("0591234567"))
        assertFalse(store.pending().single().second.contains("0561234567"))
        assertTrue(store.logs().none { it.contains("private-message") || it.contains("0561234567") })
        store.removed(notification(call).key)
        val contactUri = Notification.Builder(context, "calls").setSmallIcon(android.R.drawable.sym_call_incoming)
            .setContentTitle("Alice").setContentText("Incoming voice call").setCategory(Notification.CATEGORY_CALL).build()
        contactUri.extras.putParcelable("android.callPerson", Person.Builder().setName("Alice").setUri("content://contacts/0591234567").build())
        service.processSafely(notification(contactUri))
        assertEquals(1, store.pending().size)
        assertTrue(store.logs().any { it.contains("CONTACT_NAME_ONLY") })
    }
}
