package com.maktab.calls

import android.Manifest
import android.app.Application
import android.app.Notification
import android.app.Person
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.UserHandle
import android.provider.ContactsContract as C
import android.provider.ContactsContract.CommonDataKinds.StructuredName as S
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
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34])
class OfficeCalls250AndroidTest {
    @org.junit.After fun resetTransport() {LegacyReceiverTestAdapter.reset()}
    private data class Row(val id: Long, val raw: Long, val display: String, val name: String = display,
        val rawName: String = name, val phone: String = "0591234567", val inContacts: Boolean = true,
        val deleted: Boolean = false, val account: String = "com.google")
    private lateinit var app: Application
    private lateinit var store: CallStore
    @Before fun setup() {
        app = RuntimeEnvironment.getApplication()
        store = CallStore.get(app)
        listOf("outbox", "sessions", "aliases", "diagnostics", "state", "delivery").forEach { store.writableDatabase.delete(it, null, null) }
        shadowOf(app).grantPermissions(Manifest.permission.READ_CONTACTS)
        LegacyReceiverTestAdapter.install(app)
        app.getSharedPreferences(NetworkSender.PREFS_NAME, Context.MODE_PRIVATE).edit().clear().commit()
        provider(emptyList())
        simProvider(emptyList())
    }
    private fun provider(rows: List<Row>, inconsistentRawLink: Boolean=false) {
        ShadowContentResolver.registerProviderInternal(C.AUTHORITY, object: ContentProvider() {
            override fun onCreate() = true
            override fun query(uri: Uri, projection: Array<out String>?, selection: String?, args: Array<out String>?, sort: String?): Cursor {
                val cols = projection!!
                val cursor = MatrixCursor(cols)
                val chosen = when(uri) {
                    C.Contacts.CONTENT_URI -> rows.filter { it.inContacts }.distinctBy { it.id }
                    C.RawContacts.CONTENT_URI -> rows
                    C.Data.CONTENT_URI -> rows.filterNot { it.deleted }
                    C.CommonDataKinds.Phone.CONTENT_URI -> rows.filter { !it.deleted && it.phone.isNotBlank() && (args == null || it.id.toString() == args.single()) }
                    else -> emptyList()
                }
                for (row in chosen) cursor.addRow(cols.map<String, Any?> { col -> when(col) {
                    "_id" -> if(uri == C.RawContacts.CONTENT_URI) row.raw else row.id
                    C.Data.CONTACT_ID -> if(inconsistentRawLink && uri == C.RawContacts.CONTENT_URI) row.id+1 else row.id
                    C.Data.RAW_CONTACT_ID -> row.raw
                    C.RawContacts.DELETED -> if(row.deleted) 1 else 0
                    C.RawContacts.ACCOUNT_TYPE -> row.account
                    C.Contacts.LOOKUP_KEY -> "key-${row.id}"
                    C.Contacts.DISPLAY_NAME_PRIMARY -> if(uri == C.RawContacts.CONTENT_URI) row.rawName else row.display
                    C.Contacts.DISPLAY_NAME_ALTERNATIVE -> if(uri == C.RawContacts.CONTENT_URI) row.rawName else row.display
                    "data1" -> if(uri == C.Data.CONTENT_URI) row.name else row.phone
                    else -> null
                } }.toTypedArray())
                return cursor
            }
            override fun getType(uri: Uri): String? = null
            override fun insert(uri: Uri, values: ContentValues?): Uri? = null
            override fun update(uri: Uri, values: ContentValues?, selection: String?, args: Array<out String>?) = 0
            override fun delete(uri: Uri, selection: String?, args: Array<out String>?) = 0
        })
    }
    private fun call(title: String = "WhatsApp Business", person: Person? = null, channel: String = "calls") =
        Notification.Builder(app, channel).setSmallIcon(android.R.drawable.sym_call_incoming).setCategory(Notification.CATEGORY_CALL)
            .setContentTitle(title).setContentText("Incoming voice call").build().apply {
                extras.putInt("android.callType", 1)
                person?.let { extras.putParcelable("android.callPerson", it) }
            }
    private fun resolve(n: Notification) = NotificationCallIdentity.resolve(listOf(n), emptyList(), app)
    private fun process(n: Notification, id: Int=7) = Robolectric.buildService(WhatsAppNotificationListener::class.java).create().get().processSafely(
        StatusBarNotification("com.whatsapp.w4b", "com.whatsapp.w4b", id, null, 1000, 0, 0, n, UserHandle.getUserHandleForUid(0), 1000))
    @Test fun ramziDiabOutsideAggregateListStillHasVerifiedProviderIdentity() {
        provider(listOf(Row(1,11,"شوقي دياب"), Row(2,12,"خالد دياب"), Row(3,13,"ماهر دياب"),
            Row(99,9001,"Other aggregate", "رمزي دياب", inContacts=false, phone="+970561234567")))
        val r = ContactIndex.lookupResult(app,"رمزي دياب")
        assertEquals("0561234567",r.phone)
    }
    @Test fun ramziRawNameOfMergedGoogleAndLocalContactIsIndexed() {
        provider(listOf(Row(99,9001,"Merged label", "Different structured", "رمزي دياب", account="com.google"),
            Row(99,9002,"Merged label", "Different structured", "Other local alias", account="local")))
        assertEquals("0591234567",ContactIndex.lookupResult(app,"رمزي دياب").phone)
    }
    @Test fun ramziRegression237Aggregates725StructuredRows() {
        val base=(1L..237L).map {Row(it,it+1000,"جهة تجريبية $it")}
        val extra=(1L..487L).map {Row((it%237)+1,it+5000,"بديل $it",inContacts=false)}
        provider(base+extra+Row(500,9999,"Merged label","رمزي دياب","Raw label",phone="+970561234567",inContacts=false))
        val r=ContactIndex.lookupResult(app,"رمزي دياب")
        assertEquals("0561234567",r.phone)
        assertTrue(r.detail.contains("contactRows=237"));assertTrue(r.detail.contains("structuredRows=725"));assertTrue(r.detail.contains("matchedContacts=1"))
    }
    @Test fun exactAndNormalizedSavedContactsRemainCorrect() {
        provider(listOf(Row(1,100,"رمزي دياب")))
        assertEquals("0591234567",ContactIndex.lookupResult(app,"رمزي دياب").phone)
        assertEquals("0591234567",ContactIndex.lookupResult(app,"\u200fرَمْزِي  ديـاب").phone)
    }
    @Test fun unrelatedDiabNamesNeverBecomeRamziByLoweringFuzzy() {
        provider(listOf(Row(1,11,"شوقي دياب"),Row(2,12,"خالد دياب"),Row(3,13,"ماهر دياب")))
        assertEquals("",ContactIndex.lookupResult(app,"رمزي دياب").phone)
    }
    @Test fun deletedRawContactCannotSupplyCallerAlias() {
        provider(listOf(Row(99,1,"Other", "Other", "رمزي دياب", deleted=true)))
        assertEquals("",ContactIndex.lookupResult(app,"رمزي دياب").phone)
    }
    @Test fun allAccountTypesExposedByProviderAreIncluded() {
        for (account in listOf("com.google","local","com.android.sim","vendor.account")) {
            provider(listOf(Row(99,9001,"Different", "Different", "رمزي دياب", account=account)))
            assertEquals(account,"0591234567",ContactIndex.lookupResult(app,"رمزي دياب").phone)
        }
    }
    @Test fun mergedMultiplePhonesAreStillAmbiguous() {
        provider(listOf(Row(99,1,"رمزي دياب"),Row(99,2,"رمزي دياب",phone="0561234567")))
        assertEquals(CContactAmbiguous,ContactIndex.lookupResult(app,"رمزي دياب").status)
    }
    private val CContactAmbiguous get() = ContactIndex.Status.CONTACT_AMBIGUOUS
    @Test fun unknownCallerPhoneInPersonAndUriNeedsNoContacts() {
        shadowOf(app).denyPermissions(Manifest.permission.READ_CONTACTS)
        assertEquals("0591234567",resolve(call(person=Person.Builder().setName("0591234567").build())).phone)
        assertEquals("0561234567",resolve(call(person=Person.Builder().setUri("tel:00970561234567").build())).phone)
    }
    @Test fun unknownCallerNumberInNestedExtras() {
        val n=call(); n.extras.putBundle("metadata", android.os.Bundle().apply {putCharSequence("caller",android.text.SpannableString("المتصل: +970591234567"))})
        assertEquals("0591234567",resolve(n).phone)
    }
    @Test fun unknownCallerTickerIsCheckedBeforeFailure() {
        val n=call(); n.tickerText=android.text.SpannableString("المتصل: 0561234567")
        assertEquals("0561234567",resolve(n).phone)
    }
    @Test fun numberInSpannableTelLinkIsLegalReadableMetadata() {
        val n=call()
        val text=android.text.SpannableString("المتصل")
        text.setSpan(android.text.style.URLSpan("tel:+970561234567"),0,text.length,android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        n.extras.putCharSequence(Notification.EXTRA_TITLE,text)
        assertEquals("0561234567",resolve(n).phone)
    }
    @Test fun tickerIncomingEvidenceAllowsPipelineExtraction() {
        val n=call("WhatsApp Business").apply {extras.remove("android.callType");extras.putCharSequence(Notification.EXTRA_TEXT,"Voice call");tickerText="Incoming call: 0591234567"}
        process(n);assertEquals(1,store.pending().size)
    }
    @Test fun inconsistentProviderLinksNeverAttachANameToWrongIdentity() {
        provider(listOf(Row(99,9001,"رمزي دياب")),inconsistentRawLink=true)
        val r=ContactIndex.lookupResult(app,"رمزي دياب")
        assertEquals(ContactIndex.Status.CONTACT_LOOKUP_ERROR,r.status)
        assertEquals("",r.phone);assertTrue(r.detail.contains("INCONSISTENT_PHONE_RAW_LINK"))
    }
    @Test fun unaggregatedRawContactCannotCreateAnInventedAggregate() {
        provider(listOf(Row(0,9001,"رمزي دياب",inContacts=false)))
        assertEquals("",ContactIndex.lookupResult(app,"رمزي دياب").phone)
    }
    @Test fun unknownNameOnlyWaitsForSessionEnrichment() {
        process(call("اسم غير محفوظ"))
        assertTrue(store.pending().isEmpty())
        assertTrue(store.logs().any { it.contains("AWAITING_SESSION_ENRICHMENT") })
    }
    @Test fun namePersonPhoneUpdatesEnrichOneEventAcrossChannels() {
        process(call("اسم غير محفوظ"))
        val id=store.readableDatabase.rawQuery("SELECT id FROM sessions",null).use {assertTrue(it.moveToFirst());it.getString(0)}
        process(call(person=Person.Builder().setName("اسم غير محفوظ").build()))
        process(call(person=Person.Builder().setUri("tel:0591234567").build(),channel="silent"),8)
        repeat(3) { process(call(person=Person.Builder().setUri("tel:0591234567").build(),channel="silent"),8) }
        assertEquals(listOf(id),store.pending().map {it.first})
        assertEquals(1,store.logs().count {it.contains(" QUEUED\n")})
        store.ended("0|com.whatsapp.w4b|8|null|1000","com.whatsapp.w4b")
        assertTrue(store.logs().any {it.contains("CALL_FINISHED")})
        process(call("0591234567"),9)
        assertEquals(2,store.pending().size)
        assertNotEquals(id,store.pending().last().first)
    }
    @Test fun safeComputerProbeSendsZeroBytesAndDoesNotClaimAck() {
        ServerSocket(0).use { server ->
            val worker=Executors.newSingleThreadExecutor()
            try {
                val bytes=worker.submit<Int> {server.accept().use {it.soTimeout=5000;it.getInputStream().read()}}
                CallTcpTransport.probe("127.0.0.1",server.localPort)
                assertEquals(-1,bytes.get(5,TimeUnit.SECONDS).toInt())
                assertTrue(store.pending().isEmpty()); assertEquals("",store.state("last_ack"))
            } finally {worker.shutdownNow()}
        }
    }
    @Test fun tcpFailureRetainsRealEvent() {
        val port=ServerSocket(0).use {it.localPort}
        store.capture("com.whatsapp.w4b","key","0591234567",1000)
        app.getSharedPreferences(NetworkSender.PREFS_NAME,0).edit().putString(NetworkSender.KEY_HOST,"127.0.0.1").putInt(NetworkSender.KEY_PORT,port).commit()
        val latch=java.util.concurrent.CountDownLatch(1)
        LegacyReceiverTestAdapter.advanceRetry(app); NetworkSender.flush(app) {latch.countDown()}; assertTrue(latch.await(8,TimeUnit.SECONDS))
        assertEquals(1,store.pending().size)
        assertTrue(store.logs().any {it.contains(" DELIVERY_FAILED\n")})
        assertFalse(store.logs().any {it.contains(" HTTPS_SENT\n")})
    }
    @Test fun bootAndUpdateRestoreQueueWithoutInventingCalls() {
        val receiver=BootReceiver()
        receiver.onReceive(app,Intent(Intent.ACTION_BOOT_COMPLETED))
        receiver.onReceive(app,Intent(Intent.ACTION_MY_PACKAGE_REPLACED))
        assertTrue(store.pending().isEmpty())
        receiver.onReceive(app,Intent("untrusted.action"));assertTrue(store.pending().isEmpty())
    }
    @Test fun realRebootMustNotLetStaleAckedSessionSwallowNextCall() {
        store.capture("com.whatsapp.w4b","old-key","0591234567",1000)
        val oldId=store.pending().single().first
        store.ack(oldId,"com.whatsapp.w4b","0591234567")
        BootReceiver().onReceive(app,Intent(Intent.ACTION_BOOT_COMPLETED))
        process(call("0591234567"),9)
        assertEquals(1,store.pending().size)
        assertNotEquals(oldId,store.pending().single().first)
    }
    @Test fun rebootPreservesUnacknowledgedPayloadAndReceiverSettings() {
        store.capture("com.whatsapp.w4b","old-key","0591234567",1000)
        val before=store.pending().single()
        app.getSharedPreferences(NetworkSender.PREFS_NAME,0).edit().putString(NetworkSender.KEY_HOST,"127.0.0.1").putInt(NetworkSender.KEY_PORT,1).commit()
        BootReceiver().onReceive(app,Intent(Intent.ACTION_BOOT_COMPLETED))
        assertEquals(listOf(before),store.pending())
        assertEquals("127.0.0.1",app.getSharedPreferences(NetworkSender.PREFS_NAME,0).getString(NetworkSender.KEY_HOST,""))
    }
    private data class SimRow(val sub: Int, val record: Int, val name: String, val phone: String)
    private fun simProvider(rows: List<SimRow>, fail: Boolean=false, nonAdn: Boolean=false) {
        ShadowContentResolver.registerProviderInternal("com.android.simphonebook", object: ContentProvider() {
            override fun onCreate()=true
            override fun query(uri: Uri, projection: Array<out String>?, selection: String?, args: Array<out String>?, sort: String?): Cursor {
                if(fail) throw SecurityException("SIM unavailable")
                val cursor=MatrixCursor(projection!!)
                if(uri == android.provider.SimPhonebookContract.ElementaryFiles.CONTENT_URI) {
                    rows.map {it.sub}.distinct().forEach { sub -> cursor.addRow(arrayOf(sub, if(nonAdn) 3 else 1)) }
                } else {
                    assertFalse("FDN/SDN must not be read",nonAdn)
                    rows.filter {uri == android.provider.SimPhonebookContract.SimRecords.getContentUri(it.sub,1)}.forEach {
                        cursor.addRow(arrayOf<Any?>(it.record,it.name,it.phone))
                    }
                }
                return cursor
            }
            override fun getType(uri: Uri): String?=null
            override fun insert(uri: Uri, values: ContentValues?): Uri?=error("Read only")
            override fun update(uri: Uri, values: ContentValues?, selection: String?, args: Array<out String>?)=error("Read only")
            override fun delete(uri: Uri, selection: String?, args: Array<out String>?)=error("Read only")
        })
    }
    @Test fun simOnlyRamziUsesRealPublicAdnRecordWithoutPhonePermission() {
        simProvider(listOf(SimRow(1,7,"رمزي دياب","+970561234567")))
        val r=ContactIndex.lookupResult(app,"رمزي دياب")
        assertEquals("0561234567",r.phone);assertTrue(r.detail.contains("identitySource=SIM_ADN_RECORD"))
        assertTrue(ContactIndex.permissionGranted(app))
        assertEquals(android.content.pm.PackageManager.PERMISSION_DENIED,app.checkSelfPermission(Manifest.permission.READ_PHONE_STATE))
    }
    @Test fun exactSimMirrorDoesNotMakeImportedContactAmbiguous() {
        provider(listOf(Row(99,9001,"رمزي دياب",phone="0561234567")))
        simProvider(listOf(SimRow(1,7,"رمزي دياب","+970561234567")))
        assertEquals("0561234567",ContactIndex.lookupResult(app,"رمزي دياب").phone)
    }
    @Test fun sameSimNameWithDifferentNumberCompetesInsteadOfGuessing() {
        provider(listOf(Row(99,9001,"رمزي دياب",phone="0591234567")))
        simProvider(listOf(SimRow(1,7,"رمزي دياب","0561234567")))
        assertEquals(CContactAmbiguous,ContactIndex.lookupResult(app,"رمزي دياب").status)
    }
    @Test fun dualSimSameRecordNumberDoesNotConflateDistinctIdentities() {
        simProvider(listOf(SimRow(1,7,"رمزي دياب","0591234567"),SimRow(2,7,"رمزي دياب","0561234567")))
        assertEquals(CContactAmbiguous,ContactIndex.lookupResult(app,"رمزي دياب").status)
    }
    @Test fun dualSimDifferentNamesCanResolveIndependently() {
        simProvider(listOf(SimRow(1,7,"رمزي دياب","0591234567"),SimRow(2,7,"خالد دياب","0561234567")))
        assertEquals("0591234567",ContactIndex.lookupResult(app,"رمزي دياب").phone)
        assertEquals("0561234567",ContactIndex.lookupResult(app,"خالد دياب").phone)
    }
    @Test fun unavailableSimProviderDoesNotBreakOrdinaryContacts() {
        provider(listOf(Row(99,9001,"رمزي دياب")));simProvider(emptyList(),fail=true)
        val r=ContactIndex.lookupResult(app,"رمزي دياب")
        assertEquals("0591234567",r.phone);assertTrue(r.detail.contains("simStatus=ACCESS_DENIED"))
    }
    @Test fun serviceAndFixedDialingSimFilesAreNotCallerContacts() {
        simProvider(listOf(SimRow(1,7,"رمزي دياب","0561234567")),nonAdn=true)
        assertEquals("",ContactIndex.lookupResult(app,"رمزي دياب").phone)
    }
    @Test @Config(sdk=[24]) fun simPublicApiUnavailableOnOlderAndroidIsExplicit() {
        assertEquals("API_UNSUPPORTED",SimContactIndex.read(app).status)
    }
    @Test fun mergedManifestDoesNotExposePreviewOrTestHostOrBootReceiver() {
        @Suppress("DEPRECATION")
        val host=app.packageManager.getActivityInfo(android.content.ComponentName(app,"androidx.activity.ComponentActivity"),0)
        assertFalse(host.exported)
        @Suppress("DEPRECATION")
        val boot=app.packageManager.getReceiverInfo(android.content.ComponentName(app,BootReceiver::class.java),0)
        assertFalse(boot.exported)
        @Suppress("DEPRECATION")
        val preview=runCatching {app.packageManager.getActivityInfo(android.content.ComponentName(app,"androidx.compose.ui.tooling.PreviewActivity"),0)}
        assertTrue(preview.isFailure)
    }
    @Test fun wrongAckIsDistinctFromTcpFailureAndRetainsEvent() {
        ServerSocket(0).use {server ->
            val worker=Executors.newSingleThreadExecutor()
            try {
                val received=worker.submit<String> {server.accept().use {
                    it.soTimeout=5000
                    val line=it.getInputStream().bufferedReader().readLine()
                    it.getOutputStream().write("OK wrong-event\n".toByteArray());line
                }}
                store.capture("com.whatsapp.w4b","key","0591234567",1000)
                val original=store.pending().single()
                app.getSharedPreferences(NetworkSender.PREFS_NAME,0).edit().putString(NetworkSender.KEY_HOST,"127.0.0.1").putInt(NetworkSender.KEY_PORT,server.localPort).commit()
                val done=java.util.concurrent.CountDownLatch(1)
                LegacyReceiverTestAdapter.advanceRetry(app); NetworkSender.flush(app) {done.countDown()};assertTrue(done.await(8,TimeUnit.SECONDS))
                assertEquals(original.second,received.get(5,TimeUnit.SECONDS));assertEquals(listOf(original),store.pending())
                assertTrue(store.logs().any {it.contains(" DELIVERY_FAILED\n") && it.contains("eventId=${original.first}")})
                assertEquals(1,store.logs().count {it.contains(" SENT\n")})
                assertEquals("",store.state("last_ack"))
            } finally {worker.shutdownNow()}
        }
    }
    @Test fun numberInTickerSpannableUriIsInspected() {
        val text=android.text.SpannableString("Incoming call")
        text.setSpan(android.text.style.URLSpan("tel:0561234567"),0,text.length,android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        assertEquals("0561234567",resolve(call().apply {tickerText=text}).phone)
    }
}
