package com.maktab.calls

import android.Manifest
import android.app.Application
import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.provider.ContactsContract
import org.junit.Assert.*
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowContentResolver

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ContactLookupAndroidTest {
    private val realName = "درج ام الاسد شارع القدس"
    private data class Contact(val id: Long, val name: String, val phones: List<String>, val alternative: String = name, val structured: String? = null)
    private class PhoneProvider(private val contacts: List<Contact>, private val fail: Boolean = false, private val security: Boolean = false) : ContentProvider() {
        var queries = 0
        override fun onCreate() = true
        override fun query(uri: Uri, projection: Array<out String>?, selection: String?, args: Array<out String>?, sort: String?): Cursor {
            queries++
            if (security) throw SecurityException("restricted provider")
            if (fail) throw IllegalArgumentException("provider unavailable")
            val fields = projection!!.toList()
            val cursor = MatrixCursor(projection)
            if (uri == ContactsContract.Contacts.CONTENT_URI) {
                assertNull(selection); assertNull(args)
                assertEquals(setOf(ContactsContract.Contacts._ID, ContactsContract.Contacts.LOOKUP_KEY, ContactsContract.Contacts.DISPLAY_NAME_PRIMARY, ContactsContract.Contacts.DISPLAY_NAME_ALTERNATIVE), fields.toSet())
                contacts.forEach { contact -> cursor.addRow(fields.map<String, Any?> { column -> when (column) {
                    ContactsContract.Contacts._ID -> contact.id
                    ContactsContract.Contacts.LOOKUP_KEY -> "lookup-${contact.id}"
                    ContactsContract.Contacts.DISPLAY_NAME_PRIMARY -> contact.name
                    ContactsContract.Contacts.DISPLAY_NAME_ALTERNATIVE -> contact.alternative
                    else -> error("Unexpected contacts field")
                } }.toTypedArray()) }
            } else if (uri == ContactsContract.RawContacts.CONTENT_URI) {
                contacts.forEach { c -> cursor.addRow(fields.map<String, Any?> { f -> when(f) {
                    ContactsContract.RawContacts._ID -> c.id+1000
                    ContactsContract.RawContacts.CONTACT_ID -> c.id
                    ContactsContract.RawContacts.DELETED -> 0
                    ContactsContract.RawContacts.DISPLAY_NAME_ALTERNATIVE -> c.alternative
                    else -> c.name
                } }.toTypedArray()) }
            } else if (uri == ContactsContract.CommonDataKinds.Phone.CONTENT_URI && selection == null) {
                contacts.filter { it.phones.isNotEmpty() }.forEach { c -> cursor.addRow(fields.map<String, Any?> { f -> when(f) {
                    ContactsContract.Data.CONTACT_ID -> c.id
                    ContactsContract.Data.RAW_CONTACT_ID -> c.id+1000
                    ContactsContract.CommonDataKinds.Phone.NUMBER -> c.phones.firstOrNull()
                    ContactsContract.Contacts.LOOKUP_KEY -> "lookup-${c.id}"
                    ContactsContract.Contacts.DISPLAY_NAME_ALTERNATIVE -> c.alternative
                    else -> c.name
                } }.toTypedArray()) }
            } else if (uri == ContactsContract.Data.CONTENT_URI) {
                assertEquals("${ContactsContract.Data.MIMETYPE} = ?", selection)
                assertEquals(ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE, args?.single())
                contacts.filter { it.structured != null }.forEach { contact -> cursor.addRow(fields.map<String, Any?> { column -> when (column) {
                    ContactsContract.Data.CONTACT_ID -> contact.id
                    ContactsContract.Data.RAW_CONTACT_ID -> contact.id + 1000
                    ContactsContract.CommonDataKinds.StructuredName.DISPLAY_NAME -> contact.structured
                    else -> null
                } }.toTypedArray()) }
            } else {
                assertEquals(ContactsContract.CommonDataKinds.Phone.CONTENT_URI, uri)
                assertEquals("${ContactsContract.CommonDataKinds.Phone.CONTACT_ID} = ?", selection)
                assertEquals(listOf(ContactsContract.CommonDataKinds.Phone.NUMBER), fields)
                contacts.filter { it.id.toString() == args?.single() }.flatMap { it.phones }.forEach { cursor.addRow(arrayOf(it)) }
            }
            return cursor
        }
        override fun getType(uri: Uri): String? = null
        override fun insert(uri: Uri, values: ContentValues?): Uri? = null
        override fun delete(uri: Uri, selection: String?, args: Array<out String>?) = 0
        override fun update(uri: Uri, values: ContentValues?, selection: String?, args: Array<out String>?) = 0
    }
    private fun setup(contacts: List<Contact>, granted: Boolean = true, fail: Boolean = false, security: Boolean = false): Pair<Application, PhoneProvider> {
        val app: Application = RuntimeEnvironment.getApplication()
        if (granted) shadowOf(app).grantPermissions(Manifest.permission.READ_CONTACTS) else shadowOf(app).denyPermissions(Manifest.permission.READ_CONTACTS)
        val provider = PhoneProvider(contacts, fail, security)
        ShadowContentResolver.registerProviderInternal(ContactsContract.AUTHORITY, provider)
        return app to provider
    }
    @Test fun realArabicContactAnd972PhoneResolveExactly() {
        val (app, provider) = setup(listOf(Contact(1, realName, listOf("+972 59-860-9731"))))
        val result = ContactIndex.lookupResult(app, realName)
        assertEquals(ContactIndex.Status.CONTACT_RESOLVED, result.status)
        assertEquals("0598609731", PhoneNormalizer.normalize(result.phone))
        assertTrue(result.detail.contains("nameMatch=EXACT"))
        assertEquals(5, provider.queries)
        assertFalse(result.detail.contains(realName))
        assertEquals("0598609731", PhoneNormalizer.normalize(CallPhoneNumber.normalize("+972 59-860-9731")))
    }
    @Test fun spacesArabicWhitespaceAndBidiMatchWithoutGuessingLetters() {
        val (app, _) = setup(listOf(Contact(1, "  درج\u00a0ام  الاسد\u200f شارع\u202fالقدس  ", listOf("+972 59-860-9731"))))
        val result = ContactIndex.lookupResult(app, "\u061cدرج ام الاسد\u200e شارع القدس\ufeff")
        assertEquals(ContactIndex.Status.CONTACT_RESOLVED, result.status)
        assertEquals("0598609731", PhoneNormalizer.normalize(result.phone))
        assertTrue(result.detail.contains("nameMatch=NORMALIZED"))
    }
    @Test fun unicodeCanonicalEquivalencePreservesNameMeaning() {
        assertEquals("أحمد علي", ContactIndex.normalizeName("  ا\u0654حمد\tعلي\u200f  "))
        assertEquals("عَلِي", ContactIndex.normalizeName("عَلِي"))
        assertNotEquals(ContactIndex.normalizeName("ام الاسد"), ContactIndex.normalizeName("أم الأسد"))
        assertNotEquals(ContactIndex.normalizeName("علي"), ContactIndex.normalizeName("عَلِي"))
        assertEquals("درج ام", ContactIndex.normalizeName("\u2066درج\u2069 \u200bام"))
        assertEquals("درج ام", ContactIndex.normalizeName("درج\u2060 ام"))
    }
    @Test fun actualAlternativeDisplayNameMatches() {
        val (app, _) = setup(listOf(Contact(1, "Different primary", listOf("+972 59-860-9731"), realName)))
        assertEquals("0598609731", PhoneNormalizer.normalize(ContactIndex.lookupResult(app, realName).phone))
    }
    @Test fun repeatedFormatsForOneContactProduceOneUniqueNumber() {
        val (app, _) = setup(listOf(Contact(1, realName, listOf("+972 59-860-9731", "0598609731", "00972598609731", "+٩٧٢ ٥٩-٨٦٠-٩٧٣١"))))
        val result = ContactIndex.lookupResult(app, realName)
        assertEquals(ContactIndex.Status.CONTACT_RESOLVED, result.status)
        assertEquals("0598609731", PhoneNormalizer.normalize(result.phone))
    }
    @Test fun oneContactWithDifferentNumbersIsAmbiguousAndReturnsNoPhone() {
        val (app, _) = setup(listOf(Contact(1, realName, listOf("0598609731", "0561234567"))))
        val result = ContactIndex.lookupResult(app, realName)
        assertEquals(ContactIndex.Status.CONTACT_AMBIGUOUS, result.status)
        assertEquals("", result.phone)
    }
    @Test fun twoContactsSameNameDifferentNumbersAreAmbiguous() {
        val (app, _) = setup(listOf(Contact(1, realName, listOf("0598609731")), Contact(2, realName, listOf("0561234567"))))
        val result = ContactIndex.lookupResult(app, realName)
        assertEquals(ContactIndex.Status.CONTACT_AMBIGUOUS, result.status)
        assertEquals("", result.phone)
        assertTrue(result.detail.contains("matchedContacts=2"))
    }
    @Test fun duplicateContactIdentitiesAreRejectedEvenWithIdenticalNumber() {
        val (app, _) = setup(listOf(Contact(1, realName, listOf("0598609731")), Contact(2, realName, listOf("+972 59-860-9731"))))
        assertEquals(ContactIndex.Status.CONTACT_AMBIGUOUS, ContactIndex.lookupResult(app, realName).status)
    }
    @Test fun missingPermissionNeverQueriesAndRevocationIsRespected() {
        val (app, provider) = setup(listOf(Contact(1, realName, listOf("0598609731"))), granted = false)
        assertEquals(ContactIndex.Status.CONTACT_PERMISSION_MISSING, ContactIndex.lookupResult(app, realName).status)
        assertEquals(0, provider.queries)
        shadowOf(app).grantPermissions(Manifest.permission.READ_CONTACTS)
        assertEquals("0598609731", PhoneNormalizer.normalize(ContactIndex.lookupResult(app, realName).phone))
        shadowOf(app).denyPermissions(Manifest.permission.READ_CONTACTS)
        assertEquals(ContactIndex.Status.CONTACT_PERMISSION_MISSING, ContactIndex.lookupResult(app, realName).status)
        assertEquals(5, provider.queries)
    }
    @Test fun noContactMatchIsNotFoundAndCannotUsePartialName() {
        val (app, _) = setup(listOf(Contact(1, "درج ام الاسد", listOf("0598609731"))))
        val result = ContactIndex.lookupResult(app, realName)
        assertEquals(ContactIndex.Status.CONTACT_NOT_FOUND, result.status)
        assertEquals("", result.phone)
    }
    @Test fun unavailableProviderIsReportedSeparatelyFromNoMatch() {
        val (app, _) = setup(emptyList(), fail = true)
        assertEquals(ContactIndex.Status.CONTACT_LOOKUP_ERROR, ContactIndex.lookupResult(app, realName).status)
    }
    @Test fun unsupportedSecondPhoneAndMissingPhoneAreNotGuessed() {
        val (app, _) = setup(listOf(Contact(1, realName, listOf("0598609731", "091234567"))))
        assertEquals(ContactIndex.Status.CONTACT_AMBIGUOUS, ContactIndex.lookupResult(app, realName).status)
        val (noPhone, _) = setup(listOf(Contact(1, realName, emptyList())))
        assertEquals(ContactIndex.Status.CONTACT_NOT_FOUND, ContactIndex.lookupResult(noPhone, realName).status)
    }
    @Test fun providerRestrictionDoesNotMisreportGrantedPermissionAsMissing() {
        val (app, _) = setup(emptyList(), security = true)
        val result = ContactIndex.lookupResult(app, realName)
        assertEquals(ContactIndex.Status.CONTACT_LOOKUP_ERROR, result.status)
        assertTrue(result.detail.contains("permission=GRANTED"))
        assertEquals("", result.phone)
    }
    @Test fun currentFieldExampleAndSafeFormattingResolve() {
        val (app, _) = setup(listOf(Contact(1, "“ابو الصادق (مصنع الطوب)”", listOf("+972 59-503-1462"))))
        assertEquals("0595031462", PhoneNormalizer.normalize(ContactIndex.lookupResult(app, "ابو الصادق مصنع الطوب").phone))
        val (english, _) = setup(listOf(Contact(1, "Alice SMITH", listOf("+970 (56) 503-1462"))))
        assertEquals("0565031462", PhoneNormalizer.normalize(ContactIndex.lookupResult(english, "alice smith").phone))
    }
    @Test fun structuredFullNameResolvesWithoutFuzzySearch() {
        val (app, _) = setup(listOf(Contact(1, "Different aggregate label", listOf("0595031462"), structured = "ابو الصادق مصنع الطوب")))
        val result = ContactIndex.lookupResult(app, "ابو الصادق مصنع الطوب")
        assertEquals("0595031462", PhoneNormalizer.normalize(result.phone))
        assertTrue(result.detail.contains("StructuredName"))
        assertEquals("", ContactIndex.lookupResult(app, "ابو الصادق").phone)
    }
    @Test fun structuredCollisionCannotSelectFirstAggregateMatch() {
        val (app, _) = setup(listOf(Contact(1, realName, listOf("0595031462")), Contact(2, "Other label", listOf("0565031462"), structured = realName)))
        assertEquals(ContactIndex.Status.CONTACT_AMBIGUOUS, ContactIndex.lookupResult(app, realName).status)
    }
    @Test fun targetCallerResolvesOnlyFromUniqueAndroidContact() {
        val (app,_)=setup(listOf(Contact(1,"حكمت قليل",listOf("+972 56-860-2288"))))
        assertEquals("+972568602288",ContactIndex.lookupResult(app,"\u200fحكمت قليل\u200f").phone)
        val (ambiguous,_)=setup(listOf(Contact(1,"حكمت قليل",listOf("0568602288")),Contact(2,"حكمت قليل",listOf("0591234567"))))
        assertEquals("",ContactIndex.lookupResult(ambiguous,"حكمت قليل").phone)
    }
    @Test fun closedPendingCallEnrichesWithoutChangingOriginalTimeOrNewestCall() {
        val (app,_)=setup(listOf(Contact(1,"حكمت قليل",listOf("+972 56-860-2288"))))
        val store=CallStore.get(app);val start=1784109600000L
        val id=store.observe("com.whatsapp.w4b","pending-contact",start,callerName="حكمت قليل",strictAliases=true)!!
        store.publish(id,reason="CONTACT_NOT_FOUND");store.removed("pending-contact")
        val original=JSONObject(store.pending().first {it.first==id}.second)
        val latest=store.observe("com.whatsapp","newer",start+60000,strictAliases=true)!!
        store.enrich(latest,listOf("متصل آخر"),start+60000)
        store.resolvePendingContacts()
        val resolved=JSONObject(store.pending().first {it.first==id}.second)
        assertEquals(id,resolved.getString("eventId"));assertEquals(start,resolved.getLong("timestamp"))
        assertEquals(original.getInt("revision")+1,resolved.getInt("revision"));assertEquals("0568602288",resolved.getString("number"))
        assertEquals(latest,store.state("last_call_id"))
        store.ack(id,"com.whatsapp.w4b","","fixture",original.toString())
        assertTrue(store.pending().any {it.first==id})
        store.resolvePendingContacts()
        assertEquals(resolved.toString(),store.pending().first {it.first==id}.second)
    }

    @Test fun globalArabicAndEnglishContactsKeepInternationalIdentity() {
        for ((name, phone) in listOf("أحمد علي" to "+966501234567", "Alice Smith" to "+442079460018", "太郎 山田" to "+819012345678")) {
            val (app, _) = setup(listOf(Contact(1, name, listOf(phone))))
            assertEquals(phone, ContactIndex.lookupResult(app, name).phone)
        }
    }
    @Test fun differentInternationalNumbersWithSameNationalDisplayAreAmbiguous() {
        val (app, _) = setup(listOf(Contact(1, "أحمد علي", listOf("+970591234567", "+972591234567"))))
        assertEquals(ContactIndex.Status.CONTACT_AMBIGUOUS, ContactIndex.lookupResult(app,"أحمد علي").status)
    }
    @Test fun oneInternationalAndExactNationalDuplicateInSameContactIsUnique() {
        val (app, _) = setup(listOf(Contact(1, "Alice Smith", listOf("+442079460018", "02079460018"))))
        assertEquals("+442079460018", ContactIndex.lookupResult(app,"Alice Smith").phone)
    }
}
