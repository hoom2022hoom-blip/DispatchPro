package com.maktab.calls
import org.junit.Assert.*
import org.junit.Test
class CallPhoneNumberTest {
    @Test fun arabicDigitsAndDirections() {
        assertEquals("+970591234567",CallPhoneNumber.extract("\u200f+٩٧٠ ٥٩-١٢٣٤٥٦٧\u200e"))
        assertEquals("+970591234567",CallPhoneNumber.extract("tel:+970591234567"))
    }
    @Test fun refusesAmbiguousAndNonNumbers() {
        assertEquals("",CallPhoneNumber.extract("Alice"))
        assertEquals("",CallPhoneNumber.extract("0591234567 / 0597654321"))
        assertEquals("",CallPhoneNumber.extract("12345678901234567890123"))
    }
    @Test fun explicitCountriesRemainDistinctWithoutGuessingLocalCountry() {
        assertEquals("0595031462",CallPhoneNumber.normalize("0595031462"))
        assertEquals("+972595031462",CallPhoneNumber.normalize("+972 59-503-1462"))
        assertEquals("+970595031462",CallPhoneNumber.normalize("00970 59 503 1462"))
        assertNotEquals(CallPhoneNumber.normalize("+972595031462"),CallPhoneNumber.normalize("+970595031462"))
        assertEquals("972595031462",CallPhoneNumber.normalize("972595031462"))
        assertEquals("",CallPhoneNumber.normalize("tel:+972595031462;ext=4"))
    }
}
