package com.maktab.calls

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.ContactsContract
import android.provider.ContactsContract.CommonDataKinds.StructuredName as StructuredNameFields
import androidx.core.content.ContextCompat

/** Fresh, local identity index per lookup; permission changes and edits cannot leave stale aliases. */
object ContactIndex {
    enum class Status { CONTACT_PERMISSION_MISSING, CONTACT_NOT_FOUND, CONTACT_AMBIGUOUS, CONTACT_RESOLVED, CONTACT_LOOKUP_ERROR }
    data class Result(val status: Status, val phone: String = "", val detail: String = "")
    fun permissionGranted(context: Context): Boolean = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED
    fun normalizeName(value: String): String = ContactNameNormalizer.display(value)
    fun matchingKey(value: String): String = ContactNameNormalizer.name(value).normalized
    fun lookup(context: Context, displayName: String): String = lookupResult(context, displayName).phone
    fun lookupResult(context: Context, displayName: String): Result = lookupNames(context, listOf(displayName))

    fun lookupNames(context: Context, displayNames: List<String>, phoneHints: Set<String> = emptySet()): Result {
        if (!permissionGranted(context)) return Result(Status.CONTACT_PERMISSION_MISSING, detail = "permission=DENIED; lookup=NOT_STARTED; matchedContacts=0")
        if (displayNames.none { matchingKey(it).isNotBlank() }) return Result(Status.CONTACT_NOT_FOUND, detail = "permission=GRANTED; matchedContacts=0; matchingStage=NO_SAFE_MATCH; reason=EMPTY_CALLER_LABEL")
        var stage = "contacts"
        return try {
            val entries = linkedMapOf<Long, ContactNameMatcher.Entry>()
            val names = listOf(ContactsContract.Contacts.DISPLAY_NAME, ContactsContract.Contacts.DISPLAY_NAME_PRIMARY,
                ContactsContract.Contacts.DISPLAY_NAME_ALTERNATIVE).distinct()
            var contactRows = 0
            var structuredRows = 0
            var rawRows = 0
            var indexedPhoneRows = 0
            var orphanStructuredRows = 0
            val supplementalErrors = linkedSetOf<String>()
            val invalidPhones = linkedSetOf<Long>()
            // Phone is a standalone public name/number view, as in the original app.
            // Supplemental OEM views must not erase its exact identities.
            fun supplemental(uri: Uri, projection: Array<String>, selection: String? = null, args: Array<String>? = null): android.database.Cursor? {
                return try {
                    context.contentResolver.query(uri, projection, selection, args, null).also {
                        if (it == null) supplementalErrors.add("$stage:NULL_CURSOR")
                    }
                } catch (error: Exception) {
                    if (!permissionGranted(context)) throw error
                    supplementalErrors.add("$stage:${error.javaClass.simpleName}"); null
                }
            }
            fun supplementalRead(cursor: android.database.Cursor?, read: (android.database.Cursor) -> Unit) {
                try { cursor?.use(read) } catch (error: Exception) {
                    if (!permissionGranted(context)) throw error
                    supplementalErrors.add("$stage:CURSOR_${error.javaClass.simpleName}")
                }
            }
            val rawToContact = linkedMapOf<Long, Long>()
            val indexedPhones = linkedMapOf<Long, MutableSet<String>>()
            val deletedRawIds = linkedSetOf<Long>()
            val cursor = supplemental(ContactsContract.Contacts.CONTENT_URI,
                (listOf(ContactsContract.Contacts._ID, ContactsContract.Contacts.LOOKUP_KEY) + names).toTypedArray())
            supplementalRead(cursor) {
                val idColumn = it.getColumnIndexOrThrow(ContactsContract.Contacts._ID)
                val keyColumn = it.getColumnIndex(ContactsContract.Contacts.LOOKUP_KEY)
                while (it.moveToNext()) {
                    contactRows++
                    val id = it.getLong(idColumn)
                    val entry = entries.getOrPut(id) { ContactNameMatcher.Entry(id) }
                    if (keyColumn >= 0) it.getString(keyColumn)?.takeIf(String::isNotBlank)?.let(entry.lookupKeys::add)
                    names.forEach { field ->
                        val index = it.getColumnIndex(field)
                        if (index >= 0) entry.add(it.getString(index).orEmpty(), field)
                    }
                }
            }
            stage = "rawContacts"
            val rawCursor = supplemental(ContactsContract.RawContacts.CONTENT_URI,
                arrayOf(ContactsContract.RawContacts._ID, ContactsContract.RawContacts.CONTACT_ID, ContactsContract.RawContacts.DELETED,
                    ContactsContract.RawContacts.DISPLAY_NAME_PRIMARY, ContactsContract.RawContacts.DISPLAY_NAME_ALTERNATIVE))
            supplementalRead(rawCursor) {
                val rawIdColumn = it.getColumnIndexOrThrow(ContactsContract.RawContacts._ID)
                val contactIdColumn = it.getColumnIndexOrThrow(ContactsContract.RawContacts.CONTACT_ID)
                val deletedColumn = it.getColumnIndex(ContactsContract.RawContacts.DELETED)
                while (it.moveToNext()) {
                    rawRows++
                    val rawId = it.getLong(rawIdColumn)
                    if (deletedColumn >= 0 && it.getInt(deletedColumn) != 0) { deletedRawIds.add(rawId); continue }
                    if (it.isNull(contactIdColumn)) continue // A pending/unaggregated raw row has no trusted identity yet.
                    val id = it.getLong(contactIdColumn)
                    if (id <= 0 || rawId <= 0) continue
                    val previous = rawToContact.put(rawId, id)
                    if (previous != null && previous != id) throw IllegalStateException("INCONSISTENT_RAW_LINK")
                    val entry = entries.getOrPut(id) { ContactNameMatcher.Entry(id) }
                    listOf(ContactsContract.RawContacts.DISPLAY_NAME_PRIMARY, ContactsContract.RawContacts.DISPLAY_NAME_ALTERNATIVE).distinct().forEach { field ->
                        val column = it.getColumnIndex(field)
                        if (column >= 0) entry.add(it.getString(column).orEmpty(), "RawContacts.$field")
                    }
                }
            }
            stage = "phoneIndex"
            val phoneIndex = context.contentResolver.query(ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                arrayOf(ContactsContract.Data.CONTACT_ID, ContactsContract.Data.RAW_CONTACT_ID, ContactsContract.Contacts.DISPLAY_NAME_PRIMARY,
                    ContactsContract.Contacts.DISPLAY_NAME_ALTERNATIVE, ContactsContract.Contacts.LOOKUP_KEY,
                    ContactsContract.CommonDataKinds.Phone.NUMBER), null, null, null)
                ?: return Result(Status.CONTACT_LOOKUP_ERROR, detail = "permission=GRANTED; stage=$stage; reason=NULL_CURSOR")
            phoneIndex.use {
                val idColumn = it.getColumnIndexOrThrow(ContactsContract.Data.CONTACT_ID)
                val rawColumn = it.getColumnIndex(ContactsContract.Data.RAW_CONTACT_ID)
                while (it.moveToNext()) {
                    indexedPhoneRows++
                    val id = it.getLong(idColumn)
                    val rawId = if (rawColumn >= 0) it.getLong(rawColumn) else 0L
                    if (id <= 0 || rawId in deletedRawIds) continue
                    if (rawToContact[rawId]?.let { mapped -> mapped != id } == true)
                        return Result(Status.CONTACT_LOOKUP_ERROR, detail = "permission=GRANTED; stage=$stage; reason=INCONSISTENT_PHONE_RAW_LINK")
                    val entry = entries.getOrPut(id) { ContactNameMatcher.Entry(id) }
                    val phoneColumn = it.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
                    if (phoneColumn >= 0) {
                        val phone = CallPhoneNumber.normalize(it.getString(phoneColumn).orEmpty())
                        if (phone.isBlank()) invalidPhones.add(id)
                        else indexedPhones.getOrPut(id) { linkedSetOf() }.add(phone)
                    }
                    listOf(ContactsContract.Contacts.DISPLAY_NAME_PRIMARY, ContactsContract.Contacts.DISPLAY_NAME_ALTERNATIVE).distinct().forEach { field ->
                        val column = it.getColumnIndex(field)
                        if (column >= 0) entry.add(it.getString(column).orEmpty(), "Phone.$field")
                    }
                    val key = it.getColumnIndex(ContactsContract.Contacts.LOOKUP_KEY)
                    if (key >= 0) it.getString(key)?.takeIf(String::isNotBlank)?.let(entry.lookupKeys::add)
                }
            }
            stage = "structuredNames"
            val components = listOf(StructuredNameFields.GIVEN_NAME, StructuredNameFields.MIDDLE_NAME, StructuredNameFields.FAMILY_NAME)
            val fields = listOf(ContactsContract.Data.CONTACT_ID, ContactsContract.Data.RAW_CONTACT_ID,
                StructuredNameFields.DISPLAY_NAME, StructuredNameFields.GIVEN_NAME, StructuredNameFields.MIDDLE_NAME, StructuredNameFields.FAMILY_NAME, StructuredNameFields.PREFIX, StructuredNameFields.SUFFIX)
            val structured = supplemental(ContactsContract.Data.CONTENT_URI, fields.toTypedArray(),
                "${ContactsContract.Data.MIMETYPE} = ?", arrayOf(StructuredNameFields.CONTENT_ITEM_TYPE))
            supplementalRead(structured) {
                val idColumn = it.getColumnIndexOrThrow(ContactsContract.Data.CONTACT_ID)
                fun value(field: String): String {
                    val column = it.getColumnIndex(field)
                    return if (column < 0) "" else it.getString(column).orEmpty().trim()
                }
                while (it.moveToNext()) {
                    structuredRows++
                    val id = it.getLong(idColumn)
                    val rawColumn = it.getColumnIndex(ContactsContract.Data.RAW_CONTACT_ID)
                    val rawId = if (rawColumn >= 0) it.getLong(rawColumn) else 0L
                    if (rawId in deletedRawIds) continue
                    if (rawToContact[rawId]?.let { mapped -> mapped != id } == true)
                        throw IllegalStateException("INCONSISTENT_STRUCTURED_RAW_LINK")
                    // A real RawContacts/Phone row also proves the aggregate identity. Contacts' list
                    // must not be the only gate; genuine provider rows can be absent from that list.
                    val entry = entries[id]
                    if (entry == null) { orphanStructuredRows++; continue }
                    entry.add(value(StructuredNameFields.DISPLAY_NAME), "StructuredName.DISPLAY_NAME")
                    val core = components.map(::value).filter(String::isNotBlank)
                    if (core.isNotEmpty()) {
                        entry.add(core.joinToString(" "), "StructuredName.COMPONENTS")
                        entry.add((listOf(value(StructuredNameFields.PREFIX)) + core + value(StructuredNameFields.SUFFIX)).filter(String::isNotBlank).joinToString(" "), "StructuredName.PREFIX_SUFFIX")
                    }
                }
            }
            stage = "simPhonebook"
            val sim = SimContactIndex.read(context)
            val simPhones = linkedMapOf<Long, String>()
            for (record in sim.records) {
                val key = matchingKey(record.name)
                // Exact full normalized name AND full normalized phone are required to recognize a mirror.
                // A same-name/different-phone SIM record remains a separate competing identity.
                val mirrors = entries.values.filter { entry -> entry.id > 0 &&
                    entry.aliases.any { it.name.normalized == key } &&
                    record.phone.isNotBlank() && record.phone in indexedPhones[entry.id].orEmpty() }
                if (mirrors.size == 1) {
                    mirrors.single().add(record.name, "SIM.NAME_MIRROR")
                } else {
                    // Private matcher key only; never passed as a Contacts contactId or logged as one.
                    // The source identity is the real (subscription, ADN record) returned by the SIM provider.
                    val id = -(simPhones.size + 1L)
                    entries[id] = ContactNameMatcher.Entry(id).apply { add(record.name, "SIM.NAME") }
                    simPhones[id] = record.phone
                }
            }
            val match = ContactNameMatcher.match(entries.values, displayNames)
            val countDetail = "permission=GRANTED; stage=contacts+structuredNames; contactRows=$contactRows; rawRows=$rawRows; indexedPhoneRows=$indexedPhoneRows; structuredRows=$structuredRows; orphanStructuredRows=$orphanStructuredRows; simRows=${sim.records.size}; simStatus=${sim.status}; supplementalErrors=${supplementalErrors.joinToString(",")}; indexedIdentities=${entries.size}; matchedContacts=${match.ids.size}; matchingStage=${match.stage}"
            if (match.ids.isEmpty()) {
                return Result(if (supplementalErrors.isEmpty()) Status.CONTACT_NOT_FOUND else Status.CONTACT_LOOKUP_ERROR, detail = "$countDetail; ${ContactNameMatcher.diagnostics(match)}")
            }
            if (match.ids.size > 1) return Result(Status.CONTACT_AMBIGUOUS, detail = "$countDetail; reason=MULTIPLE_CONTACT_IDENTITIES; ${ContactNameMatcher.diagnostics(match)}")
            stage = "phones"
            val selected = match.candidates.first { it.entry.id == match.ids.single() }
            if (selected.entry.id < 0) {
                val phone = simPhones.getValue(selected.entry.id)
                val hints = phoneHints.map(CallPhoneNumber::normalize).filter(String::isNotBlank).toSet()
                val meta = "$countDetail; columns=SIM.NAME; identitySource=SIM_ADN_RECORD"
                return when {
                    hints.isNotEmpty() && hints != setOf(phone) -> Result(Status.CONTACT_AMBIGUOUS, detail="$meta; reason=CONFLICTING_PHONE_HINT")
                    phone.isBlank() -> Result(Status.CONTACT_NOT_FOUND, detail="$meta; reason=NO_SUPPORTED_UNIQUE_PHONE")
                    else -> Result(Status.CONTACT_RESOLVED, phone, "$meta; phoneSelection=UNIQUE_PHONE")
                }
            }
            phones(context, match.ids.single(), phoneHints, "$countDetail; nameMatch=${if (match.stage == "EXACT_RAW") "EXACT" else "NORMALIZED"}; columns=${selected.alias.source}", indexedPhones[match.ids.single()].orEmpty(), match.ids.single() in invalidPhones)
        } catch (_: SecurityException) {
            if (permissionGranted(context)) Result(Status.CONTACT_LOOKUP_ERROR, detail = "permission=GRANTED; stage=$stage; error=SecurityException")
            else Result(Status.CONTACT_PERMISSION_MISSING, detail = "permission=DENIED; stage=$stage")
        } catch (error: Exception) {
            Result(Status.CONTACT_LOOKUP_ERROR, detail = "permission=${if (permissionGranted(context)) "GRANTED" else "DENIED"}; stage=$stage; error=${error.javaClass.simpleName}")
        }
    }

