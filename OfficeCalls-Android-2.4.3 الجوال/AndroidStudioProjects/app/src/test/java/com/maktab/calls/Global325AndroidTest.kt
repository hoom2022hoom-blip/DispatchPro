package com.maktab.calls

import android.app.Notification
import android.app.Person
import android.content.Context
import android.os.UserHandle
import android.service.notification.StatusBarNotification
import com.google.i18n.phonenumbers.PhoneNumberUtil
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RuntimeEnvironment
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class) @Config(sdk=[34])
class Global325AndroidTest {
    private lateinit var app: Context
    private lateinit var store: CallStore
    @Before fun setup() {
        app=RuntimeEnvironment.getApplication();store=CallStore.get(app)
        for(table in listOf("outbox","call_history","sessions","aliases","call_metadata","state","diagnostics","delivery")) store.writableDatabase.delete(table,null,null)
        NetworkSender.localRequest={_,_->throw java.io.IOException("OFFLINE_FIXTURE")}
    }
    @After fun reset() {
        val done=CountDownLatch(1);NetworkSender.flush(app){done.countDown()};assertTrue(done.await(15,TimeUnit.SECONDS))
        NetworkSender.localRequest=LocalReceiverTransport::request
    }
    private fun ring(id: Int, title: String, text: String="Incoming voice call", person: Person?=null): StatusBarNotification {
        val n=Notification.Builder(app,"calls").setSmallIcon(android.R.drawable.sym_call_incoming).setContentTitle(title).setContentText(text).setCategory(Notification.CATEGORY_CALL).build()
        person?.let {n.extras.putParcelable("android.callPerson",it)}
        return StatusBarNotification("com.whatsapp.w4b","com.whatsapp.w4b",id,null,1000,0,0,n,UserHandle.getUserHandleForUid(0),System.currentTimeMillis())
    }
    @Test fun requiredAndWorldwideNationalDisplays() {
        val examples=mapOf("+972521234567" to "0521234567","+970592081197" to "0592081197","+966501234567" to "0501234567",
            "+12025550123" to "2025550123","+442079460018" to "02079460018","+33142345678" to "0142345678",
            "+39066982" to "066982","+819012345678" to "09012345678","+8613812345678" to "13812345678",
            "+919876543210" to "09876543210","+5511987654321" to "11987654321")
        examples.forEach { (international, local) ->
            val p=PhoneNormalizer.parse(international)!!;assertEquals(international,p.e164);assertEquals(local,p.display)
        }
    }
    @Test fun allCallingCodesAndRegionsExportCrossPlatformFixtures() {
        val util=PhoneNumberUtil.getInstance();val results=JSONArray();val codes=mutableSetOf<Int>()
        for(region in util.supportedRegions.sorted()) {
            val example=util.getExampleNumber(region) ?: continue
            val e164=util.format(example,PhoneNumberUtil.PhoneNumberFormat.E164)
            val p=PhoneNormalizer.parse(e164)!!;assertEquals(region,e164,p.e164)
            assertEquals(region,PhoneNormalizer.clean(util.format(example,PhoneNumberUtil.PhoneNumberFormat.NATIONAL)).ifBlank {e164},p.display)
            assertEquals(region,p.identity,PhoneNormalizer.identity(p.identity))
            codes.add(example.countryCode);results.put(JSONObject().put("region",region).put("international",e164).put("local",p.display))
        }
        for(code in util.supportedGlobalNetworkCallingCodes) {
            val example=util.getExampleNumberForNonGeoEntity(code) ?: continue
            val e164=util.format(example,PhoneNumberUtil.PhoneNumberFormat.E164);val p=PhoneNormalizer.parse(e164)!!
            assertEquals(e164,p.e164);codes.add(code);results.put(JSONObject().put("region","001").put("international",e164).put("local",p.display))
        }
        assertEquals(util.supportedCallingCodes,codes)
        System.getenv("OFFICE_CALLS_GLOBAL_RESULTS")?.let { java.io.File(it,"android-phone-fixtures.json").writeText(results.toString(2)) }
    }
    @Test fun unknownLocalCountryNeverInventedAndInvalidInputRetainedSafely() {
        assertEquals("0521234567",PhoneNormalizer.identity("٠٥٢ (١٢٣) ٤٥٦٧"))
        assertEquals("",PhoneNormalizer.parse("0521234567")!!.e164)
        assertEquals("970592081197",PhoneNormalizer.identity("970592081197"))
        for(input in listOf("12","+12","abc0591234567","tel:+970591234567;ext=4","0000000000","0591234567 0561234567")) assertNull(input,PhoneNormalizer.parse(input))
        val unverified=PhoneNormalizer.parse("+999123456789")!!
        assertEquals("+999123456789",unverified.display);assertEquals("",unverified.e164)
        assertEquals("+9720591234567",PhoneNormalizer.normalize("+9720591234567"))
    }
    @Test fun iddFollowsOriginMetadataAndUnicodeFormatting() {
        assertEquals("+442079460018",PhoneNormalizer.parse("0044 (20) 7946-0018")!!.e164)
        assertEquals("00442079460018",PhoneNormalizer.parse("00442079460018","US")!!.display)
        assertEquals("+970592081197",PhoneNormalizer.identity("\u200f+٩٧٠\u202f٥٩-٢٠٨١١٩٧"))
    }
    @Test fun notificationBodyAndCustomIdsCannotSupplyCallerPhone() {
        val n=ring(1,"Alice","Incoming voice call; reference +12025550123").notification
        n.extras.putString("bookingId","+442079460018")
        assertEquals("",NotificationCallIdentity.resolve(listOf(n),listOf("Alice","Incoming voice call; reference +12025550123")).phone)
        n.extras.putParcelable("android.callPerson",Person.Builder().setName("Alice").setUri("tel:+819012345678").build())
        assertEquals("+819012345678",NotificationCallIdentity.resolve(listOf(n),emptyList()).phone)
        val same=ring(2,"WhatsApp",person=Person.Builder().setName("0501234567").setUri("tel:+966501234567").build()).notification
        assertEquals("+966501234567",NotificationCallIdentity.resolve(listOf(same),emptyList()).phone)
        val noTitle=Notification.Builder(app,"calls").setSmallIcon(android.R.drawable.sym_call_incoming).setContentText("+12025550123").setCategory(Notification.CATEGORY_CALL).build()
        assertEquals("",NotificationCallIdentity.resolve(listOf(noTitle),listOf("+12025550123")).phone)
    }
    @Test fun sameNationalDigitsAcrossCountriesDoNotMerge() {
        val service=Robolectric.buildService(WhatsAppNotificationListener::class.java).create().get()
        val a=ring(1,"+970591234567");val b=ring(2,"+972591234567")
        assertEquals(PhoneNormalizer.normalize("+970591234567"),PhoneNormalizer.normalize("+972591234567"))
        service.processSafely(a);service.processSafely(b)
        assertEquals(2,store.history().size);assertEquals(2,store.history().map {it.getString("phoneIdentity")}.toSet().size)
        service.onDestroy()
    }
    @Test fun stableEventRetriesSecondCallAndNationalWireFormat() {
        val service=Robolectric.buildService(WhatsAppNotificationListener::class.java).create().get()
        val n=ring(7,"+966 (50) 123-4567")
        repeat(5){service.processSafely(n)}
        val first=store.pending().single();val body=JSONObject(first.second)
        assertEquals("0501234567",body.getString("number"));assertEquals("+966501234567",body.getString("phoneE164"))
        assertEquals("+966501234567",store.session(first.first)!!.phone)
        assertEquals("+966501234567",OfficeHttpsTransport.payload(body).getString("phone"))
        store.ack(first.first,"com.whatsapp.w4b",body.getString("number"),expectedPayload=first.second)
        service.processSafely(n);assertTrue(store.pending().isEmpty())
        service.processRemoval(n,emptyList());service.processSafely(n)
        assertNotEquals(first.first,store.pending().single().first);assertEquals(2,store.history().size)
        service.onDestroy()
    }
    @Test fun maskedDiagnosticsIncludeStagesWithoutUnicodePhoneLeak() {
        store.log(status="TEST",detail="phone=+٩٧٠ ٥٩-٢٠٨١١٩٧; original=+442079460018")
        val logs=store.logs().joinToString();assertFalse(logs.contains("٢٠٨١١٩٧"));assertFalse(logs.contains("2079460018"))
    }
    @Test fun callStyleIndependentOfLanguageAndLocalizedActions() {
        for(language in listOf("日本語","中文","हिंदी","עברית")) assertTrue(CallNotificationRules.incoming(listOf(language),emptyList(),1))
        for(actions in listOf(listOf("Répondre","Refuser"),listOf("Aceptar","Rechazar"),listOf("Annehmen","Ablehnen"),listOf("ענה","דחה")))
            assertTrue(CallNotificationRules.incoming(emptyList(),actions))
        assertFalse(CallNotificationRules.incoming(listOf("appel sortant"),listOf("Répondre","Refuser")))
    }
}
