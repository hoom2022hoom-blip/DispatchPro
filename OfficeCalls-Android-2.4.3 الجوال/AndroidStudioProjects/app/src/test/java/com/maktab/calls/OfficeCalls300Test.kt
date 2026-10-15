package com.maktab.calls

import org.junit.Assert.*
import org.junit.Test

class OfficeCalls300Test {
    @Test fun countryCodesAndUnicodeShareOneCanonicalPhone() {
        val formats=listOf("+972 59 123 4567", "+972 591234567", "+972-59-123-4567", "+972 (59) 1234567", "00972 59 123 4567", "+970 59 123 4567", "+970591234567", "00970 59 123 4567", "059 123 4567", "059-123-4567", "+972   59   123  4567", "+٩٧٢ ٥٩ ١٢٣ ٤٥٦٧", "+۹۷۲ ۵۹ ۱۲۳ ۴۵۶۷")
        formats.forEach { assertEquals(it,"0591234567",PhoneNormalizer.normalize(it));assertEquals(it,PhoneNormalizer.identity(it),PhoneNormalizer.extract("اتصال وارد من $it")) }
        listOf('\u00a0','\u202f','\u200b','\u200e','\u200f','\u2066','\u2069','\ufeff').forEach { space ->
            val input="+972${space}59${space}123${space}4567"
            assertEquals("U+${space.code.toString(16)}","0591234567",PhoneNormalizer.normalize(input))
            assertEquals("+972591234567",PhoneNormalizer.extract(input))
        }
        listOf("+972 56 123 4567","+970 56 123 4567","0561234567").forEach {assertEquals("0561234567",PhoneNormalizer.normalize(it))}
    }
    @Test fun foreignInvalidAndMultipleNumbersNeverBecomeOnePalestinianPhone() {
        listOf("+1 591234567","+44 591234567","00591234567","+972 0591234567").forEach {assertFalse(it,PhoneNormalizer.normalize(it).startsWith("059"))}
        listOf("059123456","05912345678").forEach {assertEquals(it,it,PhoneNormalizer.normalize(it))}
        listOf("name0591234567","0591234567/0561234567").forEach {assertEquals(it,"",PhoneNormalizer.normalize(it))}
        assertEquals("",PhoneNormalizer.extract("0591234567 0561234567"))
        assertEquals("",PhoneNormalizer.extract("+972\u200b591234567\u200b0561234567"))
        assertEquals("",PhoneNormalizer.extract("referenceABC0591234567DEF"))
    }
    @Test fun canonicalNameMatchesRamziWithDiacriticsAndDirection() {
        assertEquals(ContactIndex.matchingKey("رمزي دياب"),ContactIndex.matchingKey("\u200fرَمْـزِي  دِياب\u200e"))
        assertNotEquals(ContactIndex.matchingKey("رمزي دياب"),ContactIndex.matchingKey("رمزي خطاب"))
    }
}
