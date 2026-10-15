package com.maktab.calls

import android.Manifest
import android.app.Application
import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.provider.ContactsContract as C
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RuntimeEnvironment
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowContentResolver

/** Probe output/privacy/error-handling contracts only. These are NOT evidence about TECNO's data. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35])
class ContactsProviderProbeAndroidTest {
    private lateinit var app: Application
    private var contacts=emptyList<Map<String,Any?>>()
    private var raws=emptyList<Map<String,Any?>>()
    private var phones=emptyList<Map<String,Any?>>()
    private var data=emptyList<Map<String,Any?>>()
    private var filterContacts=emptyList<Map<String,Any?>>()
    private var pickedContacts=emptyList<Map<String,Any?>>()
    private var failPhones=false
    private var hideProjectedPhoneName=false
    private var rejectJoinedData=false
    private var reads=0
    private val target="رمزي دياب"
    private val phone="+970598765432"
    private val accountSecret="private-account@example.com"
    private val lookupSecret="private-lookup-key"
    private val columns=listOf("_id","contact_id","raw_contact_id","display_name","display_name_alt","display_name_primary",
        "lookup","deleted","aggregation_mode","account_type","account_name","mimetype","name_raw_contact_id")+(1..14).map {"data$it"}
    @Before fun setup() {
        app=RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.READ_CONTACTS)
        ShadowContentResolver.registerProviderInternal(C.AUTHORITY,object: ContentProvider() {
            override fun onCreate()=true
            override fun query(uri: Uri, projection: Array<out String>?, selection: String?, args: Array<out String>?, sort: String?): Cursor {
                reads++
                if(failPhones && uri == C.CommonDataKinds.Phone.CONTENT_URI) throw SecurityException("$phone $accountSecret")
                if(rejectJoinedData && uri == C.Data.CONTENT_URI && projection?.contains("display_name") == true) throw IllegalArgumentException("$phone $lookupSecret")
                val rows=when {
                    uri == C.Contacts.CONTENT_URI -> contacts
                    uri == C.RawContacts.CONTENT_URI -> raws
                    uri == C.CommonDataKinds.Phone.CONTENT_URI -> phones
                    uri == C.Data.CONTENT_URI -> if(selection != null) data.filter {it["mimetype"] == args?.single()} else data
                    uri.path.orEmpty().startsWith("/contacts/filter/") -> filterContacts
                    uri.path.orEmpty().startsWith("/contacts/") -> pickedContacts
                    else -> emptyList()
                }
                val cols=projection?.toList() ?: columns
                return MatrixCursor(cols.toTypedArray()).apply {rows.forEach {row -> addRow(cols.map {col ->
                    if(hideProjectedPhoneName && uri == C.CommonDataKinds.Phone.CONTENT_URI && projection != null && col.startsWith("display_name")) ""
                    else row[col]
                }.toTypedArray())}}
            }
            override fun getType(uri: Uri): String?=null
            override fun insert(uri: Uri,values: ContentValues?): Uri?=error("Probe must never write")
            override fun delete(uri: Uri,selection: String?,args: Array<out String>?): Int=error("Probe must never write")
            override fun update(uri: Uri,values: ContentValues?,selection: String?,args: Array<out String>?): Int=error("Probe must never write")
        })
    }
    private fun row(name: String=target)=mapOf<String,Any?>("_id" to 99L,"contact_id" to 99L,"raw_contact_id" to 11L,
        "display_name" to name,"data1" to phone,"lookup" to lookupSecret)
    private fun raw(name: String=target,deleted: Int=0)=row(name)+mapOf("_id" to 11L,"deleted" to deleted,
        "account_type" to "com.google","account_name" to accountSecret,"aggregation_mode" to 0)
    private fun report()=ContactsProviderProbe.read(app,listOf(target)).text
    private fun privateValuesAbsent(value: String) {
        listOf(phone,"0598765432",accountSecret,lookupSecret,"شوقي دياب").forEach {assertFalse("Leaked $it",value.contains(it))}
    }
    @Test fun reportsExactNameFromPhoneRowWithoutDependingOnStructuredNames() {
        phones=listOf(row());raws=listOf(raw("Other name"))
        val r=report()
        assertTrue(r.contains("exactNameSeenInPhoneRows=true"));assertTrue(r.contains("exactNameSeenInStructuredName=false"))
        assertTrue(r.contains("contactId=99"));assertTrue(r.contains("rawContactLinkage=VERIFIED"))
        assertTrue(r.contains("phoneRowCount=1"));assertTrue(r.contains("hasValidPhone=true"))
        assertTrue(r.contains("EXACT_ALIAS_EXPECTED_IN_251_INDEX_RECHECK_SNAPSHOT"));privateValuesAbsent(r)
    }
    @Test fun pinpointsProjectionSpecificNameDifferenceWithoutChangingMatching() {
        phones=listOf(row());hideProjectedPhoneName=true
        val r=report()
        assertTrue(r.contains("exactNameSeenInPhoneRows=true"))
        assertTrue(r.contains("source=PhoneRowsCurrent251; rows=1; queryComplete=true; exactNameSeen=false"))
        assertTrue(r.contains("NOT_EXACT_IN_CURRENT_PROJECTION"));privateValuesAbsent(r)
    }
    @Test fun recordsDeletedRawLinkInsteadOfSilentlyDroppingTargetEvidence() {
        raws=listOf(raw(deleted=1));phones=listOf(row())
        val r=report()
        assertTrue(r.contains("exactNameSeenInRawContacts=true"));assertTrue(r.contains("rawContactLinkage=DELETED"))
        assertTrue(r.contains("index251Reason=DELETED_RAW_CONTACT"));privateValuesAbsent(r)
    }
    @Test fun recordsUnaggregatedStructuredIdentityAndOrphanReason() {
        raws=listOf(raw("Other name")+mapOf("contact_id" to null))
        data=listOf(row("Other name")+mapOf("data1" to target,"mimetype" to C.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE))
        val r=report()
        assertTrue(r.contains("exactNameSeenInStructuredName=true"));assertTrue(r.contains("rawContactLinkage=UNAGGREGATED"))
        assertTrue(r.contains("ORPHAN_STRUCTURED_ROW"));privateValuesAbsent(r)
    }
    @Test fun distinguishesNicknameOrOtherDataFromTrustedIndexAlias() {
        data=listOf(row("Other name")+mapOf("data1" to target,"mimetype" to C.CommonDataKinds.Nickname.CONTENT_ITEM_TYPE))
        val r=report()
        assertTrue(r.contains("exactNameSeenInDataRows=true"));assertTrue(r.contains("exactNameSeenInContacts=false"))
        assertTrue(r.contains("dataKind=NICKNAME"));assertTrue(r.contains("DATA_COLUMNS_NOT_READ_AS_NAME_BY_251"));privateValuesAbsent(r)
    }
    @Test fun fallbackKeepsDataExactEvidenceAndRedactsProviderExceptionMessage() {
        rejectJoinedData=true
        data=listOf(row("Other name")+mapOf("data1" to target,"mimetype" to C.CommonDataKinds.Nickname.CONTENT_ITEM_TYPE))
        val r=report()
        assertTrue(r.contains("exactNameSeenInDataRows=true"));assertTrue(r.contains("source=DataMinimal"))
        assertTrue(r.contains("error=IllegalArgumentException"));privateValuesAbsent(r)
    }
    @Test fun queryFailureCannotMasqueradeAsNameAbsent() {
        failPhones=true
        val r=report()
        assertTrue(r.contains("exactNameSeenInPhoneRows=UNKNOWN"));assertTrue(r.contains("error=SecurityException"));privateValuesAbsent(r)
    }
    @Test fun accountTypesAndLinkedCountsDoNotExposeAccountNamesOrKeys() {
        contacts=listOf(row());phones=listOf(row())
        raws=listOf(raw(),raw()+mapOf("_id" to 12L,"account_type" to "com.whatsapp"))
        val r=report()
        assertTrue(r.contains("linkedRawCount=2"));assertTrue(r.contains("accountType=GOOGLE"))
        assertTrue(r.contains("accountType=WHATSAPP"));assertTrue(r.contains("accountNamePresent=true"));privateValuesAbsent(r)
    }
    @Test fun deniedPermissionDoesNotReadAnyProvider() {
        shadowOf(app).denyPermissions(Manifest.permission.READ_CONTACTS)
        assertTrue(report().contains("probe=NOT_STARTED"));assertEquals(0,reads)
    }
    @Test fun selectedContactAndFilterCanExposeAVisibilityDifference() {
        filterContacts=listOf(row());pickedContacts=listOf(row())
        val r=ContactsProviderProbe.read(app,listOf(target),Uri.withAppendedPath(C.Contacts.CONTENT_URI,"99")).text
        assertTrue(r.contains("exactNameSeenInContacts=false"))
        assertTrue(r.contains("source=PickedContacts; rows=1; queryComplete=true; exactNameSeen=true"))
        assertTrue(r.contains("COMPARE_WITH_UNFILTERED_SOURCE"));privateValuesAbsent(r)
    }
    @Test fun arbitrarySelectedUriIsNotQueriedAndNotSerialized() {
        val r=ContactsProviderProbe.read(app,listOf(target),Uri.parse("content://other/private/$phone?account=$accountSecret")).text
        assertTrue(r.contains("NOT_OFFICIAL_CONTACTS_URI"));privateValuesAbsent(r)
    }
    @Test fun probeIsReadOnlyAndNeverQueuesOrDeliversACall() {
        val store=CallStore.get(app);val before=store.pending()
        phones=listOf(row())
        report()
        assertEquals(before,store.pending());assertEquals("",store.state("last_ack"))
    }
    @Test fun tracksNameOwnerSeparatelyFromPhoneOwnerAndRecognizesDataPhonePresence() {
        contacts=listOf(row()+mapOf("name_raw_contact_id" to 12L))
        raws=listOf(raw("Other"),raw()+mapOf("_id" to 12L,"account_type" to "com.whatsapp"))
        data=listOf(row("Other")+mapOf("mimetype" to C.CommonDataKinds.Phone.CONTENT_ITEM_TYPE))
        val r=report()
        assertTrue(r.contains("nameRawContactId=12; nameRawContactLinkage=VERIFIED; nameAccountType=WHATSAPP"))
        assertTrue(r.contains("dataPhoneRowCount=1; hasValidPhone=true"));privateValuesAbsent(r)
    }
}
