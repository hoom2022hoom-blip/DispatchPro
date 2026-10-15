package com.maktab.calls

import android.app.Notification
import android.app.Person
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.Spanned
import android.text.style.URLSpan

/** One extraction pipeline, called only after positive incoming-call evidence. Values stay local. */
internal object NotificationCallIdentity {
    data class Result(val phone: String = "", val source: String = "", val detail: String = "", val ambiguous: Boolean = false, val originalPhone: String = "")
    private data class Field(val value: String, val path: String, val rank: Int, val identity: Boolean = false)
    private data class Snapshot(val fields: MutableList<Field> = mutableListOf(), val names: MutableList<Field> = mutableListOf(),
        val contacts: MutableList<Field> = mutableListOf(), val personTypes: MutableSet<String> = linkedSetOf(), var errors: Int = 0)
    private val textKeys = setOf(Notification.EXTRA_TITLE, Notification.EXTRA_TITLE_BIG, Notification.EXTRA_TEXT,
        Notification.EXTRA_SUB_TEXT, Notification.EXTRA_BIG_TEXT, Notification.EXTRA_INFO_TEXT,
        Notification.EXTRA_SUMMARY_TEXT, Notification.EXTRA_TEXT_LINES, Notification.EXTRA_CONVERSATION_TITLE)
    // These identify the local user or previous conversations, never the current remote caller.
    private val excluded = setOf("android.messagingUser", "android.selfDisplayName", "android.messages.historic",
        "android.remoteInputHistory", "android.remoteInputHistoryItems", "android.remoteInputDraft", "android.template")

