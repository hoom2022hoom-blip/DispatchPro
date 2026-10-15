package com.maktab.calls

import java.util.Locale

/** Scores identities, not rows. Never break a tie by provider order or by phone availability. */
internal object ContactNameMatcher {
    data class Alias(val name: ContactNameNormalizer.Name, val source: String)
    data class Entry(val id: Long, val aliases: MutableList<Alias> = mutableListOf(), val lookupKeys: MutableSet<String> = linkedSetOf()) {
        fun add(raw: String, source: String) {
            val name = ContactNameNormalizer.name(raw)
            if (name.normalized.isNotBlank() && aliases.none { it.name.raw == raw && it.source == source }) aliases.add(Alias(name, source))
        }
    }
    data class Candidate(val entry: Entry, val alias: Alias, val score: Double, val stage: String, val rejection: String = "")
    data class Match(val ids: Set<Long>, val stage: String, val candidates: List<Candidate>)
    private val generic = setOf("ابو", "ام", "عبد", "ال", "السيد", "السيدة", "الحاج", "دكتور", "د", "mr", "mrs", "dr", "call", "caller", "whatsapp", "business", "مكالمة", "متصل")
    private val descriptors = setOf("whatsapp", "business", "work", "mobile", "واتساب", "واتس", "بيزنس", "عمل", "موبايل")

