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

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class WhatsApp249AndroidTest {
    private data class Contact(val id: Long, val display: String, val phones: List<String> = listOf("0591234567"),
        val structured: String = display, val given: String = "", val middle: String = "", val family: String = "",
        val prefix: String = "", val suffix: String = "")
    private lateinit var app: Application
    private lateinit var store: CallStore
    @Before fun setup() {
        app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.READ_CONTACTS)
        store = CallStore.get(app)
        listOf("outbox", "sessions", "aliases", "diagnostics", "state", "delivery").forEach { store.writableDatabase.delete(it, null, null) }
        provider(emptyList())
    }
    private fun provider(contacts: List<Contact>, orphan: Boolean = false) {
        ShadowContentResolver.registerProviderInternal(ContactsContract.AUTHORITY, object : ContentProvider() {
            override fun onCreate() = true
            override fun query(uri: Uri, projection: Array<out String>?, selection: String?, args: Array<out String>?, sort: String?): Cursor {
                val fields = projection!!
                val cursor = MatrixCursor(fields)
                when (uri) {
                    ContactsContract.Contacts.CONTENT_URI -> contacts.forEach { c -> cursor.addRow(fields.map { f -> when (f) {
                        ContactsContract.Contacts._ID -> c.id
                        ContactsContract.Contacts.LOOKUP_KEY -> "lookup-${c.id}"
                        else -> c.display
                    } }.toTypedArray()) }
                    ContactsContract.RawContacts.CONTENT_URI -> contacts.forEach { c -> cursor.addRow(fields.map<String,Any?> {f -> when(f) {
                        ContactsContract.RawContacts._ID -> c.id+5000
                        ContactsContract.RawContacts.CONTACT_ID -> c.id
                        ContactsContract.RawContacts.DELETED -> 0
                        else -> c.display
                    } }.toTypedArray()) }
                    ContactsContract.Data.CONTENT_URI -> {
                        assertEquals(S.CONTENT_ITEM_TYPE, args?.single())
                        fun add(c: Contact) { cursor.addRow(fields.map { f -> when (f) {
                            ContactsContract.Data.CONTACT_ID -> c.id
                            ContactsContract.Data.RAW_CONTACT_ID -> c.id + 5000
                            S.DISPLAY_NAME -> c.structured
                            S.GIVEN_NAME -> c.given
                            S.MIDDLE_NAME -> c.middle
                            S.FAMILY_NAME -> c.family
                            S.PREFIX -> c.prefix
                            S.SUFFIX -> c.suffix
                            else -> null
                        } }.toTypedArray()) }
                        contacts.forEach(::add)
                        if (orphan) add(Contact(9999, "Orphan", given = "احمد", family = "علي"))
                    }
                    ContactsContract.CommonDataKinds.Phone.CONTENT_URI -> {
                        if(selection == null) {
                            contacts.filter {it.phones.isNotEmpty()}.forEach {c -> cursor.addRow(fields.map<String,Any?> {f -> when(f) {
                                ContactsContract.Data.CONTACT_ID -> c.id
                                ContactsContract.Data.RAW_CONTACT_ID -> c.id+5000
                                ContactsContract.CommonDataKinds.Phone.NUMBER -> c.phones.firstOrNull()
                                ContactsContract.Contacts.LOOKUP_KEY -> "lookup-${c.id}"
                                else -> c.display
                            } }.toTypedArray()) }
                            return cursor
                        }
                        assertEquals("${ContactsContract.CommonDataKinds.Phone.CONTACT_ID} = ?", selection)
                        contacts.filter { it.id.toString() == args?.single() }.flatMap { it.phones }.forEach { cursor.addRow(arrayOf(it)) }
                    }
                    else -> {
                        val id = if (uri.pathSegments.contains("lookup")) uri.lastPathSegment?.substringAfter("lookup-")?.toLongOrNull()
                            else if (uri.pathSegments.firstOrNull() == "data") 42L else uri.lastPathSegment?.toLongOrNull()
                        contacts.filter { it.id == id }.forEach { c -> cursor.addRow(fields.map { f -> when (f) {
                            ContactsContract.Contacts._ID, ContactsContract.Data.CONTACT_ID -> c.id
                            ContactsContract.Contacts.LOOKUP_KEY -> "lookup-${c.id}"
                            ContactsContract.Data.MIMETYPE -> ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE
                            ContactsContract.CommonDataKinds.Phone.NUMBER -> c.phones.lastOrNull()
                            else -> null
                        } }.toTypedArray()) }
                    }
                }
                return cursor
            }
            override fun getType(uri: Uri): String? = null
            override fun insert(uri: Uri, values: ContentValues?): Uri? = null
            override fun delete(uri: Uri, selection: String?, args: Array<out String>?) = 0
            override fun update(uri: Uri, values: ContentValues?, selection: String?, args: Array<out String>?) = 0
        })
    }
    private fun call(title: String = "WhatsApp Business", person: Person? = null): Notification =
        Notification.Builder(app, "voip_notification_7").setSmallIcon(android.R.drawable.sym_call_incoming)
            .setCategory(Notification.CATEGORY_CALL).setContentTitle(title).setContentText("Incoming voice call").build().apply {
                extras.putInt("android.callType", 1)
                if (person != null) extras.putParcelable("android.callPerson", person)
            }
    private fun resolve(n: Notification) = NotificationCallIdentity.resolve(listOf(n), emptyList(), app)
    private fun process(n: Notification) = Robolectric.buildService(WhatsAppNotificationListener::class.java).create().get().processSafely(
        StatusBarNotification("com.whatsapp.w4b", "com.whatsapp.w4b", 7, null, 1000, 0, 0, n, UserHandle.getUserHandleForUid(0), 1000))
    private fun nameMatches(saved: String, whatsapp: String): ContactIndex.Result {
        provider(listOf(Contact(42, saved)))
        val result = ContactIndex.lookupResult(app, whatsapp)
        assertEquals("0591234567", result.phone)
        return result
    }
    @Test fun exactRawSavedName() { assertTrue(nameMatches("احمد علي", "احمد علي").detail.contains("matchingStage=EXACT_RAW")) }
    @Test fun differentSpaces() { nameMatches("احمد\u00a0  علي", " احمد\tعلي ") }
    @Test fun alefVariants() { listOf("أحمد", "إحمد", "آحمد", "ٱحمد", "ا\u0654حمد").forEach { nameMatches("$it علي", "احمد علي") } }
    @Test fun alefMaqsuraAndYeh() { nameMatches("مصطفى علي", "مصطفي علي") }
    @Test fun arabicDiacritics() { nameMatches("أَحْمَد عَلِيّ", "احمد علي") }
    @Test fun tatweel() { nameMatches("احــــمد علـي", "احمد علي") }
    @Test fun zeroWidthCharacters() { nameMatches("اح\u200bمد ع\u200cل\u200dي", "احمد علي") }
    @Test fun hiddenDirectionMarks() { nameMatches("\u061c\u2067احمد\u2069 \u200fعلي\u202e", "احمد علي") }
    @Test fun punctuationAndSymbols() { nameMatches("احمد—علي (المكتب)", "احمد علي المكتب") }
    @Test fun emojiNextToCallerName() { nameMatches("احمد علي", "📞 احمد علي 😊") }
    @Test fun compoundArabicName() { nameMatches("عبد الرحمن ابو خالد", "عبدالرحمن ابوخالـد") }
    @Test fun safeUniqueWordOrder() { assertTrue(nameMatches("احمد خالد سليمان", "سليمان احمد خالد").detail.contains("SAFE_TOKENS")) }
    @Test fun structuredComponentsWhenAggregateAndStructuredDisplayDiffer() {
        provider(listOf(Contact(42, "Nickname", structured = "Other label", given = "احمد", middle = "خالد", family = "سليمان")))
        val r = ContactIndex.lookupResult(app, "احمد خالد سليمان")
        assertEquals("0591234567", r.phone); assertTrue(r.detail.contains("EXACT_STRUCTURED_ALIAS"))
    }
    @Test fun directPersonContactUriIgnoresDifferentDisplayName() {
        provider(listOf(Contact(42, "Different name")))
        val r = resolve(call(person = Person.Builder().setName("Wrong label").setUri("content://com.android.contacts/contacts/42").build()))
        assertEquals("0591234567", r.phone); assertTrue(r.detail.contains("DIRECT_CONTACT_URI"))
    }
    @Test fun phoneInPersonUriDoesNotNeedContacts() {
        shadowOf(app).denyPermissions(Manifest.permission.READ_CONTACTS)
        assertEquals("0561234567", resolve(call(person = Person.Builder().setUri("tel:+970561234567").build())).phone)
    }
    @Test fun directPhoneInCallTitlePrecedesContactLookup() {
        provider(listOf(Contact(42, "Different name")))
        val r = resolve(call("0561234567", Person.Builder().setUri("content://com.android.contacts/contacts/42").build()))
        assertEquals("0561234567", r.phone); assertTrue(r.detail.contains("DIRECT_NUMBER"))
    }
    @Test fun linkedContactWithNoPhoneCannotFallbackToAnotherName() {
        provider(listOf(Contact(42, "Different name", emptyList()), Contact(2, "احمد علي", listOf("0561234567"))))
        assertEquals("", resolve(call("احمد علي", Person.Builder().setName("احمد علي").setUri("content://com.android.contacts/contacts/42").build())).phone)
    }
    @Test fun international970ContactPhone() {
        listOf("+97059 123-4567" to "0591234567", "970591234567" to "0591234567", "00970591234567" to "0591234567",
            "+97056 123-4567" to "0561234567", "970561234567" to "0561234567", "00970561234567" to "0561234567").forEach { (phone, expected) ->
            provider(listOf(Contact(42, "احمد علي", listOf(phone))))
            assertEquals(expected, ContactIndex.lookupResult(app, "احمد علي").phone)
        }
    }
    @Test fun local059ContactPhone() { provider(listOf(Contact(42, "احمد علي", listOf("0591234567")))); assertEquals("0591234567", resolve(call("احمد علي")).phone) }
    @Test fun local056ContactPhone() { provider(listOf(Contact(42, "احمد علي", listOf("0561234567")))); assertEquals("0561234567", resolve(call("احمد علي")).phone) }
    @Test fun multiplePhoneRowsAreNotRandomlySelected() {
        provider(listOf(Contact(42, "احمد علي", listOf("0591234567", "0561234567"))))
        assertEquals(ContactIndex.Status.CONTACT_AMBIGUOUS, ContactIndex.lookupResult(app, "احمد علي").status)
        assertEquals("0561234567", ContactIndex.lookupNames(app, listOf("احمد علي"), setOf("+970561234567")).phone)
        assertEquals("", ContactIndex.lookupNames(app, listOf("احمد علي"), setOf("0597654321")).phone)
    }
    @Test fun exactFullNameHasPriorityOverFuzzyNeighbour() {
        provider(listOf(Contact(1, "Alexander Jonathan Anderson"), Contact(2, "Alexander Jonathan Andersan", listOf("0561234567"))))
        process(call("Alexander Jonathan Anderson"))
        assertEquals("0591234567",org.json.JSONObject(store.pending().single().second).getString("number"))
        assertTrue(store.logs().any {it.contains("matchedContacts=1")})
    }
    @Test fun duplicateFullNamesNeverQueueWrongNumber() {
        provider(listOf(Contact(1, "احمد علي"), Contact(2, "احمد علي", listOf("0561234567"))))
        process(call("احمد علي")); assertTrue(store.pending().isEmpty())
    }
    @Test fun unsavedCallerNumberInNotification() {
        process(call("المتصل: 0591234567")); assertEquals(1, store.pending().size)
        assertTrue(store.pending().single().second.contains("0591234567"))
    }
    @Test fun noNumberNoReliableContactClearlyFails() {
        process(call("اسم غير موجود")); assertTrue(store.pending().isEmpty())
        assertTrue(store.logs().any { it.contains("EXTRACTION_FAILED") && it.contains("matchingStage=NO_SAFE_MATCH") })
    }
    @Test fun actualRegression237RowsSavedContactDifferentCallerName() {
        val contacts = (1L..235L).map { Contact(it, "جهة تجريبية $it") } +
            Contact(236, "رقم ناجح", listOf("0597654321")) +
            Contact(237, "مصطفى خالد سليمان", listOf("+970561234567"))
        provider(contacts)
        assertEquals("0597654321", resolve(call("رقم ناجح")).phone)
        val r = resolve(call(person = Person.Builder().setName(" سليمان\u200f مُصْطَفـي   خالد 😊").build()))
        assertEquals("0561234567", r.phone)
        listOf("permission=GRANTED", "nameFound=true", "contactRows=237", "structuredRows=237", "matchedContacts=1", "SAFE_TOKENS").forEach { assertTrue(it, r.detail.contains(it)) }
    }
    @Test fun failureLogContainsTopThreeCandidatesAndMetadataOnly() {
        provider((1L..10L).map { Contact(it, "مرشح مختلف $it") })
        process(call(person = Person.Builder().setName("\u200fاسم لا يطابق").setKey("opaque-caller-key").build()))
        val log = store.logs().single { it.contains("EXTRACTION_FAILED") }
        listOf("eventId=", "package=com.whatsapp.w4b", "id=7", "category=call", "channel=voip_notification_7", "source=CONTACT_NOT_FOUND",
            "personPresent=true", "personKey=true", "personUri=false", "rawWhatsAppName=", "normalizedWhatsAppName=", "permission=GRANTED", "contactRows=10", "structuredRows=10",
            "matchedContacts=0", "matchingStage=", "candidate1=", "candidate2=", "candidate3=", "score=", "rejected=").forEach { assertTrue(it, log.contains(it)) }
        assertFalse(log.contains("candidate4=")); assertFalse(log.contains("opaque-caller-key")); assertTrue(log.contains("\\u200f"))
        assertEquals(3, Regex("candidate[0-9]=").findAll(log).count())
    }
    @Test fun taMarbutaIsFlexibleOnlyAndCollisionsAreRejected() {
        assertNotEquals(ContactIndex.matchingKey("فاطمة علي"), ContactIndex.matchingKey("فاطمه علي"))
        assertTrue(nameMatches("فاطمة علي", "فاطمه علي").detail.contains("FLEXIBLE_TA_MARBUTA"))
        provider(listOf(Contact(1, "فاطمة علي"), Contact(2, "فاطمه علي", listOf("0561234567"))))
        assertEquals(ContactIndex.Status.CONTACT_AMBIGUOUS, ContactIndex.lookupResult(app, "فاطمة علي").status)
    }
    @Test fun englishCaseUnicodeDigitsAndCanonicalForms() {
        nameMatches("Ａｌｉｃｅ SMITH ١٢", "alice smith 12")
        nameMatches("José Smith", "Jose\u0301 Smith")
        assertNotEquals(ContactIndex.matchingKey("José Smith"), ContactIndex.matchingKey("Jose Smith"))
    }
    @Test fun tokenCollisionIsRejectedEvenWithOneExactRawName() {
        provider(listOf(Contact(1, "احمد خالد سليمان"), Contact(2, "سليمان احمد خالد", listOf("0561234567"))))
        assertEquals(ContactIndex.Status.CONTACT_AMBIGUOUS, ContactIndex.lookupResult(app, "احمد خالد سليمان").status)
    }
    @Test fun genericTokensAndPartialNamesAreInsufficient() {
        provider(listOf(Contact(1, "السيد الحاج احمد خالد")))
        assertEquals("", ContactIndex.lookupResult(app, "الحاج السيد").phone)
        assertEquals("", ContactIndex.lookupResult(app, "احمد خالد").phone)
    }
    @Test fun onlyKnownTrailingWhatsAppDescriptionCanBeRemoved() {
        nameMatches("احمد خالد سليمان", "احمد خالد سليمان WhatsApp Business")
        assertEquals("", ContactIndex.lookupResult(app, "احمد خالد سليمان شخص آخر").phone)
    }
    @Test fun uniqueLongNameOneTypoWithStrongAnchors() {
        provider(listOf(Contact(1,"Alexander Jonathan Anderson")))
        assertEquals("",ContactIndex.lookupResult(app,"Alexander Jonathan Andersom").phone)
    }
    @Test fun fuzzyRunnerUpMarginPreventsGuessing() {
        provider(listOf(Contact(1, "Alexander Jonathan Anderson"), Contact(2, "Alexander Jonathan Andersan", listOf("0561234567"))))
        assertEquals(ContactIndex.Status.CONTACT_NOT_FOUND, ContactIndex.lookupResult(app, "Alexander Jonathan Andersom").status)
    }
    @Test fun shortTyposAndChangedNumericNamePartsAreRejected() {
        provider(listOf(Contact(1, "Ali Smith")))
        assertEquals("", ContactIndex.lookupResult(app, "Ali Smoth").phone)
        provider(listOf(Contact(1, "Alexander Jonathan Anderson 1")))
        assertEquals("", ContactIndex.lookupResult(app, "Alexander Jonathan Anderson 2").phone)
    }
    @Test fun structuredPrefixSuffixAndRawContactLink() {
        provider(listOf(Contact(42, "Nickname", structured = "", given = "احمد", middle = "خالد", family = "سليمان", prefix = "دكتور", suffix = "الصغير")), orphan = true)
        assertEquals("0591234567", ContactIndex.lookupResult(app, "دكتور احمد خالد سليمان الصغير").phone)
        assertEquals("", ContactIndex.lookupResult(app, "احمد علي").phone)
    }
    @Test fun dataPhoneUriSelectsItsExactPhoneRow() {
        provider(listOf(Contact(42, "Different name", listOf("0591234567", "0561234567"))))
        val r = resolve(call(person = Person.Builder().setUri("content://com.android.contacts/data/phones/700").build()))
        assertEquals("0561234567", r.phone); assertTrue(r.detail.contains("EXACT_URI_HINT"))
    }
    @Test fun contactLookupUriUsesProviderLink() {
        provider(listOf(Contact(42, "Different name")))
        assertEquals("0591234567", resolve(call(person = Person.Builder().setUri("content://com.android.contacts/contacts/lookup/lookup-42").build())).phone)
    }
    @Test fun personKeyOfficialContactUriAndBundlePerson() {
        provider(listOf(Contact(42, "Different name")))
        assertEquals("0591234567", resolve(call(person = Person.Builder().setKey("content://com.android.contacts/contacts/42").build())).phone)
        val n = call(); n.extras.putBundle("android.callPerson", Bundle().apply { putString("name", "Different name"); putString("uri", "content://com.android.contacts/contacts/42") })
        assertEquals("0591234567", resolve(n).phone)
    }
    @Test fun opaquePersonKeysCannotBeGuessedAsContactIds() {
        provider(listOf(Contact(42, "Different name")))
        assertEquals("", resolve(call(person = Person.Builder().setKey("42").setName("Unrelated label").build())).phone)
    }
    @Test fun personNameHasPriorityOverUnrelatedRenderedTitle() {
        provider(listOf(Contact(1, "احمد علي"), Contact(2, "خالد سالم", listOf("0561234567"))))
        assertEquals("0591234567", resolve(call("خالد سالم", Person.Builder().setName("احمد علي").build())).phone)
    }
    @Test fun landlineAndPhoneDirectionFormattingRemainSupported() {
        provider(listOf(Contact(42, "احمد علي", listOf("\u200f+970 (9) 123-4567\u2069"))))
        assertEquals("091234567", ContactIndex.lookupResult(app, "احمد علي").phone)
    }
    @Test fun unchangedPhoneAfterLateRepeatedUpdatesQueuesOnlyOnce() {
        provider(listOf(Contact(42, "مصطفى خالد سليمان")))
        repeat(3) { process(call("سليمان مصطفي خالد")) }
        assertEquals(1, store.pending().size)
        assertEquals(1, store.logs().count { it.contains(" QUEUED\n") })
        assertTrue(store.logs().none { it.contains("rawWhatsAppName=") })
    }
}
