package com.maktab.calls

import android.app.Notification
import android.app.Person
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RuntimeEnvironment
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.Locale
import java.util.TimeZone

@RunWith(RobolectricTestRunner::class) @Config(sdk=[34])
class Repair324AndroidTest {
    @Test fun palestineTimeIgnoresDeviceZoneAndArabicLocaleWithSummerAndWinterRules() {
        val oldZone=TimeZone.getDefault();val oldLocale=Locale.getDefault()
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("America/New_York"));Locale.setDefault(Locale.forLanguageTag("ar-PS"))
            assertEquals("2026-01-15 12:00:00",CallTime.format(1768471200000))
            assertEquals("2026-07-15 13:00:00",CallTime.format(1784109600000))
            assertEquals("2026-03-28 01:59:59",CallTime.format(1774655999000))
            assertEquals("2026-03-28 03:00:00",CallTime.format(1774656000000))
            assertEquals("—",formatCallTime("invalid"))
        } finally {TimeZone.setDefault(oldZone);Locale.setDefault(oldLocale)}
    }
    @Test fun originalNotificationTimeSurvivesProcessingDelayEnrichmentAckAndReconnect() {
        val app=RuntimeEnvironment.getApplication();val store=CallStore.get(app)
        val start=1784109600000L;val now=start+45000
        val id=store.observe("com.whatsapp.w4b","repair-time",now,callerName="حكمت قليل",strictAliases=true,eventTime=CallTime.incoming(start,now))!!
        assertEquals(start,JSONObject(store.pending().first {it.first==id}.second).getLong("timestamp"))
        store.enrich(id,listOf("حكمت قليل"),now+1000)
        assertTrue(store.capture("com.whatsapp.w4b","repair-time","0568602288",now+2000))
        val original=store.pending().first {it.first==id}
        assertEquals(start,JSONObject(original.second).getLong("timestamp"))
        store.ack(id,"com.whatsapp.w4b","0568602288","fixture",original.second)
        assertFalse(store.capture("com.whatsapp.w4b","repair-time","0568602288",now+3000))
        assertFalse(store.pending().any {it.first==id})
        assertEquals(start,store.history().first {it.getString("eventId")==id}.getLong("timestamp"))
        assertEquals(start.toString(),store.state("last_call_time"))
        assertEquals(now,CallTime.incoming(0,now))
    }
    @Test fun profileOnlyNameDoesNotInventPhoneButRealPersonPhoneIsExtracted() {
        val app=RuntimeEnvironment.getApplication()
        fun call(person:Person)=Notification.Builder(app,"calls").setSmallIcon(android.R.drawable.sym_call_incoming)
            .setContentTitle("حكمت قليل").setContentText("مكالمة صوتية واردة").build().apply {extras.putParcelable("android.callPerson",person)}
        val nameOnly=call(Person.Builder().setName("حكمت قليل").build())
        assertEquals("",NotificationCallIdentity.resolve(listOf(nameOnly),listOf("حكمت قليل"),app).phone)
        val actual=call(Person.Builder().setName("حكمت قليل").setUri("tel:+972 56-860-2288").build())
        assertEquals("+972568602288",NotificationCallIdentity.resolve(listOf(actual),emptyList(),app).phone)
        assertEquals("+972568602288",PhoneNormalizer.extract("\u2066+972 56-860-2288\u2069"))
    }
}
