package com.maktab.calls

import android.Manifest
import android.app.Application
import android.app.Notification
import android.app.Person
import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.Bundle
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

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class WhatsApp248AndroidTest {
    private lateinit var app: Application
    private lateinit var store: CallStore
    @Before fun setup() {
        app = RuntimeEnvironment.getApplication()
        store = CallStore.get(app)
        listOf("outbox", "sessions", "aliases", "diagnostics", "state", "delivery").forEach { store.writableDatabase.delete(it, null, null) }
        shadowOf(app).denyPermissions(Manifest.permission.READ_CONTACTS)
    }
    private fun call(channel: String = "voip_notification_7", text: String = "Incoming voice call", title: String = "متصل") =
        Notification.Builder(app, channel).setSmallIcon(android.R.drawable.sym_call_incoming)
            .setCategory(Notification.CATEGORY_CALL).setContentTitle(title).setContentText(text).build().apply { extras.putInt("android.callType", 1) }
    private fun sbn(n: Notification, id: Int = 7) = StatusBarNotification("com.whatsapp.w4b", "com.whatsapp.w4b", id, null,
        1000, 0, 0, n, UserHandle.getUserHandleForUid(0), 1000)
    private fun resolve(n: Notification) = NotificationCallIdentity.resolve(listOf(n), emptyList(), app)
    private fun provider(rows: List<Triple<Long, String, List<String>>>) {
        shadowOf(app).grantPermissions(Manifest.permission.READ_CONTACTS)
        val provider = object : ContentProvider() {
            override fun onCreate() = true
            override fun query(uri: Uri, projection: Array<out String>?, selection: String?, args: Array<out String>?, sort: String?): Cursor {
                val cursor = MatrixCursor(projection!!)
                when (uri) {
                    ContactsContract.Contacts.CONTENT_URI -> rows.forEach { row -> cursor.addRow(projection.map { if (it == ContactsContract.Contacts._ID) row.first else row.second }.toTypedArray()) }
                    ContactsContract.Data.CONTENT_URI -> Unit
                    ContactsContract.RawContacts.CONTENT_URI -> rows.forEach { row -> cursor.addRow(projection.map<String,Any?> {when(it) {
                        ContactsContract.RawContacts._ID -> row.first+1000
                        ContactsContract.RawContacts.CONTACT_ID -> row.first
                        ContactsContract.RawContacts.DELETED -> 0
                        else -> row.second
                    } }.toTypedArray()) }
                    ContactsContract.CommonDataKinds.Phone.CONTENT_URI -> if(selection == null) {
                        rows.filter {it.third.isNotEmpty()}.forEach { row -> cursor.addRow(projection.map<String,Any?> {when(it) {
                            ContactsContract.Data.CONTACT_ID -> row.first
                            ContactsContract.Data.RAW_CONTACT_ID -> row.first+1000
                            ContactsContract.CommonDataKinds.Phone.NUMBER -> row.third.firstOrNull()
                            else -> row.second
                        } }.toTypedArray()) }
                    } else rows.filter { it.first.toString() == args?.single() }.flatMap { it.third }.forEach { cursor.addRow(arrayOf(it)) }
                    else -> if (uri == Uri.parse("content://com.android.contacts/contacts/42")) cursor.addRow(arrayOf(42L)) else error("Unexpected provider URI")
                }
                return cursor
            }
            override fun getType(uri: Uri): String? = null
            override fun insert(uri: Uri, values: ContentValues?): Uri? = null
            override fun delete(uri: Uri, selection: String?, args: Array<out String>?) = 0
            override fun update(uri: Uri, values: ContentValues?, selection: String?, args: Array<out String>?) = 0
        }
        ShadowContentResolver.registerProviderInternal(ContactsContract.AUTHORITY, provider)
    }
    @Test fun directCallPersonNameNeedsNoContacts() {
        val n = call(); n.extras.putParcelable("android.callPerson", Person.Builder().setName("+970 (59) 123-4567").build())
        assertEquals("0591234567", resolve(n).phone)
        assertEquals("PHONE_FROM_PERSON", resolve(n).source)
    }
    @Test fun personUriKeyAndEmbeddedNameResolve() {
        for (person in listOf(Person.Builder().setUri("tel:%2B970%2056-123-4567").build(),
            Person.Builder().setUri("+970561234567").build(), Person.Builder().setKey("970561234567").build(),
            Person.Builder().setName("المتصل (0561234567)").build())) {
            val n = call(); n.extras.putParcelable("android.callPerson", person)
            assertEquals("0561234567", resolve(n).phone)
        }
    }
    @Test fun peopleListArrayAndLegacyPeopleResolve() {
        for (field in listOf("android.people.list", "android.people")) {
            val n = call()
            if (field.endsWith("list")) n.extras.putParcelableArray(field, arrayOf(Person.Builder().setUri("tel:0591234567").build()))
            else n.extras.putStringArray(field, arrayOf("970591234567@s.whatsapp.net"))
            assertEquals("0591234567", resolve(n).phone)
        }
    }
    @Test fun allRenderedFieldsAndNestedExtrasExtractEmbeddedNumber() {
        for (key in listOf(Notification.EXTRA_TITLE, Notification.EXTRA_TEXT, Notification.EXTRA_SUB_TEXT, Notification.EXTRA_BIG_TEXT,
            Notification.EXTRA_TITLE_BIG, Notification.EXTRA_INFO_TEXT, Notification.EXTRA_SUMMARY_TEXT)) {
            val n = call(); n.extras.putCharSequence(key, "المتصل: +٩٧٠ (٥٩) ١٢٣-٤٥٦٧")
            assertEquals(key, "0591234567", resolve(n).phone)
        }
        val n = call(); n.extras.putBundle("caller_metadata", Bundle().apply { putString("phone", "رقم المتصل 00970561234567") })
        assertEquals("0561234567", resolve(n).phone)
    }
    @Test fun callMessagingSenderSupportedAndSelfHistoryCannotOverrideCaller() {
        val n = call()
        n.extras.putParcelable("android.messagingUser", Person.Builder().setUri("tel:0561234567").build())
        n.extras.putParcelableArray("android.messages.historic", arrayOf(Bundle().apply { putString("text", "0561234567") }))
        n.extras.putParcelableArray("android.messages", arrayOf(Bundle().apply {
            putParcelable("sender_person", Person.Builder().setUri("tel:0591234567").build()); putString("text", "0561234567")
        }))
        assertEquals("0591234567", resolve(n).phone)
        n.extras.remove("android.messages")
        assertEquals("", resolve(n).phone)
    }
    @Test fun unsavedCallerInTextQueuesWithoutContactPermission() {
        val service = Robolectric.buildService(WhatsAppNotificationListener::class.java).create().get()
        service.processSafely(sbn(call(text = "مكالمة واردة من +970 59-123-4567")))
        assertEquals("0591234567", org.json.JSONObject(store.pending().single().second).getString("number"))
    }
    @Test fun arabicFullNameSpacingSymbolsAndDiacriticsResolve970Contact() {
        provider(listOf(Triple(1L, "أَبُو—الصَّادِق (مصنع الطوب)", listOf("+970 59-503-1462"))))
        assertEquals("0595031462", ContactIndex.lookupResult(app, "ابوالصادق مصنع الطوب").phone)
        assertEquals("", ContactIndex.lookupResult(app, "الصادق").phone)
    }
    @Test fun arabicContactsSupportLocal059And056AndAllPhoneRows() {
        for (phone in listOf("0595031462", "0565031462")) {
            provider(listOf(Triple(1L, "أحمد علي", listOf(phone, "+970${phone.drop(1)}"))))
            assertEquals(phone, ContactIndex.lookupResult(app, "احمد علي").phone)
        }
    }
    @Test fun duplicateArabicNamesAfterNormalizationAreAmbiguousEvenIfOneIsExact() {
        provider(listOf(Triple(1L, "احمد علي", listOf("0591234567")), Triple(2L, "أَحمد-علي", listOf("0561234567"))))
        val n = call(); n.extras.putParcelable("android.callPerson", Person.Builder().setName("احمد علي").build())
        assertTrue(resolve(n).ambiguous)
        val service = Robolectric.buildService(WhatsAppNotificationListener::class.java).create().get()
        service.processSafely(sbn(n))
        assertTrue(store.pending().isEmpty())
        assertTrue(store.logs().any { it.contains("matchedContacts=2") && it.contains("EXTRACTION_FAILED") })
    }
    @Test fun personLinkedContactUriUsesProviderAndNeverUriDigits() {
        provider(listOf(Triple(42L, "Different name", listOf("+970561234567"))))
        val n = call(); n.extras.putParcelable("android.callPerson", Person.Builder().setName("Caller label").setUri("content://com.android.contacts/contacts/42").build())
        assertEquals("0561234567", resolve(n).phone)
        provider(listOf(Triple(42L, "Different name", listOf("0591234567", "0561234567"))))
        assertTrue(resolve(n).ambiguous)
        assertTrue(resolve(n).detail.contains("matchedContacts=1"))
        n.extras.putParcelable("android.callPerson", Person.Builder().setUri("content://other.provider/0591234567").build())
        assertEquals("", resolve(n).phone)
    }
    @Test fun noNumberNoContactHasClearPrivateFailureDiagnostics() {
        provider(emptyList())
        val service = Robolectric.buildService(WhatsAppNotificationListener::class.java).create().get()
        service.processSafely(sbn(call(title = "اسم سري")))
        assertTrue(store.pending().isEmpty())
        val logs = store.logs()
        assertTrue(logs.any { it.contains("EXTRACTION_FAILED") && it.contains("CONTACT_NOT_FOUND") && it.contains("matchedContacts=0") && it.contains("nameFound=true") && it.contains("category=call") && it.contains("channel=voip_notification_7") })
        // 2.4.9 explicitly requests a bounded, local failed caller label for diagnosis.
        assertTrue(logs.any { it.contains("rawWhatsAppName=\"اسم سري\"") && it.contains("normalizedWhatsAppName=") })
    }
    @Test fun unresolvedRingingHasStableEventIdAcrossChannelsAndLateNumber() {
        val first = store.observe("com.whatsapp.w4b", "ring", 1000)
        for(time in listOf(241000L,481000L,721000L)) assertEquals(first,store.observe("com.whatsapp.w4b","ring",time))
        assertEquals(first, store.observe("com.whatsapp.w4b", "silent", 901000))
        assertTrue(store.capture("com.whatsapp.w4b", "silent", "0591234567", 901001))
        assertEquals(first, store.pending().single().first)
        assertFalse(store.capture("com.whatsapp.w4b", "ring", "0591234567", 901002))
    }
    @Test fun channelAndNotificationIdChangeDuringLongRingingQueuesOnce() {
        assertTrue(store.capture("com.whatsapp.w4b", "voip_notification_7", "0591234567", 1000))
        val id = store.pending().single().first
        for(time in listOf(241000L,481000L,721000L)) assertFalse(store.capture("com.whatsapp.w4b","voip_notification_7","0591234567",time))
        repeat(10) { assertFalse(store.capture("com.whatsapp.w4b", "silent_notifications_6:$it", "0591234567", 901000L + it)) }
        assertEquals(listOf(id), store.pending().map { it.first })
        assertEquals(1, store.logs().count { it.contains("QUEUED") })
    }
    @Test fun ongoingCallStyleKeepsSessionAndActualEndAllowsImmediateSameCaller() {
        val service = Robolectric.buildService(WhatsAppNotificationListener::class.java).create().get()
        val incoming = call(title = "0591234567")
        service.processSafely(sbn(incoming))
        val first = store.pending().single().first
        val ongoing = call("silent_notifications_6", "Ongoing call").apply { extras.putInt("android.callType", 2) }
        service.processSafely(sbn(ongoing, 8))
        store.removed(sbn(incoming).key)
        service.processSafely(sbn(incoming, 9))
        assertEquals(listOf(first), store.pending().map { it.first })
        val ended = call("silent_notifications_6", "Call ended").apply { extras.remove("android.callType") }
        service.processSafely(sbn(ended, 8))
        service.processSafely(sbn(incoming))
        assertEquals(2, store.pending().size)
        assertNotEquals(first, store.pending().last().first)
    }
    @Test fun sentAndAckLogOnceWhileRetryKeepsSamePayload() {
        store.capture("com.whatsapp.w4b", "ring", "0591234567", 1000)
        val first = store.pending().single()
        repeat(3) { store.sending(first.first, "com.whatsapp.w4b", "0591234567") }
        assertEquals(listOf(first), store.pending())
        repeat(3) { store.ack(first.first, "com.whatsapp.w4b", "0591234567") }
        fun statusCount(status: String) = store.readableDatabase.rawQuery("SELECT COUNT(*) FROM diagnostics WHERE status=?", arrayOf(status)).use { it.moveToFirst(); it.getInt(0) }
        assertEquals(1, statusCount("SENT"))
        assertEquals(1, statusCount("ACK"))
        assertEquals(2, store.logs().count { it.contains("RETRY_ATTEMPT") })
        for(time in listOf(241000L,481000L,721000L)) assertFalse(store.capture("com.whatsapp.w4b","ring","0591234567",time))
        assertFalse(store.capture("com.whatsapp.w4b", "alternate", "0591234567", 900000))
    }
    @Test fun localAndInternational09LandlineAndDigitBoundaries() {
        for (value in listOf("091234567", "+970 9-123-4567", "0097091234567", "97091234567")) assertEquals("091234567", CallPhoneNumber.normalize(value))
        assertEquals("", CallPhoneNumber.extract("اسم0591234567"))
        assertEquals("", CallPhoneNumber.extract("05912345678"))
        assertEquals("0591234567", CallPhoneNumber.extract("0591234567 0591234567"))
        assertEquals("", CallPhoneNumber.extract("0591234567 0561234567"))
        assertEquals("", CallPhoneNumber.extract("0591234567 8"))
        assertEquals("0591234567", CallPhoneNumber.extract("+970\t59–123–4567"))
    }
    @Test fun deepExtraBundlesDoNotHaveArbitraryDepthCutoff() {
        var bundle = Bundle().apply { putString("phone", "0591234567") }
        repeat(20) { bundle = Bundle().apply { putBundle("nested", bundle) } }
        val n = call(); n.extras.putBundle("metadata", bundle)
        assertEquals("0591234567", resolve(n).phone)
    }
    @Test fun callPersonBundleAndLateOngoingNumberAreNotLost() {
        val bundleCall = call(); bundleCall.extras.putBundle("android.callPerson", Bundle().apply { putString("uri", "tel:0591234567"); putString("name", "Caller") })
        assertEquals("0591234567", resolve(bundleCall).phone)
        val service = Robolectric.buildService(WhatsAppNotificationListener::class.java).create().get()
        service.processSafely(sbn(call()))
        val event = store.readableDatabase.rawQuery("SELECT id FROM sessions", null).use { it.moveToFirst(); it.getString(0) }
        val late = call("silent_notifications_6", "Ongoing call", "0561234567").apply { extras.putInt("android.callType", 2) }
        service.processSafely(sbn(late, 8))
        assertEquals(event, store.pending().single().first)
        assertEquals("0561234567", org.json.JSONObject(store.pending().single().second).getString("number"))
    }
    @Test fun actualRemovalSnapshotMergesReplacementThenClosesForImmediateSecondCall() {
        val service = Robolectric.buildService(WhatsAppNotificationListener::class.java).create().get()
        val original = sbn(call(title = "0591234567"))
        val replacement = sbn(call("silent_notifications_6", title = "0591234567"), 8)
        service.processSafely(original)
        val id = store.pending().single().first
        service.processRemoval(original, listOf(replacement))
        service.processSafely(replacement)
        assertEquals(listOf(id), store.pending().map { it.first })
        service.processRemoval(replacement, emptyList())
        service.processSafely(original)
        assertEquals(2, store.pending().size)
        assertNotEquals(id, store.pending().last().first)
        assertTrue(store.logs().any { it.contains("CALL_FINISHED") && it.contains("NOTIFICATION_REMOVED") })
    }
    @Test fun screeningCallIsIncomingAndStandaloneOngoingCannotQueue() {
        val service = Robolectric.buildService(WhatsAppNotificationListener::class.java).create().get()
        val n = call(title = "0591234567").apply { extras.putInt("android.callType", 2) }
        service.processSafely(sbn(n)); assertTrue(store.pending().isEmpty())
        n.extras.putInt("android.callType", 3)
        service.processSafely(sbn(n)); assertEquals(1, store.pending().size)
    }
    @Test fun unrecognizedCallEvidenceIsLoggedWithoutSendingAnOutgoingNumber() {
        val service = Robolectric.buildService(WhatsAppNotificationListener::class.java).create().get()
        val n = call(text = "Voice call", title = "0591234567").apply { extras.remove("android.callType") }
        service.processSafely(sbn(n))
        assertTrue(store.pending().isEmpty())
        assertTrue(store.logs().any { it.contains("CALL_IGNORED") && it.contains("NO_VERIFIED_INCOMING_SESSION") })
    }
    @Test fun upgradeFrom247PreservesQueuedAndAcknowledgedIdentities() {
        val db = android.database.sqlite.SQLiteDatabase.create(null)
        try {
            db.execSQL("CREATE TABLE sessions(id TEXT PRIMARY KEY, package TEXT, number TEXT, touched INTEGER)")
            db.execSQL("CREATE TABLE aliases(key TEXT PRIMARY KEY, session TEXT, summary INTEGER NOT NULL DEFAULT 0)")
            db.execSQL("CREATE TABLE outbox(id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
            db.execSQL("INSERT INTO sessions VALUES('old-acked','com.whatsapp.w4b','0591234567',1000)")
            db.execSQL("INSERT INTO aliases VALUES('key','old-acked',0)")
            db.execSQL("INSERT INTO outbox VALUES('pending','unchanged-payload')")
            store.onUpgrade(db, 2, 3)
            db.rawQuery("SELECT queued FROM sessions WHERE id='old-acked'", null).use { assertTrue(it.moveToFirst()); assertEquals(1, it.getInt(0)) }
            db.rawQuery("SELECT payload FROM outbox WHERE id='pending'", null).use { assertTrue(it.moveToFirst()); assertEquals("unchanged-payload", it.getString(0)) }
            db.rawQuery("SELECT session FROM aliases WHERE key='key'", null).use { assertTrue(it.moveToFirst()); assertEquals("old-acked", it.getString(0)) }
        } finally { db.close() }
    }
    @Test @Config(sdk = [24]) fun legacyAndroidReadsEmbeddedTextAndPeopleWithoutPersonApi() {
        val n = Notification.Builder(app).setSmallIcon(android.R.drawable.sym_call_incoming).setContentText("مكالمة واردة: 0591234567").build()
        assertEquals("0591234567", resolve(n).phone)
        n.extras.putStringArray("android.people", arrayOf("tel:0561234567"))
        assertEquals("0561234567", resolve(n).phone)
    }
}
