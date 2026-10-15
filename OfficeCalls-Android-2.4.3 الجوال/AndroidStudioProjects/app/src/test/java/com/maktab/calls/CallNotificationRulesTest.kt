package com.maktab.calls

import org.junit.Assert.*
import org.junit.Test

class CallNotificationRulesTest {
    @Test fun supportedPackages() {
        assertEquals(setOf("com.whatsapp", "com.whatsapp.w4b"), CallNotificationRules.packages)
    }
    @Test fun allPalestinianFormatsNormalizeToExistingLocalFormat() {
        for (prefix in listOf("59", "56")) for (format in listOf("0${prefix}1234567", "+970${prefix}1234567", "00970${prefix}1234567",
            "+970 ($prefix) 123-4567", "0$prefix 123 4567", "0$prefix-123-4567")) {
            assertEquals("0${prefix}1234567", PhoneNormalizer.normalize(CallPhoneNumber.extract(format)))
        }
        assertEquals("+970561234567", CallPhoneNumber.extract("٠٠٩٧٠ (٥٦) ١٢٣-٤٥٦٧"))
        assertEquals("0591234567", CallPhoneNumber.extract("۰۵۹۱۲۳۴۵۶۷"))
        assertEquals("+970591234567", CallPhoneNumber.extract("+970\u00a059\u00a01234567"))
    }
    @Test fun invalidAndAmbiguousNumbersAreNeverGuessed() {
        for (value in listOf("12", "Order1234567", "0561234567 / 0591234567", "Alice 123456789"))
            assertEquals(value, "", CallPhoneNumber.extract(value))
        assertEquals("", CallPhoneNumber.normalize("Alice 0591234567"))
        for(value in listOf("1234567","05912345678","059123456")) assertEquals(value,CallPhoneNumber.extract(value))
        assertEquals("", CallNotificationRules.number(listOf("0591234567", "0561234567")))
    }
    @Test fun incomingSavedAndUnsavedNotifications() {
        assertTrue(CallNotificationRules.incoming(listOf("Alice", "Incoming voice call"), emptyList()))
        assertEquals("", CallNotificationRules.number(listOf("Alice", "Incoming voice call")))
        assertTrue(CallNotificationRules.incoming(listOf("+970591234567", "مكالمة فيديو واردة"), emptyList()))
        assertEquals("+970591234567", CallNotificationRules.number(listOf("+970591234567", "مكالمة فيديو واردة")))
        assertTrue(CallNotificationRules.incoming(emptyList(), listOf("Answer", "Decline")))
        assertTrue(CallNotificationRules.incoming(emptyList(), emptyList(), 1))
    }
    @Test fun messageReplyAndOutgoingAreNotIncomingCalls() {
        assertFalse(CallNotificationRules.incoming(listOf("Alice", "Hello 0591234567"), listOf("Reply", "Mark as read")))
        assertFalse(CallNotificationRules.incoming(listOf("Alice"), listOf("رد")))
        assertFalse(CallNotificationRules.incoming(listOf("Outgoing call"), emptyList()))
        assertFalse(CallNotificationRules.incoming(emptyList(), emptyList(), 2))
        assertTrue(CallNotificationRules.finished(listOf("مكالمة فائتة")))
    }
}
