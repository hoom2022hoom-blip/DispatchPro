package com.maktab.calls

import android.Manifest
import android.app.Application
import android.app.Notification
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.UserHandle
import android.provider.ContactsContract
import android.service.notification.StatusBarNotification
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowContentResolver
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ContactPipelineAndroidTest {
    @org.junit.After fun resetTransport() {
        drain();NetworkSender.localRequest=LocalReceiverTransport::request;NetworkSender.clock=System::currentTimeMillis
    }
    private val name = "درج ام الاسد شارع القدس"
    private lateinit var app: Application
    private lateinit var store: CallStore
    @Before fun setup() {
        app = RuntimeEnvironment.getApplication()
        store = CallStore.get(app)
        listOf("outbox", "sessions", "aliases", "diagnostics", "state").forEach { store.writableDatabase.delete(it, null, null) }
        app.getSharedPreferences(NetworkSender.PREFS_NAME, Context.MODE_PRIVATE).edit().clear().commit()
        NetworkSender.clock=System::currentTimeMillis
        NetworkSender.localRequest={_,_->throw java.io.IOException("OFFLINE_FIXTURE")}
    }
    private fun drain() {
        store.writableDatabase.execSQL("CREATE TABLE IF NOT EXISTS local_retry(id TEXT PRIMARY KEY, revision INTEGER, retries INTEGER DEFAULT 0, next_attempt INTEGER DEFAULT 0)")
        store.writableDatabase.execSQL("UPDATE local_retry SET next_attempt=0")
        val done=CountDownLatch(1);NetworkSender.flush(app){done.countDown()};assertTrue(done.await(10,TimeUnit.SECONDS))
    }
    private fun provider(phones: List<String>, found: Boolean = true, display: String = "\u200fدرج\u00a0ام  الاسد شارع القدس") {
        val local = object : ContentProvider() {
            override fun onCreate() = true
            override fun query(uri: Uri, projection: Array<out String>?, selection: String?, args: Array<out String>?, sort: String?): Cursor {
                val cursor = MatrixCursor(projection!!)
                if (uri == ContactsContract.Contacts.CONTENT_URI) {
                    if (found) cursor.addRow(projection.map<String, Any?> { if (it == ContactsContract.Contacts._ID) 1L else display }.toTypedArray())
                } else if (uri == ContactsContract.RawContacts.CONTENT_URI) {
                    if(found) cursor.addRow(projection.map<String,Any?> { when(it) {
                        ContactsContract.RawContacts._ID -> 1001L
                        ContactsContract.RawContacts.CONTACT_ID -> 1L
                        ContactsContract.RawContacts.DELETED -> 0
                        else -> display
                    } }.toTypedArray())
                } else if(uri == ContactsContract.CommonDataKinds.Phone.CONTENT_URI && selection == null) {
                    if(found && phones.isNotEmpty()) cursor.addRow(projection.map<String,Any?> {when(it) {
                        ContactsContract.Data.CONTACT_ID -> 1L
                        ContactsContract.Data.RAW_CONTACT_ID -> 1001L
                        ContactsContract.CommonDataKinds.Phone.NUMBER -> phones.firstOrNull()
                        else -> display
                    } }.toTypedArray())
                } else if (uri == ContactsContract.Data.CONTENT_URI) {
                    assertEquals(ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE, args?.single())
                } else {
                    assertEquals("${ContactsContract.CommonDataKinds.Phone.CONTACT_ID} = ?", selection)
                    assertEquals(listOf("1"), args?.toList())
                    phones.forEach { cursor.addRow(arrayOf(it)) }
                }
                return cursor
            }
            override fun getType(uri: Uri): String? = null
            override fun insert(uri: Uri, values: ContentValues?): Uri? = null
            override fun delete(uri: Uri, selection: String?, args: Array<out String>?) = 0
            override fun update(uri: Uri, values: ContentValues?, selection: String?, args: Array<out String>?) = 0
        }
        ShadowContentResolver.registerProviderInternal(ContactsContract.AUTHORITY, local)
    }
    private fun ring(caller: String = name, pkg: String = "com.whatsapp.w4b") {
        val service = Robolectric.buildService(WhatsAppNotificationListener::class.java).create().get()
        val n = Notification.Builder(app, "calls").setSmallIcon(android.R.drawable.sym_call_incoming)
            .setContentTitle(caller).setContentText("مكالمة صوتية واردة").setCategory(Notification.CATEGORY_CALL).build()
        service.processSafely(StatusBarNotification(pkg, pkg, 4, null, 1000, 0, 0, n, UserHandle.getUserHandleForUid(0), 1000))
    }
    @Test fun currentBusinessExampleQueuesOneEventAcrossRepeatedRingingUpdates() {
        shadowOf(app).grantPermissions(Manifest.permission.READ_CONTACTS)
        provider(listOf("+972 59-503-1462"), display = "“ابو الصادق (مصنع الطوب)”")
        repeat(5) { ring("ابو الصادق مصنع الطوب") }
        assertEquals(1, store.pending().size)
        assertTrue(store.pending().single().second.contains("0595031462"))
        assertTrue(store.logs().any { it.contains("PHONE_FROM_CONTACTS") })
    }
    @Test fun whatsappEnglishNameContainingCallIsMatchedNormally() {
        shadowOf(app).grantPermissions(Manifest.permission.READ_CONTACTS)
        provider(listOf("+970 56-503-1462"), display = "CALLAHAN Smith")
        ring("Callahan smith", "com.whatsapp")
        assertEquals(1, store.pending().size)
        assertTrue(store.pending().single().second.contains("0565031462"))
    }
    @Test fun businessSavedContactReachesLocalReceiverWithOriginalTimeAndMatchingAck() {
        provider(listOf("+972 59-860-9731", "0598609731"))
        shadowOf(app).grantPermissions(Manifest.permission.READ_CONTACTS)
        val received=mutableListOf<org.json.JSONObject>()
        NetworkSender.localRequest={_,payload->
            val body=org.json.JSONObject(payload!!.toString());received.add(body)
            org.json.JSONObject().put("eventId",body.getString("eventId")).put("revision",body.getInt("revision"))
                .put("receiverAcknowledged",true).put("gridCms","UDP_SENT")
        }
        ring();drain()
        assertTrue(received.any {it.optString("number")=="0598609731"})
        assertEquals(1,received.map {it.getString("eventId")}.distinct().size)
        assertTrue(received.all {it.getLong("timestamp")==1000L})
        assertTrue(store.pending().isEmpty())
        assertTrue(store.logs().any {it.contains("CONTACT_RESOLVED")})
        assertTrue(store.logs().any {it.contains("ACK")})
    }
    @Test fun permissionMissingDoesNotQueueOrSendGuessedPhone() {
        provider(listOf("+972 59-860-9731")); shadowOf(app).denyPermissions(Manifest.permission.READ_CONTACTS)
        ring()
        assertTrue(store.pending().isNotEmpty())
        assertTrue(store.pending().all {org.json.JSONObject(it.second).getString("number").isBlank()})
        assertTrue(store.logs().any { it.contains("CONTACT_PERMISSION_MISSING") })
        assertTrue(store.logs().none { it.contains("CONTACT_RESOLVED") })
    }
    @Test fun ambiguousContactIsRetainedWithoutGuessedPhone() {
        provider(listOf("0598609731", "0561234567")); shadowOf(app).grantPermissions(Manifest.permission.READ_CONTACTS)
        ring()
        assertTrue(store.pending().isNotEmpty())
        assertTrue(store.pending().all {org.json.JSONObject(it.second).getString("number").isBlank()})
        assertTrue(store.logs().any { it.contains("CONTACT_AMBIGUOUS") })
        assertTrue(store.logs().none { it.contains("CONTACT_RESOLVED") })
    }
    @Test fun notFoundHasSpecificReasonAndStillNameOnly() {
        provider(emptyList(), found = false); shadowOf(app).grantPermissions(Manifest.permission.READ_CONTACTS)
        ring()
        assertTrue(store.pending().isNotEmpty())
        assertTrue(store.pending().all {org.json.JSONObject(it.second).getString("number").isBlank()})
        assertTrue(store.logs().any { it.contains("CONTACT_NOT_FOUND") })
        assertTrue(store.logs().any { it.contains("CONTACT_NAME_ONLY") })
    }
}
