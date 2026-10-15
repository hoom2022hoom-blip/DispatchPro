package com.maktab.calls

import java.text.Normalizer
import java.util.Locale

/** One comparison policy shared by caller labels, every alias, tokens and diagnostics. */
internal object ContactNameNormalizer {
    data class Name(val raw: String, val normalized: String) {
        val tokens: List<String> get() = normalized.split(' ').filter(String::isNotBlank)
    }

    // Kept for the public presentation helper; comparison always uses name().
    fun display(value: String): String {
        val canonical = Normalizer.normalize(value, Normalizer.Form.NFKC)
        return buildString {
            canonical.codePoints().forEach { cp ->
                when {
                    Character.getType(cp) == Character.FORMAT.toInt() -> Unit
                    Character.isWhitespace(cp) || Character.isSpaceChar(cp) || cp.toChar() in "()[]{},;،؛" -> append(' ')
                    else -> appendCodePoint(cp)
                }
            }
        }.trim().trim('"', '\'', '“', '”', '‘', '’').replace(Regex("\\s+"), " ").lowercase(Locale.ROOT)
    }

    fun name(value: String): Name {
        val canonical = Normalizer.normalize(value, Normalizer.Form.NFKC).lowercase(Locale.ROOT)
        val cleaned = buildString {
            canonical.codePoints().forEach { cp ->
                val type = Character.getType(cp)
                when {
                    cp == 0x640 || type == Character.FORMAT.toInt() -> Unit
                    // Arabic vowel marks only: do not erase accents that distinguish Latin names.
                    cp in 0x610..0x61a || cp in 0x64b..0x65f || cp == 0x670 || cp in 0x6d6..0x6ed -> Unit
                    cp in listOf(0x622, 0x623, 0x625, 0x671) -> append('ا')
                    cp == 0x649 -> append('ي')
                    Character.digit(cp, 10) >= 0 -> append(Character.digit(cp, 10))
                    Character.isLetter(cp) || type == Character.NON_SPACING_MARK.toInt() || type == Character.COMBINING_SPACING_MARK.toInt() -> appendCodePoint(cp)
                    else -> append(' ')
                }
            }
        }.trim().replace(Regex("\\s+"), " ")
        // Conventional Arabic compounds may be stored joined or separated (2.4.8 compatibility).
        val normalized = cleaned.split(' ').joinToString(" ") { token ->
            when {
                token.startsWith("ابو") && token.length > 3 && token.drop(3).all { it in '\u0621'..'\u064a' } -> "ابو ${token.drop(3)}"
                token.startsWith("عبد") && token.length > 3 && token.drop(3).all { it in '\u0621'..'\u064a' } -> "عبد ${token.drop(3)}"
                else -> token
            }
        }
        return Name(value, normalized)
    }

    /** ة/ه equivalence is opt-in for the last, conservative stages only. */
    fun flexible(value: String): String = value.split(' ').joinToString(" ") { it.removeSuffix("ة") + if (it.endsWith('ة')) "ه" else "" }

    fun diagnostic(value: String): String = buildString {
        value.codePoints().limit(96).forEach { cp ->
            when {
                Character.getType(cp) == Character.FORMAT.toInt() || Character.isISOControl(cp) || cp == ';'.code || cp == '"'.code || cp == '\\'.code -> append(String.format(Locale.ROOT, "\\u%04x", cp))
                else -> appendCodePoint(cp)
            }
        }
        if (value.codePointCount(0, value.length) > 96) append('…')
    }
}
