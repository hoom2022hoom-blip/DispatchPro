package com.maktab.calls

import com.google.i18n.phonenumbers.PhoneNumberUtil

/** Country metadata applies only to explicit international identities. Local numbers have no guessed region. */
internal object PhoneNormalizer {
    data class Number(val identity: String, val display: String, val e164: String = "", val reason: String)
    private val util by lazy { PhoneNumberUtil.getInstance() }
    fun clean(value: String): String {
        if (value.length > 160) return ""
        val text = java.text.Normalizer.normalize(value, java.text.Normalizer.Form.NFKC)
            .replace(Regex("\\p{Cf}"), "").trim().replace(Regex("(?i)^tel:"), "")
        if (text.any { Character.digit(it, 10) < 0 && it !in "+().-" && Character.getType(it) != Character.DASH_PUNCTUATION.toInt() && !Character.isWhitespace(it) && !Character.isSpaceChar(it) }) return ""
        if (text.count { it == '+' } > 1 || ('+' in text && !text.startsWith('+'))) return ""
        return (if (text.startsWith('+')) "+" else "") + text.mapNotNull { Character.digit(it, 10).takeIf { d -> d >= 0 } }.joinToString("")
    }
    // PS is the office's existing IDD convention; it never supplies a caller country for local input.
    fun parse(value: String, iddRegion: String = "PS"): Number? {
        val cleaned = clean(value)
        if (cleaned.isBlank()) return null
        if (!cleaned.startsWith('+') && !cleaned.startsWith("00")) {
            if (cleaned.length !in 4..17 || cleaned.all { it == '0' }) return null
            return Number(cleaned, cleaned, reason = "LOCAL_REGION_UNKNOWN")
        }
        val parsed = runCatching { util.parse(cleaned, if (cleaned.startsWith('+')) "ZZ" else iddRegion) }.getOrNull()
        if (parsed != null) {
            val e164 = util.format(parsed, PhoneNumberUtil.PhoneNumberFormat.E164)
            val inputDigits = if (cleaned.startsWith("00")) cleaned.drop(2) else cleaned.drop(1)
            // No source digits may disappear through permissive library repair or an unrecognized IDD.
            if (util.isPossibleNumber(parsed) && e164.drop(1) == inputDigits) {
                val national = util.format(parsed, PhoneNumberUtil.PhoneNumberFormat.NATIONAL)
                val display = clean(national).takeIf { it.isNotBlank() && !it.startsWith('+') } ?: e164
                return Number(e164, display, e164, if (display == e164) "NATIONAL_FORMAT_UNAVAILABLE" else if(util.isValidNumber(parsed)) "VALID_INTERNATIONAL" else "POSSIBLE_INTERNATIONAL")
            }
        }
        val body = if (cleaned.startsWith('+')) cleaned.drop(1) else cleaned.drop(2)
        if (!body.matches(Regex("[1-9][0-9]{6,14}"))) return null
        return Number(cleaned, cleaned, reason = "INTERNATIONAL_UNVERIFIED")
    }
    fun identity(value: String): String = parse(value)?.identity.orEmpty()
    fun normalize(value: String): String = parse(value)?.display.orEmpty()
    fun extract(value: String): String {
        identity(value).takeIf(String::isNotBlank)?.let {return it}
        val patterns=listOf(Regex("(?i)^incoming(?: voice| video)? call from\\s+(.+)$"),
            Regex("^مكالمة(?: صوتية| فيديو)?(?: واردة)? من\\s+(.+)$"),Regex("^اتصال وارد من\\s+(.+)$"))
        return patterns.firstNotNullOfOrNull {it.matchEntire(value.trim())?.groupValues?.get(1)}?.let(::identity).orEmpty()
    }
    fun candidates(value: String): List<String> {
        val ascii = buildString {
            for (c in java.text.Normalizer.normalize(value.take(8192), java.text.Normalizer.Form.NFKC)) when {
                Character.getType(c) == Character.FORMAT.toInt() -> Unit
                Character.digit(c, 10) >= 0 -> append(Character.digit(c, 10))
                Character.getType(c) == Character.DASH_PUNCTUATION.toInt() -> append('-')
                else -> append(c)
            }
        }
        return Regex("(?<![\\p{L}\\p{N}+])(?:\\+|00)?[0-9][0-9 ()\\-\\p{Zs}\\t]{4,}[0-9](?![\\p{L}\\p{N}])")
            .findAll(ascii).mapNotNull { identity(it.value).takeIf(String::isNotBlank) }.distinct().toList()
    }
}