    /** All phone rows of the selected aggregate identity; phone/data URI can supply an exact row hint. */
    private fun phones(context: Context, id: Long, hints: Set<String>, detail: String, snapshot: Set<String>? = null, invalidSnapshot: Boolean = false): Result {
        val phones = linkedSetOf<String>()
        var invalid = invalidSnapshot
        var rows = snapshot?.size ?: 0
        if (snapshot != null) phones.addAll(snapshot)
        val cursor = try { context.contentResolver.query(ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            arrayOf(ContactsContract.CommonDataKinds.Phone.NUMBER), "${ContactsContract.CommonDataKinds.Phone.CONTACT_ID} = ?", arrayOf(id.toString()), null) } catch (error: Exception) {
            if (snapshot == null || !permissionGranted(context)) throw error
            null // The standalone Phone snapshot remains authoritative when an OEM filter fails.
        }
        if(cursor == null && snapshot == null) return Result(Status.CONTACT_LOOKUP_ERROR, detail = "$detail; reason=NULL_PHONE_CURSOR")
        // Union both public views. Keep indexed rows if an OEM's filtered query omits
        // them, but never miss an additional conflicting/unsupported phone in that query.
        cursor?.use {
            val column = it.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.NUMBER)
            while (it.moveToNext()) {
                rows++
                val phone = CallPhoneNumber.normalize(it.getString(column).orEmpty())
                if (phone.isBlank()) invalid = true else phones.add(phone)
            }
        }
        // Same aggregate contact may repeat one explicit international identity in local format.
        // Only that identity's verified national representation may be collapsed; different countries stay distinct.
        val international=phones.mapNotNull(PhoneNormalizer::parse).filter {it.e164.isNotBlank()}
        val removable=phones.filter { local -> !local.startsWith('+') && international.count {it.display==local}==1 }
        phones.removeAll(removable.toSet())
        val normalizedHints = hints.map(CallPhoneNumber::normalize).filter(String::isNotBlank).map { hint ->
            international.singleOrNull {it.display==hint}?.identity ?: hint
        }.toSet()
        val hinted = phones.intersect(normalizedHints)
        val meta = "$detail; phoneRows=$rows; uniquePhones=${phones.size}; invalidPhone=$invalid; missingPhones=${rows == 0}"
        return when {
            normalizedHints.isNotEmpty() && (normalizedHints.size != 1 || hinted.size != 1) -> Result(Status.CONTACT_AMBIGUOUS, detail = "$meta; reason=CONFLICTING_PHONE_HINT")
            hinted.size == 1 -> Result(Status.CONTACT_RESOLVED, hinted.single(), "$meta; phoneSelection=EXACT_URI_HINT")
            phones.size > 1 || (phones.isNotEmpty() && invalid) -> Result(Status.CONTACT_AMBIGUOUS, detail = "$meta; reason=LINKED_CONTACT_MULTIPLE_PHONES")
            phones.size == 1 -> Result(Status.CONTACT_RESOLVED, phones.single(), "$meta; phoneSelection=UNIQUE_PHONE")
            else -> Result(Status.CONTACT_NOT_FOUND, detail = "$meta; reason=NO_SUPPORTED_UNIQUE_PHONE")
        }
    }

    /** Only official provider URIs are IDs. Opaque Person keys are never guessed to be contact IDs. */
    fun lookupUri(context: Context, value: String): Result {
        if (!permissionGranted(context)) return Result(Status.CONTACT_PERMISSION_MISSING, detail = "matchedContacts=0; permission=DENIED")
        val uri = Uri.parse(value)
        val path = uri.pathSegments
        if (uri.scheme != "content" || uri.authority != ContactsContract.AUTHORITY || uri.query != null || uri.fragment != null)
            return Result(Status.CONTACT_NOT_FOUND, detail = "matchedContacts=0; reason=UNSUPPORTED_CONTACT_URI")
        val contact = path.size == 2 && path[0] == "contacts" && path[1].toLongOrNull() != null
        val lookup = path.size in 3..4 && path.take(2) == listOf("contacts", "lookup")
        val data = (path.size == 2 && path[0] == "data" && path[1].toLongOrNull() != null) ||
            (path.size == 3 && path.take(2) == listOf("data", "phones") && path[2].toLongOrNull() != null)
        if (!contact && !lookup && !data) return Result(Status.CONTACT_NOT_FOUND, detail = "matchedContacts=0; reason=UNSUPPORTED_CONTACT_URI")
        return try {
            val target = if (lookup) ContactsContract.Contacts.lookupContact(context.contentResolver, uri) else uri
            if (target == null) return Result(Status.CONTACT_NOT_FOUND, detail = "matchedContacts=0; reason=STALE_CONTACT_URI")
            val column = if (data) ContactsContract.Data.CONTACT_ID else ContactsContract.Contacts._ID
            val projection = if (data) arrayOf(column, ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.Phone.NUMBER) else arrayOf(column)
            val cursor = context.contentResolver.query(target, projection, null, null, null)
                ?: return Result(Status.CONTACT_LOOKUP_ERROR, detail = "matchedContacts=0; reason=NULL_CONTACT_URI_CURSOR")
            val ids = linkedSetOf<Long>()
            val hints = linkedSetOf<String>()
            cursor.use {
                val idColumn = it.getColumnIndexOrThrow(column)
                val mimeColumn = it.getColumnIndex(ContactsContract.Data.MIMETYPE)
                val phoneColumn = it.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
                while (it.moveToNext()) {
                    ids.add(it.getLong(idColumn))
                    if (data && mimeColumn >= 0 && phoneColumn >= 0 && it.getString(mimeColumn) == ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE)
                        CallPhoneNumber.normalize(it.getString(phoneColumn).orEmpty()).takeIf(String::isNotBlank)?.let(hints::add)
                }
            }
            if (ids.size != 1) return Result(if (ids.isEmpty()) Status.CONTACT_NOT_FOUND else Status.CONTACT_AMBIGUOUS, detail = "matchedContacts=${ids.size}; reason=CONTACT_URI_IDENTITIES")
            phones(context, ids.single(), hints, "permission=GRANTED; matchedContacts=1; matchingStage=DIRECT_CONTACT_URI; match=CONTACT_URI")
        } catch (_: SecurityException) {
            Result(if (permissionGranted(context)) Status.CONTACT_LOOKUP_ERROR else Status.CONTACT_PERMISSION_MISSING, detail = "permission=${if (permissionGranted(context)) "GRANTED" else "DENIED"}; stage=contactUri; error=SecurityException")
        } catch (error: Exception) {
            Result(Status.CONTACT_LOOKUP_ERROR, detail = "permission=GRANTED; matchedContacts=0; stage=contactUri; error=${error.javaClass.simpleName}")
        }
    }
}
