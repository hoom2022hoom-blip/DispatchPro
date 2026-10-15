package com.maktab.calls

internal object Legacy260PhoneNumber {
    fun extract(value: String): String = candidates(value).singleOrNull().orEmpty()

    fun candidates(value: String): List<String> {
        val ascii = buildString {
            for (character in value) {
                when {
                    character == '\u061c' || character in '\u200e'..'\u200f' || character in '\u202a'..'\u202e' || character in '\u2066'..'\u2069' -> Unit
                    Character.digit(character, 10) >= 0 -> append(Character.digit(character, 10))
                    Character.getType(character) == Character.DASH_PUNCTUATION.toInt() -> append('-')
                    else -> append(character)
                }
            }
        }
        val candidates = Regex("(?<![\\p{L}\\p{N}+])(?:\\+|00)?[0-9][0-9 ()\\-\\s\\p{Zs}]{5,}[0-9](?![\\p{L}\\p{N}])")
            .findAll(ascii).flatMap { match ->
                val phone = normalize(match.value)
                if (phone.isNotBlank()) listOf(phone).asSequence() else splitCompleteNumbers(match.value).asSequence()
            }.distinct().toList()
        return candidates
    }

    // A field can repeat a phone or contain two phones separated only by whitespace.
    // Accept a partition only if EVERY piece is a complete supported phone; never truncate a long number.
    private fun splitCompleteNumbers(value: String): Set<String> {
        val tokens = value.split(Regex("[\\s\\p{Zs}]+"))
        val valid = arrayOfNulls<Set<String>>(tokens.size + 1)
        valid[tokens.size] = emptySet()
        for (start in tokens.indices.reversed()) {
            val possibilities = linkedSetOf<String>()
            var found = false
            for (end in start + 1..tokens.size) {
                val remainder = valid[end] ?: continue
                val number = normalize(tokens.subList(start, end).joinToString(" "))
                if (number.isNotBlank()) { possibilities.add(number); possibilities.addAll(remainder); found = true }
            }
            if (found) valid[start] = possibilities
        }
        return valid[0].orEmpty()
    }

    fun normalize(value: String): String {
        val formatted = value.replace(Regex("(?i)^tel:"), "").replace(Regex("[\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]"), "")
            .replace(Regex("\\p{Pd}"), "-").trim()
        if (formatted.any { Character.digit(it, 10) < 0 && it !in "+()-" && !Character.isWhitespace(it) && !Character.isSpaceChar(it) }) return ""
        if (formatted.count { it == '+' } > 1 || ('+' in formatted && !formatted.startsWith('+'))) return ""
        var digits = formatted.mapNotNull { Character.digit(it, 10).takeIf { digit -> digit >= 0 } }.joinToString("")
        val international = digits.startsWith("00970") || digits.startsWith("00972") || digits.startsWith("970") || digits.startsWith("972")
        if (formatted.startsWith('+') && !international) return ""
        digits = when {
            digits.startsWith("00970") || digits.startsWith("00972") -> digits.drop(5)
            digits.startsWith("970") || digits.startsWith("972") -> digits.drop(3)
            else -> digits
        }
        if (international && (digits.length !in 8..9 || digits.startsWith("0"))) return ""
        if (international) digits = "0$digits"
        return digits.takeIf { Regex("(?:0(?:59|56)[0-9]{7}|09[0-9]{7})").matches(it) }.orEmpty()
    }
}
