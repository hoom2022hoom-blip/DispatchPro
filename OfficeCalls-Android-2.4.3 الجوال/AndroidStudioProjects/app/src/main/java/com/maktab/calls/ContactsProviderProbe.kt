package com.maktab.calls

import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.ContactsContract as C
import java.util.concurrent.Executors

/** Read-only evidence from THIS device. Never supplies a phone, changes a match or queues a call. */
internal object ContactsProviderProbe {
    const val REPORT_STATE = "contacts_provider_probe_report"
    private val worker = Executors.newSingleThreadExecutor()
    private val recentFailures = linkedMapOf<Set<String>, Long>()
    private val displayColumns = listOf("display_name", "display_name_alt", "display_name_primary").distinct()
    private val dataColumns = (1..14).map { "data$it" }
    private val allowedColumns = (displayColumns + dataColumns + listOf("_id", "contact_id", "raw_contact_id", "lookup",
        "deleted", "aggregation_mode", "account_type", "account_name", "mimetype", "display_name_source", "name_raw_contact_id")).toSet()
    private val currentDisplays = listOf(C.Contacts.DISPLAY_NAME_PRIMARY, C.Contacts.DISPLAY_NAME_ALTERNATIVE).distinct()
    private const val ROW_LIMIT = 50_000
    private const val HIT_LIMIT = 40

    data class Report(val summary: String, val details: List<String>) {
        val text get() = (listOf(summary) + details).joinToString("\n\n")
    }
    private data class Raw(val contact: Long?, val deleted: Boolean?, val account: String, val accountPresent: Boolean?, val aggregation: Long?)
    private data class Hit(val source: String, val contact: Long?, val raw: Long?, val fields: Set<String>, val mime: String,
        val lookup: String?, val validPhone: Boolean?, val nameRaw: Long?)
    private data class Scan(val source: String, var rows: Int = 0, var complete: Boolean = false, var error: String = "",
        var columns: Set<String> = emptySet(), var hitCount: Int = 0, val hits: MutableList<Hit> = mutableListOf()) {
        val seen get() = if(hitCount > 0) "true" else if(complete) "false" else "UNKNOWN"
    }
    private class Phones { var rows = 0; val valid = linkedSetOf<String>() }