    @Suppress("DEPRECATION")
    private fun snapshot(versions: List<Notification>): Snapshot {
        val out = Snapshot()
        fun string(value: String, path: String, rank: Int, identity: Boolean) {
            if (value.isBlank()) return
            if (value.startsWith("content:", true)) {
                if (identity) out.contacts.add(Field(value, path, rank, true))
                return // Never interpret a contact row ID as a phone number.
            }
            if(out.fields.size < 128) out.fields.add(Field(value.take(8192), path, rank, identity))
        }
        fun spans(value: CharSequence?, path: String, rank: Int) {
            if(value is Spanned) value.getSpans(0,value.length,URLSpan::class.java).forEach { span ->
                val uri=span.url.orEmpty()
                if(uri.startsWith("tel:",true) || uri.startsWith("content://com.android.contacts/"))
                    string(uri,"$path.urlSpan",rank,true)
            }
        }
        fun person(p: Person, path: String, rank: Int) {
            if (Build.VERSION.SDK_INT < 28) return
            out.personTypes.add(path.substringAfterLast('.'))
            string(p.uri.orEmpty(), "$path.uri", rank, true)
            string(p.key.orEmpty(), "$path.key", rank, true)
            spans(p.name,"$path.name",rank)
            p.name?.toString()?.let {
                string(it, "$path.name", rank, false)
                if (CallPhoneNumber.candidates(it).isEmpty()) out.names.add(Field(it, "$path.name", rank))
            }
        }
        fun walk(initial: Any?, initialPath: String, initialRank: Int, initialIdentity: Boolean) {
            data class Node(val value: Any?, val path: String, val rank: Int, val identity: Boolean)
            val pending = java.util.ArrayDeque<Node>()
            val visited = java.util.IdentityHashMap<Any, MutableSet<String>>()
            pending.add(Node(initial, initialPath, initialRank, initialIdentity))
            var budget = 512
            while (pending.isNotEmpty() && budget-- > 0) {
                val (value, path, rank, identity) = pending.removeFirst()
                val personBundle = path.contains("callPerson") || path.contains("people.list") || path.contains("sender_person")
                if (value is Bundle || value is Array<*> || value is Iterable<*>) {
                    val context = "$rank:$identity:$personBundle"
                    if (!visited.getOrPut(value) { mutableSetOf() }.add(context)) continue
                }
                when {
                value == null -> Unit
                Build.VERSION.SDK_INT >= 28 && value is Person -> person(value, path, rank)
                value is CharSequence -> { string(value.toString(), path, rank, identity);spans(value,path,rank) }
                value is Uri -> string(value.toString(), path, rank, true)
                value is Bundle -> value.keySet().sorted().filterNot { it in excluded }.forEach { key ->
                    val childRank = if (key == "sender_person" || key == "sender") 1 else rank
                    if (personBundle) out.personTypes.add(path.substringAfterLast('.') + ":Bundle")
                    runCatching {
                        val child = value.get(key)
                        if (personBundle && key == "name" && child is CharSequence && CallPhoneNumber.candidates(child.toString()).isEmpty())
                            out.names.add(Field(child.toString(), "$path.name", rank))
                        pending.add(Node(child, "$path.${safeKey(key)}", childRank, if (personBundle) key in setOf("uri", "key") else identity))
                    }.onFailure { out.errors++ }
                }
                value is Array<*> -> value.take(128).forEach { pending.add(Node(it, path, rank, identity)) }
                value is Iterable<*> -> value.take(128).forEach { pending.add(Node(it, path, rank, identity)) }
                // Numeric scalars, PendingIntents, icons, RemoteViews and arbitrary parcelables are not identities.
            }
            }
        }
        versions.forEachIndexed { index, n ->
            val prefix = if (index == 0) "notification" else "public"
            string(n.tickerText?.toString().orEmpty(), "$prefix.ticker", 2, false)
            spans(n.tickerText,"$prefix.ticker",2)
            n.extras.keySet().sorted().filterNot { it in excluded }.forEach { key ->
                val rank = when (key) { "android.callPerson" -> 0; "android.people.list", "android.people" -> 1; in textKeys -> 2; else -> 3 }
                runCatching { walk(n.extras.get(key), "$prefix.${safeKey(key)}", rank, key == "android.people") }.onFailure { out.errors++ }
            }
            if (Build.VERSION.SDK_INT >= 26) string(n.shortcutId.orEmpty(), "$prefix.shortcutId", 1, true)
        }
        return out
    }
    private fun safeKey(key: String): String = if (key.startsWith("android.") || key in setOf("sender_person", "sender", "text", "name", "uri", "key")) key.take(80) else "customExtra"
    private fun numbers(field: Field): List<String> {
        val value = Uri.decode(field.value).trim()
        if (field.identity && value.matches(Regex("[0-9]+@s\\.whatsapp\\.net"))) return listOfNotNull(CallPhoneNumber.normalize("+" + value.substringBefore('@')).takeIf(String::isNotBlank))
        // Opaque IDs/URLs cannot safely be substring-parsed. Plain phone-shaped Person keys are supported.
        if (field.identity) return listOfNotNull(CallPhoneNumber.normalize(value).takeIf(String::isNotBlank))
        if (value.contains("://") || value.contains('@')) return emptyList()
        if (field.rank >= 3) return emptyList()
        val callerField = field.path.endsWith(".name") || field.path.endsWith("android.title") || field.path.endsWith("android.title.big")
        if (callerField) return listOfNotNull(CallPhoneNumber.normalize(value).takeIf(String::isNotBlank))
        val patterns = listOf(Regex("(?i)^incoming(?: voice| video)? call from\\s+(.+)$"),
            Regex("(?i)^(.+?)\\s+is calling(?: you)?[.!…]*$"),
            Regex("^مكالمة(?: صوتية| فيديو)?(?: واردة)? من\\s+(.+)$"), Regex("^(.+?)\\s+يتصل بك[.!…]*$"))
        return patterns.firstNotNullOfOrNull { it.matchEntire(value)?.groupValues?.get(1) }
            ?.let { listOfNotNull(CallPhoneNumber.normalize(it).takeIf(String::isNotBlank)) }.orEmpty()
    }
    fun callerLabel(values: List<String>): String = callerLabels(values).firstOrNull().orEmpty()
    fun callerLabels(values: List<String>): List<String> {
        val patterns = listOf(Regex("(?i)^(.+?)\\s+is calling.*$"), Regex("(?i)^incoming(?: voice| video)? call from\\s+(.+)$"),
            Regex("^(.+?)\\s+يتصل بك.*$"), Regex("^مكالمة(?: صوتية| فيديو)?(?: واردة)? من\\s+(.+)$"))
        return values.mapNotNull { value ->
            val extracted = patterns.firstNotNullOfOrNull { it.find(value)?.groupValues?.getOrNull(1)?.trim() }
            val label = extracted ?: value.trim()
            label.takeIf { it.isNotBlank() && it.lowercase() !in setOf("whatsapp", "whatsapp business", "incoming", "call", "voice call", "video call", "مكالمة", "واتساب", "واردة") &&
                CallPhoneNumber.candidates(it).isEmpty() && !CallNotificationRules.incoming(listOf(it), emptyList()) && !CallNotificationRules.finished(listOf(it)) && !CallNotificationRules.ongoing(listOf(it)) && !CallNotificationRules.outgoing(listOf(it)) }
        }.distinctBy(ContactIndex::matchingKey)
    }
    fun names(versions: List<Notification>, values: List<String>): List<String> {
        val data = snapshot(versions)
        val rank = data.names.minOfOrNull { it.rank }
        // Preserve the original caller-title priority; subText can be an account/contact label.
        return (if (rank != null) data.names.filter { it.rank == rank }.map { it.value }
            else callerLabels(values).take(1)).distinctBy(ContactIndex::matchingKey)
    }
    fun resolve(versions: List<Notification>, values: List<String>, context: Context? = null, previousNames: List<String> = emptyList()): Result {
        val data = snapshot(versions)
        // Snapshot retains real field provenance. Flattened values may start with a body when title is absent.
        val candidates = data.fields.flatMap { f -> numbers(f).map { it to f } }
        val base = "persons=${data.personTypes.joinToString(",")}; nameFound=${data.names.isNotEmpty() || callerLabels(values).isNotEmpty()}; readErrors=${data.errors}"
        val best = candidates.minOfOrNull { it.second.rank }
        val personMetadata = "personPresent=${data.personTypes.isNotEmpty()}; persons=${data.personTypes.joinToString(",")}; personUri=${data.contacts.any { it.path.endsWith(".uri") } || data.fields.any { it.path.endsWith(".uri") }}; personKey=${data.contacts.any { it.path.endsWith(".key") } || data.fields.any { it.path.endsWith(".key") }}"
        val contactRank = data.contacts.minOfOrNull { it.rank }
        fun directNumber(): Result {
            val matches = candidates.filter { it.second.rank == best }
            val identities = matches.map { it.first }.distinct()
            val explicit=identities.mapNotNull(PhoneNormalizer::parse).filter {it.e164.isNotBlank()}
            val phones = identities.filterNot { value -> !value.startsWith('+') && explicit.count {it.display==value}==1 }
            if (phones.size != 1) return Result(ambiguous = true, source = "DIRECT_NUMBER_AMBIGUOUS", detail = "reason=CONFLICTING_DIRECT_NUMBERS; matchingStage=DIRECT_NUMBER; uniquePhones=${phones.size}; matchedContacts=0; $personMetadata; $base")
            val field = matches.first {it.first==phones.single()}.second
            val source = when { field.value.startsWith("tel:", true) -> "PHONE_FROM_TEL_URI"; field.path.contains("Person") || field.path.contains("people.list") || field.path.contains("sender_person") -> "PHONE_FROM_PERSON"; else -> "PHONE_FROM_NOTIFICATION" }
            return Result(phones.single(), source, "extractionSource=${if (source == "PHONE_FROM_TEL_URI" || field.value.endsWith("@s.whatsapp.net")) "PHONE_FROM_URI" else source}; field=${field.path}; matchingStage=DIRECT_NUMBER; matchedContacts=0; $personMetadata; $base",originalPhone=phones.single())
        }
        // A readable direct phone always precedes Contacts, even if a Person has a contact URI.
        if (best != null) return directNumber()
        if (context == null) return Result(detail = "reason=NO_DIRECT_NUMBER; $base")
        // Caller-specific CallStyle contact links outrank generic people/text names.
        val linked = data.contacts.filter { it.rank == contactRank }.map { ContactResolver.uri(context, it.value) }
        if (linked.any { it.status == ContactIndex.Status.CONTACT_AMBIGUOUS }) return Result(ambiguous = true, source = "CONTACT_AMBIGUOUS", detail = "reason=CONTACT_AMBIGUOUS; ${linked.joinToString(" | ") { it.detail }}; $personMetadata; $base")
        val linkedPhones = linked.map { it.phone }.filter(String::isNotBlank).distinct()
        if (linkedPhones.size > 1) return Result(ambiguous = true, source = "CONTACT_AMBIGUOUS", detail = "reason=CONFLICTING_LINKED_CONTACTS; ${linked.joinToString(" | ") { it.detail }}; $personMetadata; $base")
        if (linked.any { it.status == ContactIndex.Status.CONTACT_LOOKUP_ERROR }) return Result(source = "CONTACT_LOOKUP_ERROR", detail = "${linked.joinToString(" | ") { it.detail }}; $personMetadata; $base")
        if (linkedPhones.size == 1 && linked.any { it.status != ContactIndex.Status.CONTACT_RESOLVED }) return Result(ambiguous = true, source = "CONTACT_AMBIGUOUS", detail = "reason=UNRESOLVED_LINKED_IDENTITIES; $personMetadata; $base")
        if (linkedPhones.size == 1) return Result(linkedPhones.single(), "PHONE_FROM_CONTACTS", "extractionSource=PHONE_FROM_URI; field=person.contactUri; ${linked.first().detail}; $personMetadata; $base")
        // A real contact URI with no unique supported number must not fall back to another person's name.
        if (linked.any { it.detail.contains("matchedContacts=1") }) return Result(source = "CONTACT_NOT_FOUND", detail = "${linked.joinToString(" | ") { it.detail }}; $personMetadata; $base")
        val nameRank = data.names.minOfOrNull { it.rank }
        val rendered = values + data.fields.filter { it.rank == 2 && !it.identity }.map { it.value }
        // A supplied Person caller name is stronger evidence than decorative title/subText labels.
        val currentNames = (if (nameRank != null) data.names.filter { it.rank == nameRank }.map { it.value } else callerLabels(rendered).take(1))
        // A later caller-specific Person can replace an earlier weak notification title.
        // Keep historical labels for diagnostics, not as competing current Person identities.
        val names = (if (nameRank != null) currentNames else currentNames + previousNames).distinctBy(ContactIndex::matchingKey)
        val lookup = ContactResolver.names(context, names)
        val extractionSource = if (lookup.phone.isBlank()) "" else when {
            lookup.detail.contains("matchingStage=EXACT_STRUCTURED_ALIAS") -> "PHONE_FROM_CONTACT_STRUCTURED"
            lookup.detail.contains("matchingStage=EXACT_RAW") -> "PHONE_FROM_CONTACT_EXACT"
            lookup.detail.contains("matchingStage=EXACT_NORMALIZED") -> "PHONE_FROM_CONTACT_NORMALIZED"
            else -> "PHONE_FROM_CONTACT_SAFE_MATCH"
        }
        val platformLimit = when(lookup.status) {
            ContactIndex.Status.CONTACT_NOT_FOUND -> "pending=AWAITING_SESSION_ENRICHMENT; "
            ContactIndex.Status.CONTACT_PERMISSION_MISSING -> "stop=CONTACT_PERMISSION_DENIED; "
            ContactIndex.Status.CONTACT_AMBIGUOUS -> "stop=AMBIGUOUS_CONTACT; "
            else -> ""
        }
        val failureName = if (lookup.phone.isBlank()) names.firstOrNull()?.let {
            "rawWhatsAppName=\"${ContactNameNormalizer.diagnostic(it)}\"; normalizedWhatsAppName=\"${ContactNameNormalizer.diagnostic(ContactIndex.matchingKey(it))}\"; callerNameCount=${names.size}; "
        }.orEmpty() else ""
        return Result(lookup.phone, if (lookup.phone.isNotBlank()) "PHONE_FROM_CONTACTS" else lookup.status.name,
            "reason=${lookup.status.name}; ${platformLimit}extractionSource=$extractionSource; nameFound=${names.isNotEmpty()}; ${lookup.detail}; $failureName${if (lookup.detail.contains("matchedContacts=")) "" else "matchedContacts=NOT_DETERMINED; "}field=${if (nameRank != null) data.names.first { it.rank == nameRank }.path else "notification.callerLabel"}; $personMetadata; linkedStatuses=${linked.map { it.status }.distinct().joinToString(",")}; readErrors=${data.errors}", lookup.status == ContactIndex.Status.CONTACT_AMBIGUOUS)
    }
    fun structure(versions: List<Notification>): String {
        val data = snapshot(versions)
        return "personPresent=${data.personTypes.isNotEmpty()}; personTypes=${data.personTypes.joinToString(",")}; personUri=${data.contacts.any { it.path.endsWith(".uri") } || data.fields.any { it.path.endsWith(".uri") }}; personKey=${data.contacts.any { it.path.endsWith(".key") } || data.fields.any { it.path.endsWith(".key") }}; nameFound=${data.names.isNotEmpty()}; identityFields=${data.fields.count { it.identity }}; linkedUris=${data.contacts.size}; strings=${data.fields.size}; readErrors=${data.errors}; contentIntentPresent=${versions.any { it.contentIntent != null }}; contentIntentCreatorMatches=${versions.filter { it.contentIntent != null }.all { runCatching { it.contentIntent.creatorPackage in CallNotificationRules.packages }.getOrDefault(false) }}; pendingIntentExtras=NOT_PUBLIC"
    }
}