    private fun informative(tokens: List<String>): Boolean = tokens.count { it.length >= 2 && it !in generic && it.any(Char::isLetter) } >= 2
    private fun tokenMatch(a: List<String>, b: List<String>): Boolean {
        if (!informative(a) || !informative(b)) return false
        if (a.sorted() == b.sorted()) return true
        // Remove only a known, trailing platform description; arbitrary partial names never qualify.
        fun core(tokens: List<String>) = tokens.dropLastWhile { it in descriptors }
        return core(a).sorted() == core(b).sorted() && informative(core(a)) && informative(core(b))
    }
    private fun distance(a: String, b: String): Int {
        var previous = IntArray(b.length + 1) { it }
        for (i in a.indices) {
            val row = IntArray(b.length + 1); row[0] = i + 1
            for (j in b.indices) row[j + 1] = minOf(row[j] + 1, previous[j + 1] + 1, previous[j] + if (a[i] == b[j]) 0 else 1)
            previous = row
        }
        return previous[b.length]
    }
    private fun candidate(entry: Entry, alias: Alias, caller: ContactNameNormalizer.Name): Candidate {
        val a = caller.normalized; val b = alias.name.normalized
        if (a == b) return Candidate(entry, alias, 1.0, when {
            caller.raw == alias.name.raw && !alias.source.startsWith("StructuredName") -> "EXACT_RAW"
            alias.source.startsWith("StructuredName") -> "EXACT_STRUCTURED_ALIAS"
            else -> "EXACT_NORMALIZED"
        })
        // Restore the original full Arabic name key when WhatsApp/provider formatting
        // joins words. No changed letters, substring, family-name-only or Latin compaction.
        // Every competing aggregate still participates, so boundary collisions are ambiguous.
        val compactA=a.replace(" ",""); val compactB=b.replace(" ","")
        if(compactA==compactB && compactA.length>=8 && compactA.all {it in '\u0621'..'\u064a'} &&
            (informative(caller.tokens) || informative(alias.name.tokens)))
            return Candidate(entry,alias,.995,"LEGACY_FULL_ARABIC_COMPACT")
        if (tokenMatch(caller.tokens, alias.name.tokens)) return Candidate(entry, alias, .99, "SAFE_TOKENS")
        val fa = ContactNameNormalizer.flexible(a); val fb = ContactNameNormalizer.flexible(b)
        if (fa == fb && informative(caller.tokens) && informative(alias.name.tokens)) return Candidate(entry, alias, .98, "FLEXIBLE_TA_MARBUTA")
        val length = maxOf(a.length, b.length)
        val edits = if (length <= 160) distance(a, b) else length
        val score = if (length == 0) 0.0 else 1.0 - edits.toDouble() / length
        val tokensA = caller.tokens; val tokensB = alias.name.tokens
        // Only one typo in a long multi-part name, with two unchanged informative tokens.
        val anchors = tokensA.toSet().intersect(tokensB.toSet()).count { it !in generic && it.length >= 2 && it.any(Char::isLetter) }
        val rejection = when {
            length > 160 -> "NAME_LENGTH_LIMIT"
            tokensA.filter { it.any(Char::isDigit) } != tokensB.filter { it.any(Char::isDigit) } -> "NUMERIC_TOKEN_CHANGED"
            !informative(tokensA) || !informative(tokensB) -> "INSUFFICIENT_DISTINCTIVE_TOKENS"
            tokensA.size < 3 || tokensA.size != tokensB.size -> "TOKEN_COUNT_OR_PARTIAL_NAME"
            length < 18 -> "SHORT_NAME_NO_FUZZY"
            edits != 1 -> "MORE_THAN_ONE_EDIT"
            score < .94 -> "BELOW_FUZZY_THRESHOLD"
            anchors < 2 -> "INSUFFICIENT_UNCHANGED_ANCHORS"
            else -> "FUZZY_DIAGNOSTIC_ONLY"
        }
        return Candidate(entry, alias, score, "CONSERVATIVE_FUZZY", rejection)
    }
    fun match(entries: Collection<Entry>, rawNames: List<String>): Match {
        val callers = rawNames.map(ContactNameNormalizer::name).filter { it.normalized.isNotBlank() }
        val candidates = entries.mapNotNull { entry ->
            entry.aliases.flatMap { alias -> callers.map { candidate(entry, alias, it) } }.sortedWith(
                compareByDescending<Candidate> { it.rejection.isEmpty() }.thenByDescending { it.score }.thenBy { stageOrder(it.stage) }
            ).firstOrNull()
        }.sortedByDescending { it.score }
        val strong = candidates.filter { it.rejection.isEmpty() && it.stage != "CONSERVATIVE_FUZZY" }
        // Also guard against a plausible typo neighbour, even if the best row is exact.
        val eligible = candidates.filter { it.rejection.isEmpty() }
        if (strong.isNotEmpty()) {
            val ids = eligible.map { it.entry.id }.toSet()
            val best = strong.minBy { stageOrder(it.stage) }
            return Match(ids, if (ids.size > 1) "AMBIGUOUS_IDENTITIES" else best.stage, candidates)
        }
        val best = eligible.firstOrNull()
        if (best == null) return Match(emptySet(), "NO_SAFE_MATCH", candidates)
        val second = candidates.firstOrNull { it.entry.id != best.entry.id }
        if (eligible.size > 1 || (second != null && best.score - second.score < .08))
            return Match((listOf(best) + listOfNotNull(second)).map { it.entry.id }.toSet(), "FUZZY_MARGIN_AMBIGUOUS", candidates)
        return Match(setOf(best.entry.id), best.stage, candidates)
    }
    private fun stageOrder(stage: String) = when (stage) { "EXACT_RAW" -> 0; "EXACT_NORMALIZED" -> 1; "EXACT_STRUCTURED_ALIAS" -> 2; "LEGACY_FULL_ARABIC_COMPACT" -> 3; "SAFE_TOKENS" -> 4; "FLEXIBLE_TA_MARBUTA" -> 5; else -> 6 }
    fun diagnostics(match: Match): String = match.candidates.take(3).mapIndexed { index, c ->
        "candidate${index + 1}=\"${ContactNameNormalizer.diagnostic(c.alias.name.normalized)}\",score=${String.format(Locale.ROOT, "%.3f", c.score)},rejected=${if (match.ids.size > 1) "AMBIGUOUS_IDENTITIES" else c.rejection.ifBlank { "NOT_SELECTED" }}"
    }.joinToString("; ")
}
