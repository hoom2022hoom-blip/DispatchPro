package com.maktab.calls

import android.Manifest
import android.app.Application
import android.app.Notification
import android.app.Person
import android.app.PendingIntent
import android.content.*
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.UserHandle
import android.provider.ContactsContract as C
import android.service.notification.StatusBarNotification
import org.junit.Assert.*
import org.junit.Before
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.*
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowContentResolver

/** Reproductions from the archived code and the reported TECNO notification/contact shapes. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35])
class Regression260AndroidTest {
    private lateinit var app: Application
    private lateinit var store: CallStore
    private lateinit var controller: org.robolectric.android.controller.ServiceController<WhatsAppNotificationListener>
    @Before fun setup() {
        app=RuntimeEnvironment.getApplication()
        store=CallStore.get(app)
        listOf("outbox","sessions","aliases","diagnostics","state","delivery").forEach {store.writableDatabase.delete(it,null,null)}
        Shadows.shadowOf(app).grantPermissions(Manifest.permission.READ_CONTACTS)
        LegacyReceiverTestAdapter.install(app)
        app.getSharedPreferences(NetworkSender.PREFS_NAME,0).edit().clear().commit()
        phones()
        controller=Robolectric.buildService(WhatsAppNotificationListener::class.java).create()
    }
    @After fun finish() {
        controller.destroy(); LegacyReceiverTestAdapter.reset()}
    private fun phones(optionalFails: Boolean=false, filteredEmpty: Boolean=false, compactStoredName: Boolean=false, compactCollision: Boolean=false) {
        ShadowContentResolver.registerProviderInternal(C.AUTHORITY,object: ContentProvider() {
            override fun onCreate()=true
            override fun query(uri: Uri, projection: Array<out String>?, selection: String?, args: Array<out String>?, sort: String?): Cursor? {
                if(optionalFails && uri!=C.CommonDataKinds.Phone.CONTENT_URI) return null
                val cols=projection!!; val cursor=MatrixCursor(cols)
                if(uri==C.CommonDataKinds.Phone.CONTENT_URI && !(filteredEmpty && args!=null)) {
                    listOf(Triple(77L,if(compactStoredName) "رمزيدياب" else "رمزي دياب","+972 59-123-4567"),Triple(78L,if(compactCollision) "رمزيد ياب" else "شوقي دياب","0561234567"),Triple(79L,"خالد دياب","0597654321"),Triple(80L,"ماهر دياب","0567654321")).filter {args==null || it.first.toString()==args.single()}.forEach {row ->
                        cursor.addRow(cols.map {col -> when(col) {
                            C.Data.CONTACT_ID -> row.first
                            C.Data.RAW_CONTACT_ID -> row.first+1000
                            C.Contacts.DISPLAY_NAME_PRIMARY,C.Contacts.DISPLAY_NAME_ALTERNATIVE -> row.second
                            C.CommonDataKinds.Phone.NUMBER -> row.third
                            else -> null
                        }}.toTypedArray())
                    }
                }
                return cursor
            }
            override fun getType(uri: Uri): String?=null
            override fun insert(uri: Uri, values: ContentValues?): Uri?=error("read only")
            override fun delete(uri: Uri, selection: String?, args: Array<out String>?)=error("read only")
            override fun update(uri: Uri, values: ContentValues?, selection: String?, args: Array<out String>?)=error("read only")
        })
    }
    private fun call(title: String="اسم غير محفوظ", text: String="Incoming voice call", channel: String="voip_notification_7", person: Person?=null): Notification {
        val n=Notification.Builder(app,channel).setSmallIcon(android.R.drawable.sym_call_incoming).setCategory(Notification.CATEGORY_CALL).setContentTitle(title).setContentText(text).build()
        if(person!=null) n.extras.putParcelable("android.callPerson",person)
        return n
    }
    private fun post(n: Notification,id: Int=7) {
        controller.get().processSafely(StatusBarNotification("com.whatsapp.w4b","com.whatsapp.w4b",id,null,1000,0,0,n,UserHandle.getUserHandleForUid(0),System.currentTimeMillis()))
    }
    @Test fun phoneRowSurvivesUnavailableSupplementalTables() {
        phones(optionalFails=true)
        assertEquals("0591234567",ContactIndex.lookupResult(app,"رمزي دياب").phone)
    }
    @Test fun phoneSnapshotSurvivesProviderFilteredQueryDifference() {
        phones(filteredEmpty=true)
        assertEquals("0591234567",ContactIndex.lookupResult(app,"رمزي دياب").phone)
    }
    @Test fun exactRamziNeverSelectsOtherDiabContacts() {
        assertEquals("0591234567",ContactIndex.lookupResult(app,"\u200fرَمـزي  دياب").phone)
        assertEquals("",ContactIndex.lookupResult(app,"دياب").phone)
    }
    @Test fun invisibleDirectionMarkJoiningFullArabicCallerPreservesOriginalNameKey() {
        assertEquals("0591234567",ContactIndex.lookupResult(app,"رمزي\u200fدياب").phone)
    }
    @Test fun phoneProviderCompactFullNameCanResolveSpacedCaller() {
        phones(compactStoredName=true)
        assertEquals("0591234567",ContactIndex.lookupResult(app,"رمزي دياب").phone)
    }
    @Test fun compactFullNameCollisionNeverSelectsFirstProviderRow() {
        phones(compactCollision=true)
        val result=ContactIndex.lookupResult(app,"رمزي دياب")
        assertEquals(ContactIndex.Status.CONTACT_AMBIGUOUS,result.status);assertEquals("",result.phone)
    }
    @Test fun decoratedIncomingActionLabelsKeepOriginal243Coverage() {
        val pending=PendingIntent.getBroadcast(app,0,Intent("call-action"),PendingIntent.FLAG_IMMUTABLE)
        val n=call(text="Voice call")
        n.actions=arrayOf(Notification.Action.Builder(0,"Answer voice call",pending).build(),Notification.Action.Builder(0,"Decline call",pending).build())
        n.extras.putCharSequence(Notification.EXTRA_TITLE,"0591234567")
        post(n);assertEquals(1,store.pending().size)
    }
    @Test fun silentPersonOnlyUpdateEnrichesVerifiedIncomingSession() {
        post(call())
        val id=store.readableDatabase.rawQuery("SELECT id FROM sessions",null).use {assertTrue(it.moveToFirst());it.getString(0)}
        post(call(title="",text="",channel="silent_notifications_6",person=Person.Builder().setName("اسم غير محفوظ").build()),8)
        repeat(3) {post(call(title="",text="",channel="silent_notifications_6",person=Person.Builder().setUri("tel:+972 59-123-4567").build()),8)}
        assertEquals(listOf(id),store.pending().map {it.first})
        assertEquals(1,store.logs().count {it.contains(" QUEUED\n")})
    }
    @Test fun directTextNumberPrecedesPersonContactLookup() {
        val n=call("0597654321",person=Person.Builder().setUri("content://com.android.contacts/contacts/77").build())
        assertEquals("0597654321",NotificationCallIdentity.resolve(listOf(n),listOf("0597654321","Incoming voice call"),app).phone)
    }
    @Test fun laterPersonNameReplacesWeakEarlyTitleWithinSameSession() {
        post(call())
        val id=store.readableDatabase.rawQuery("SELECT id FROM sessions",null).use {assertTrue(it.moveToFirst());it.getString(0)}
        post(call("","",person=Person.Builder().setName("رمزي دياب").build()))
        assertEquals(id,store.pending().single().first)
        assertEquals("0591234567",org.json.JSONObject(store.pending().single().second).getString("number"))
        assertEquals("رمزي دياب",store.session(id)!!.callerName)
        assertEquals(2,store.session(id)!!.candidateIdentities.size)
    }
    @Test fun laterPersonDirectPhoneIsNotBlockedByHistoricalUnresolvedName() {
        post(call())
        val id=store.readableDatabase.rawQuery("SELECT id FROM sessions",null).use {assertTrue(it.moveToFirst());it.getString(0)}
        post(call("","",person=Person.Builder().setName("رمزي دياب").setUri("tel:+972591234567").build()))
        assertEquals(id,store.pending().single().first)
        assertEquals("0591234567",org.json.JSONObject(store.pending().single().second).getString("number"))
        post(call("","",person=Person.Builder().setUri("tel:+972591234567").build()))
        assertEquals("رمزي دياب",store.session(id)!!.callerName)
        assertEquals(1,store.pending().size)
    }
    @Test fun decoratedSecondaryTitleDoesNotHideOriginalExactCaller() {
        post(call("رمزي دياب").apply {extras.putCharSequence(Notification.EXTRA_SUB_TEXT,"جهة مختلفة")})
        assertEquals("0591234567",org.json.JSONObject(store.pending().single().second).getString("number"))
    }
    @Test fun staleSessionCannotSwallowNextCallWhenRemovalWasMissed() {
        store.capture("com.whatsapp.w4b","old","0591234567",1000)
        val first=store.pending().single().first
        store.capture("com.whatsapp.w4b","new","0591234567",1000+6*60*1000L)
        assertEquals(2,store.pending().size);assertNotEquals(first,store.pending().last().first)
    }
    @Test fun versionThreeUpgradePreservesQueueAndAcknowledgedSession() {
        val db=android.database.sqlite.SQLiteDatabase.create(null)
        try {
            db.execSQL("CREATE TABLE sessions(id TEXT PRIMARY KEY,package TEXT,number TEXT,touched INTEGER,queued INTEGER NOT NULL DEFAULT 0)")
            db.execSQL("CREATE TABLE outbox(id TEXT PRIMARY KEY,payload TEXT NOT NULL)")
            db.execSQL("CREATE TABLE delivery(id TEXT PRIMARY KEY,sent INTEGER NOT NULL DEFAULT 0)")
            db.execSQL("INSERT INTO sessions VALUES('pending','com.whatsapp.w4b','0591234567',1000,1)")
            db.execSQL("INSERT INTO sessions VALUES('acked','com.whatsapp.w4b','0561234567',1001,1)")
            db.execSQL("INSERT INTO outbox VALUES('pending','unchanged-json')")
            store.onUpgrade(db,3,4)
            db.rawQuery("SELECT payload FROM outbox WHERE id='pending'",null).use {assertTrue(it.moveToFirst());assertEquals("unchanged-json",it.getString(0))}
            db.rawQuery("SELECT phase,acknowledged,first_seen FROM sessions WHERE id='acked'",null).use {
                assertTrue(it.moveToFirst());assertEquals("ACK",it.getString(0));assertEquals(1,it.getInt(1));assertEquals(1001L,it.getLong(2))
            }
        } finally {db.close()}
    }
    @Test fun fiveNotificationsEnrichAllButTcpSendsOnceAndSecondEndedCallSendsAgain() {
        java.net.ServerSocket(0).use {server ->
            server.soTimeout=5000
            val worker=java.util.concurrent.Executors.newSingleThreadExecutor()
            app.getSharedPreferences(NetworkSender.PREFS_NAME,0).edit().putString(NetworkSender.KEY_HOST,"127.0.0.1").putInt(NetworkSender.KEY_PORT,server.localPort).commit()
            fun receive()=worker.submit<String> {server.accept().use {
                it.soTimeout=5000
                val body=it.getInputStream().bufferedReader().readLine()
                it.getOutputStream().write("OK ${org.json.JSONObject(body).getString("eventId")}\n".toByteArray())
                body
            }}
            fun flush() {
                val done=java.util.concurrent.CountDownLatch(1)
                LegacyReceiverTestAdapter.advanceRetry(app); NetworkSender.flush(app) {done.countDown()}
                assertTrue(done.await(8,java.util.concurrent.TimeUnit.SECONDS))
            }
            try {
                val first=receive()
                post(call())
                post(call("","",person=Person.Builder().setName("اسم غير محفوظ").build()))
                repeat(3) {post(call("","",channel="silent_notifications_6",person=Person.Builder().setUri("tel:+972591234567").build()),8)}
                flush()
                val firstId=org.json.JSONObject(first.get(5,java.util.concurrent.TimeUnit.SECONDS)).getString("eventId")
                assertEquals(5,store.logs().count {it.contains(" SESSION_ENRICHED\n")})
                assertEquals(1,store.logs().count {it.contains(" SENT\n")})
                assertEquals(1,store.logs().count {it.contains(" ACK\n")})
                assertTrue(store.pending().isEmpty());assertTrue(store.session(firstId)!!.acknowledged)
                server.soTimeout=300
                assertThrows(java.net.SocketTimeoutException::class.java) {server.accept()}
                store.ended("0|com.whatsapp.w4b|8|null|1000","com.whatsapp.w4b")
                server.soTimeout=5000
                val second=receive()
                post(call("0591234567"),8)
                flush()
                val secondId=org.json.JSONObject(second.get(5,java.util.concurrent.TimeUnit.SECONDS)).getString("eventId")
                assertNotEquals(firstId,secondId)
                assertEquals(2,store.logs().count {it.contains(" SENT\n")})
                assertEquals(2,store.logs().count {it.contains(" ACK\n")})
            } finally {worker.shutdownNow()}
        }
    }
}
