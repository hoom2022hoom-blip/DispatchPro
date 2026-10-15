package com.maktab.calls

import android.app.Notification
import android.app.Person
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RuntimeEnvironment
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NotificationCallIdentityAndroidTest {
    private fun notification() = Notification.Builder(RuntimeEnvironment.getApplication(), "calls")
        .setSmallIcon(android.R.drawable.sym_call_incoming).setCategory(Notification.CATEGORY_CALL).build()
    @Test fun callPersonTelWinsBeforeRenderedContactLabelOrUnrelatedNumber() {
        val n = notification()
        n.extras.putParcelable("android.callPerson", Person.Builder().setName("ابو الصادق مصنع الطوب").setUri("tel:%2B972%2059-503-1462").build())
        val result = NotificationCallIdentity.resolve(listOf(n), listOf("ابو الصادق مصنع الطوب", "0561234567"))
        assertEquals("0595031462", PhoneNormalizer.normalize(result.phone)); assertEquals("PHONE_FROM_TEL_URI", result.source)
        assertTrue(result.detail.contains("callPerson.uri"))
        assertFalse(NotificationCallIdentity.structure(listOf(n)).contains("ابو الصادق"))
    }
    @Test fun personNamePeopleLegacyAndShortcutHaveExplicitSources() {
        val n = notification()
        n.extras.putParcelableArrayList(Notification.EXTRA_PEOPLE_LIST, arrayListOf(Person.Builder().setName("+970 56-503-1462").build()))
        assertEquals("PHONE_FROM_PERSON", NotificationCallIdentity.resolve(listOf(n), emptyList()).source)
        n.extras.remove(Notification.EXTRA_PEOPLE_LIST)
        n.extras.putStringArray(Notification.EXTRA_PEOPLE, arrayOf("tel:0595031462"))
        assertEquals("0595031462", PhoneNormalizer.normalize(NotificationCallIdentity.resolve(listOf(n), emptyList()).phone))
        n.extras.putStringArray(Notification.EXTRA_PEOPLE, arrayOf("972595031462@s.whatsapp.net"))
        assertEquals("PHONE_FROM_NOTIFICATION", NotificationCallIdentity.resolve(listOf(n), emptyList()).source)
        n.extras.remove(Notification.EXTRA_PEOPLE)
        val shortcut = Notification.Builder(RuntimeEnvironment.getApplication(), "calls").setSmallIcon(android.R.drawable.sym_call_incoming)
            .setShortcutId("972595031462@s.whatsapp.net").build()
        assertEquals("0595031462", PhoneNormalizer.normalize(NotificationCallIdentity.resolve(listOf(shortcut), emptyList()).phone))
    }
    @Test fun unsavedPhoneAndPublicVersionResolveWithCallerFieldProvenance() {
        val title=notification();title.extras.putString(Notification.EXTRA_TITLE,"+972 59-503-1462")
        assertEquals("0595031462", PhoneNormalizer.normalize(NotificationCallIdentity.resolve(listOf(title),emptyList()).phone))
        val from=notification();from.extras.putString(Notification.EXTRA_TEXT,"مكالمة صوتية واردة من 0565031462")
        assertEquals("0565031462", PhoneNormalizer.normalize(NotificationCallIdentity.resolve(listOf(from),emptyList()).phone))
        val unrelated=notification();unrelated.extras.putString(Notification.EXTRA_TITLE,"Factory 0595031462")
        assertEquals("",NotificationCallIdentity.resolve(listOf(unrelated),listOf("Factory 0595031462","Incoming voice call")).phone)
        val public = notification(); public.extras.putParcelable("android.callPerson", Person.Builder().setUri("tel:+970595031462").build())
        assertEquals("0595031462", PhoneNormalizer.normalize(NotificationCallIdentity.resolve(listOf(notification(), public), listOf("Alice")).phone))
    }
    @Test fun conflictingIdentitiesNeverFallbackAndPhoneShapedKeysAreSupported() {
        val n = notification()
        n.extras.putParcelableArrayList(Notification.EXTRA_PEOPLE_LIST, arrayListOf(Person.Builder().setUri("tel:0595031462").build(), Person.Builder().setUri("tel:0565031462").build()))
        assertTrue(NotificationCallIdentity.resolve(listOf(n), listOf("Alice")).ambiguous)
        n.extras.remove(Notification.EXTRA_PEOPLE_LIST)
        n.extras.putParcelable("android.callPerson", Person.Builder().setKey("0595031462").setUri("content://contacts/0595031462").setName("Alice").build())
        assertEquals("0595031462", PhoneNormalizer.normalize(NotificationCallIdentity.resolve(listOf(n), listOf("Alice")).phone))
    }
}