    fun afterNameFailure(context: Context, names: List<String>) {
        val keys = names.map(ContactIndex::matchingKey).filter(String::isNotBlank).toSet()
        if(keys.isEmpty()) return
        synchronized(recentFailures) {
            val now = android.os.SystemClock.elapsedRealtime()
            if(recentFailures[keys]?.let { now - it < 60_000 } == true) return
            recentFailures[keys] = now
            if(recentFailures.size > 16) recentFailures.remove(recentFailures.keys.first())
        }
        val app = context.applicationContext
        worker.execute { persist(app, safeRead(app,names), "AUTOMATIC_NAME_FAILURE") }
    }
    fun run(context: Context, name: String, picked: Uri? = null, done: (Report) -> Unit) {
        val app = context.applicationContext
        worker.execute {
            val report = safeRead(app,listOf(name),picked)
            persist(app,report,if(picked == null) "MANUAL" else "CONTACT_PICKER")
            Handler(Looper.getMainLooper()).post { done(report) }
        }
    }
    private fun safeRead(context: Context,names: List<String>,picked: Uri?=null): Report =
        runCatching {read(context,names,picked)}.getOrElse {Report("probe=FAILED; error=${it.javaClass.simpleName}; values=NOT_LOGGED",emptyList())}
    private fun persist(context: Context, report: Report, origin: String) {
        // Neither exception messages nor provider values are logged. Report contains metadata only.
        runCatching {
            val store = CallStore.get(context)
            store.setState(REPORT_STATE,"origin=$origin; atMs=${System.currentTimeMillis()}\n\n${report.text}")
            store.log(status="CONTACT_PROVIDER_PROBE",detail="origin=$origin; ${report.summary}")
            report.details.forEach { store.log(status="CONTACT_PROVIDER_PROBE_DETAIL",detail=it) }
        }
    }
    private fun Cursor.value(column: String): String? {
        val i = getColumnIndex(column)
        return if(i < 0 || isNull(i) || getType(i) == Cursor.FIELD_TYPE_BLOB) null else getString(i)
    }
    private fun Cursor.id(column: String) = value(column)?.toLongOrNull()
    private fun account(type: String?) = when(type?.lowercase(java.util.Locale.ROOT)) {
        null -> "UNKNOWN"
        "", "local", "device", "phone", "com.android.localphone" -> "DEVICE_OR_LOCAL"
        "com.google" -> "GOOGLE"
        "com.whatsapp", "com.whatsapp.w4b" -> "WHATSAPP"
        else -> if(type.orEmpty().startsWith("com.transsion") || type.orEmpty().startsWith("com.tecno")) "OEM" else "OTHER"
    }
    private fun mime(type: String?) = when(type) {
        C.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE -> "STRUCTURED_NAME"
        C.CommonDataKinds.Phone.CONTENT_ITEM_TYPE -> "PHONE"
        C.CommonDataKinds.Nickname.CONTENT_ITEM_TYPE -> "NICKNAME"
        C.CommonDataKinds.Organization.CONTENT_ITEM_TYPE -> "ORGANIZATION"
        C.CommonDataKinds.Email.CONTENT_ITEM_TYPE -> "EMAIL"
        null -> "UNKNOWN"
        else -> "OTHER"
    }
    fun read(context: Context, names: List<String>, picked: Uri? = null): Report {
        if(!ContactIndex.permissionGranted(context)) return Report("permission=DENIED; probe=NOT_STARTED",emptyList())
        val keys = names.map(ContactIndex::matchingKey).filter(String::isNotBlank).toSet()
        if(keys.isEmpty()) return Report("probe=NOT_STARTED; reason=EMPTY_NAME",emptyList())
        val contacts = linkedSetOf<Long>()
        val contactLookups = linkedMapOf<Long,String>()
        val raws = linkedMapOf<Long,Raw>()
        val rawConflicts = linkedSetOf<Long>()
        val phonesByContact = linkedMapOf<Long,Phones>()
        val phonesByRaw = linkedMapOf<Long,Phones>()
        val phoneRowsByData = linkedMapOf<Long,Phones>()
        val phoneIdentityIds = linkedSetOf<Long>()
        val scans = mutableListOf<Scan>()
        fun scan(source: String, uri: Uri, projection: Array<String>? = null, selection: String? = null,
            args: Array<String>? = null, collect: Boolean = false): Scan {
            val s = Scan(source);scans.add(s)
            try {
                val cursor = context.contentResolver.query(uri,projection,selection,args,null)
                if(cursor == null) {s.error="NULL_CURSOR";return s}
                cursor.use { c ->
                    s.columns = c.columnNames.filter { it in allowedColumns }.toSet()
                    while(c.moveToNext()) {
                        if(s.rows >= ROW_LIMIT) {s.error="ROW_LIMIT";return@use}
                        s.rows++
                        val contact = if(source.contains("Contacts") && !source.contains("Raw")) c.id("_id") else c.id("contact_id")
                        val raw = if(source.contains("RawContacts")) c.id("_id") else c.id("raw_contact_id")
                        val lookup = c.value("lookup")
                        if(collect && source == "Contacts") {
                            contact?.let(contacts::add)
                            if(contact != null && !lookup.isNullOrBlank()) contactLookups[contact]=lookup
                        }
                        if(collect && source == "RawContacts" && raw != null) {
                            val info=Raw(contact,c.id("deleted")?.let {it != 0L},account(c.value("account_type")),
                                if("account_name" in s.columns) !c.value("account_name").isNullOrBlank() else null,c.id("aggregation_mode"))
                            if(raws[raw]?.contact?.let {it != contact} == true) rawConflicts.add(raw)
                            raws[raw]=info
                        }
                        val kind=if(source.startsWith("StructuredName")) "STRUCTURED_NAME" else if(source.startsWith("PhoneRows")) "PHONE" else mime(c.value("mimetype"))
                        val phone=if(source == "PhoneRows" || source.startsWith("Data") && kind == "PHONE") CallPhoneNumber.normalize(c.value("data1").orEmpty()) else ""
                        if(collect && (source == "PhoneRows" || source.startsWith("Data") && kind == "PHONE")) {
                            val map = if(source == "PhoneRows") phonesByContact else phoneRowsByData
                            contact?.let {id -> map.getOrPut(id,::Phones).apply {rows++;if(phone.isNotBlank()) valid.add(phone)}}
                            if(source == "PhoneRows") raw?.let {id -> phonesByRaw.getOrPut(id,::Phones).apply {rows++;if(phone.isNotBlank()) valid.add(phone)}}
                            if(source == "PhoneRows" && contact != null && contact > 0 && raws[raw]?.deleted != true &&
                                raws[raw]?.contact?.let {it != contact} != true) phoneIdentityIds.add(contact)
                        }
                        val values = displayColumns.associateWith {c.value(it)}.toMutableMap()
                        if(source.startsWith("StructuredName") || source.startsWith("Data")) {
                            dataColumns.forEach {values[it]=c.value(it)}
                            if(kind == "STRUCTURED_NAME") {
                                val core=listOf(C.CommonDataKinds.StructuredName.GIVEN_NAME,C.CommonDataKinds.StructuredName.MIDDLE_NAME,
                                    C.CommonDataKinds.StructuredName.FAMILY_NAME).mapNotNull {c.value(it)?.takeIf(String::isNotBlank)}
                                values["STRUCTURED_COMPONENTS"]=core.joinToString(" ")
                                values["STRUCTURED_PREFIX_SUFFIX"]=(listOfNotNull(c.value(C.CommonDataKinds.StructuredName.PREFIX))+core+
                                    listOfNotNull(c.value(C.CommonDataKinds.StructuredName.SUFFIX))).filter(String::isNotBlank).joinToString(" ")
                            }
                        }
                        val matching = values.filterValues { it != null && ContactIndex.matchingKey(it) in keys }.keys
                        if(matching.isNotEmpty()) {
                            s.hitCount++
                            if(s.hits.size < HIT_LIMIT) s.hits.add(Hit(source,contact,raw,matching,kind,lookup,
                                if(source.contains("PhoneRows") || source.startsWith("Data") && kind == "PHONE") CallPhoneNumber.normalize(c.value("data1").orEmpty()).isNotBlank() else null,c.id("name_raw_contact_id")))
                        }
                    }
                    s.complete = s.error.isEmpty()
                }
            } catch(error: Exception) {s.error=error.javaClass.simpleName;s.complete=false}
            return s
        }
        val a=scan("Contacts",C.Contacts.CONTENT_URI,collect=true)
        val b=scan("RawContacts",C.RawContacts.CONTENT_URI,collect=true)
        val p=scan("PhoneRows",C.CommonDataKinds.Phone.CONTENT_URI,collect=true)
        val n=scan("StructuredName",C.Data.CONTENT_URI,selection="${C.Data.MIMETYPE} = ?",args=arrayOf(C.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE))
        // Explicit scalar columns omit data15/photo blobs. Arbitrary Data exact values are evidence,
        // not automatically trusted caller aliases (e.g. a note can contain the same name).
        val dataProjection=(listOf("_id","contact_id","raw_contact_id","mimetype")+dataColumns+currentDisplays+"lookup").distinct().toTypedArray()
        var data=scan("Data",C.Data.CONTENT_URI,dataProjection,collect=true)
        if(!data.complete && data.error != "ROW_LIMIT") {
            phoneRowsByData.clear()
            data=scan("DataMinimal",C.Data.CONTENT_URI,
                (listOf("_id","contact_id","raw_contact_id","mimetype")+dataColumns).toTypedArray(),collect=true)
        }
        scan("ContactsCurrent251",C.Contacts.CONTENT_URI,(listOf("_id","lookup")+currentDisplays).distinct().toTypedArray())
        scan("RawContactsCurrent251",C.RawContacts.CONTENT_URI,(listOf("_id","contact_id","deleted")+currentDisplays).distinct().toTypedArray())
        scan("PhoneRowsCurrent251",C.CommonDataKinds.Phone.CONTENT_URI,
            (listOf("contact_id","raw_contact_id","lookup","data1")+currentDisplays).distinct().toTypedArray())
        scan("StructuredNameCurrent251",C.Data.CONTENT_URI,
            (listOf("contact_id","raw_contact_id")+(1..6).map {"data$it"}).toTypedArray(),
            selection="${C.Data.MIMETYPE} = ?",args=arrayOf(C.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE))
        keys.take(4).forEach {key ->
            scan("ContactsFilter",Uri.withAppendedPath(C.Contacts.CONTENT_FILTER_URI,key))
            scan("PhoneRowsFilter",Uri.withAppendedPath(C.CommonDataKinds.Phone.CONTENT_FILTER_URI,key))
        }
        if(picked != null) {
            if(picked.scheme == "content" && picked.authority == C.AUTHORITY && picked.pathSegments.firstOrNull() == "contacts" && picked.query == null && picked.fragment == null)
                scan("PickedContacts",picked)
            else scans.add(Scan("PickedContacts",error="NOT_OFFICIAL_CONTACTS_URI"))
        }
        val entryIds=contacts+raws.filter {it.key > 0 && it.value.contact?.let {id -> id > 0} == true && it.value.deleted != true}.values.mapNotNull {it.contact}+
            phoneIdentityIds
        fun reason(hit: Hit): String {
            val raw=raws[hit.raw]
            if(hit.source != "Contacts" && hit.source != "PickedContacts") {
                if(raw?.deleted == true) return "DELETED_RAW_CONTACT"
                if(hit.raw in rawConflicts || raw?.contact?.let {it != hit.contact} == true) return "INCONSISTENT_RAW_LINK"
                if(hit.contact == null || hit.contact <= 0) return "MISSING_OR_INVALID_CONTACT_ID"
            }
            if(hit.source == "RawContacts" && (hit.raw == null || hit.raw <= 0)) return "INVALID_RAW_ID"
            if(hit.source == "StructuredName" && hit.contact !in entryIds) return "ORPHAN_STRUCTURED_ROW"
            if(hit.source == "StructuredName" && hit.fields.none {it in (1..6).map {i -> "data$i"} || it.startsWith("STRUCTURED_")}) return "NAME_FIELD_NOT_READ_BY_251"
            if(hit.source == "Data" || hit.source == "DataMinimal") return "DATA_COLUMNS_NOT_READ_AS_NAME_BY_251"
            if(hit.source.endsWith("Filter") || hit.source == "PickedContacts") return "COMPARE_WITH_UNFILTERED_SOURCE"
            if(hit.fields.all {it == "display_name_primary"}) return "COLUMN_NOT_IN_251_PROJECTION"
            if(hit.source in listOf("Contacts","RawContacts","PhoneRows","StructuredName")) {
                val current=scans.first {it.source == hit.source+"Current251"}
                if(!current.complete) return "CURRENT_PROJECTION_UNREADABLE"
                if(current.hits.none {it.contact == hit.contact && (hit.raw == null || it.raw == hit.raw)}) return "NOT_EXACT_IN_CURRENT_PROJECTION"
            }
            return "EXACT_ALIAS_EXPECTED_IN_251_INDEX_RECHECK_SNAPSHOT"
        }
        val summary="permission=GRANTED; exactNameSeenInContacts=${a.seen}; exactNameSeenInRawContacts=${b.seen}; exactNameSeenInStructuredName=${n.seen}; exactNameSeenInPhoneRows=${p.seen}; exactNameSeenInDataRows=${data.seen}; assessment=READ_ONLY_SEPARATE_SNAPSHOT"
        val details=scans.map {"source=${it.source}; rows=${it.rows}; queryComplete=${it.complete}; exactNameSeen=${it.seen}; exactRows=${it.hitCount}; shownRows=${it.hits.size}; error=${it.error.ifBlank {"NONE"}}; availableColumns=${it.columns.sorted().joinToString(",")}"}.toMutableList()
        // At most 40 target hits across sources, never unrelated names/rows or lookup/account values.
        scans.flatMap {it.hits}.take(HIT_LIMIT).forEach {h ->
            val raw=raws[h.raw]
            val ps=phonesByContact[h.contact]
            val rp=phonesByRaw[h.raw]
            val dp=phoneRowsByData[h.contact]
            val nameRaw=raws[h.nameRaw]
            val linkage=when {
                h.raw == null -> "NOT_EXPOSED"
                h.raw in rawConflicts -> "CONFLICT"
                raw == null -> if(b.complete) "RAW_ROW_ABSENT" else "UNKNOWN"
                raw.deleted == true -> "DELETED"
                raw.contact == null -> "UNAGGREGATED"
                raw.contact != h.contact -> "CONTACT_ID_MISMATCH"
                else -> "VERIFIED"
            }
            val lookup=when {
                h.lookup.isNullOrBlank() -> "NOT_EXPOSED"
                contactLookups[h.contact] == null -> "AGGREGATE_KEY_NOT_READ"
                contactLookups[h.contact] == h.lookup -> "SAME_AS_AGGREGATE"
                else -> "DIFFERENT_FROM_AGGREGATE"
            }
            val phoneCount=if(p.complete) (ps?.rows ?: 0).toString() else "UNKNOWN"
            val valid=if(ps?.valid?.isNotEmpty() == true || dp?.valid?.isNotEmpty() == true || h.validPhone == true) "true" else if(p.complete && data.complete) "false" else "UNKNOWN"
            val unique=if(p.complete && data.complete) (ps?.valid.orEmpty()+dp?.valid.orEmpty()).toSet().size.toString() else "UNKNOWN"
            val linked=if(b.complete && h.contact != null) raws.values.count {it.contact == h.contact}.toString() else "UNKNOWN"
            val nameLink=when {h.nameRaw == null -> "NOT_EXPOSED";nameRaw == null -> if(b.complete) "RAW_ROW_ABSENT" else "UNKNOWN";
                nameRaw.contact != h.contact -> "CONTACT_ID_MISMATCH";else -> "VERIFIED"}
            details.add("source=${h.source}; contactId=${h.contact ?: "NULL"}; rawContactId=${h.raw ?: "NULL"}; rawContactLinkage=$linkage; phoneRowCount=$phoneCount; rawPhoneRowCount=${if(p.complete) rp?.rows ?: 0 else "UNKNOWN"}; dataPhoneRowCount=${if(data.complete) dp?.rows ?: 0 else "UNKNOWN"}; hasValidPhone=$valid; phoneRowHasValidPhone=${h.validPhone ?: "NA"}; uniqueValidPhoneCount=$unique; linkedRawCount=$linked; accountType=${raw?.account ?: "UNKNOWN"}; accountNamePresent=${raw?.accountPresent ?: "UNKNOWN"}; aggregationMode=${raw?.aggregation ?: "UNKNOWN"}; nameRawContactId=${h.nameRaw ?: "NOT_EXPOSED"}; nameRawContactLinkage=$nameLink; nameAccountType=${nameRaw?.account ?: "UNKNOWN"}; lookupKeyStatus=$lookup; nameFields=${h.fields.sorted().joinToString(",")}; dataKind=${h.mime}; index251Reason=${reason(h)}")
        }
        details.add("targetHitRows=${scans.sumOf {it.hitCount}}; detailLimit=$HIT_LIMIT; detailsTruncated=${scans.sumOf {it.hitCount} > HIT_LIMIT}; phoneNumbers=NOT_LOGGED; accountNames=NOT_LOGGED; lookupKeys=NOT_LOGGED; unrelatedNames=NOT_LOGGED; dataValues=NOT_LOGGED")
        return Report(summary,details)
    }
}
