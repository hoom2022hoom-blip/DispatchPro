package com.maktab.calls

import android.app.Notification
import android.app.Person
import android.content.Context
import android.os.UserHandle
import android.service.notification.StatusBarNotification
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.RobolectricTestRunner
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class) @Config(sdk=[34])
class Professional310AndroidTest {
    private lateinit var app: Context
    private lateinit var store: CallStore
    @Before fun setup() {
        app=RuntimeEnvironment.getApplication();store=CallStore.get(app)
        for(table in listOf("outbox","call_history","sessions","aliases","call_metadata","state","diagnostics","delivery"))store.writableDatabase.delete(table,null,null)
        app.getSharedPreferences(NetworkSender.PREFS_NAME,0).edit().clear().commit()
        NetworkSender.clock=System::currentTimeMillis
        NetworkSender.localRequest={_,_->throw java.io.IOException("OFFLINE_FIXTURE")}
    }
    @After fun reset(){drain();NetworkSender.localRequest=LocalReceiverTransport::request;NetworkSender.clock=System::currentTimeMillis}
    private fun drain(){val done=CountDownLatch(1);NetworkSender.flush(app){done.countDown()};assertTrue(done.await(15,TimeUnit.SECONDS))}
    private fun sbn(pkg: String,id: Int,title: String,person: Person?=null,text: String="Incoming voice call",category: String=Notification.CATEGORY_CALL): StatusBarNotification {
        val n=Notification.Builder(app,"calls").setSmallIcon(android.R.drawable.sym_call_incoming).setContentTitle(title).setContentText(text).setCategory(category).build()
        person?.let {n.extras.putParcelable("android.callPerson",it)}
        return StatusBarNotification(pkg,pkg,id,null,1000,0,0,n,UserHandle.getUserHandleForUid(0),System.currentTimeMillis())
    }
    @Test fun unknownCallerForBothAppsIsDurableVisibleAndEnrichesAfterAck() {
        val service=Robolectric.buildService(WhatsAppNotificationListener::class.java).create().get()
        for((index,pkg) in CallNotificationRules.packages.withIndex()) {
            service.processSafely(sbn(pkg,index,"رمزي دياب"));drain()
            val pending=store.pending().last();val missing=JSONObject(pending.second)
            assertEquals("",missing.getString("number"));assertEquals("رمزي دياب",missing.getString("displayName"))
            store.ack(pending.first,pkg,"",expectedPayload=pending.second)
            service.processSafely(sbn(pkg,index,"رمزي دياب",Person.Builder().setName("رمزي دياب").setUri("tel:+970591234567").build(),text="Ongoing call"));drain()
            val updated=store.pending().last();assertEquals(pending.first,updated.first);assertEquals("0591234567",JSONObject(updated.second).getString("number"))
            assertTrue(JSONObject(updated.second).getInt("revision")>missing.getInt("revision"))
            // A late ACK for the old missing-number payload cannot delete the resolved update.
            store.ack(pending.first,pkg,"",expectedPayload=pending.second);assertTrue(store.pending().any {it==updated})
        }
        service.onDestroy()
    }
    @Test fun twentyRealisticCallbacksWithRemovalAndRetriesDoNotLoseOrMergeCalls() {
        val service=Robolectric.buildService(WhatsAppNotificationListener::class.java).create().get()
        repeat(20) {i->
            val pkg=if(i%2==0) "com.whatsapp" else "com.whatsapp.w4b"
            val notification=sbn(pkg,7,"+970 59 123 4567")
            service.processSafely(notification);service.processSafely(notification)
            service.processRemoval(notification,emptyList())
        };drain()
        assertEquals(20,store.pending().size);assertEquals(20,store.pending().map {it.first}.toSet().size)
        assertTrue(store.pending().all {JSONObject(it.second).getString("number")=="0591234567"})
        service.onDestroy()
    }
    @Test fun independentNotificationKeysNeverMergeJustBecausePhoneMatches() {
        val service=Robolectric.buildService(WhatsAppNotificationListener::class.java).create().get()
        service.processSafely(sbn("com.whatsapp",10,"0591234567"));service.processSafely(sbn("com.whatsapp",11,"0591234567"));drain()
        assertEquals(2,store.pending().size);service.onDestroy()
    }
    @Test fun longOfflineQueueSurvivesBootAndFlushNeedsNoCloudCredential() {
        store.capture("com.whatsapp","key","0591234567",System.currentTimeMillis()-3*86400000L)
        val original=store.pending().single();store.deviceBoot();assertEquals(original,store.pending().single())
        NetworkSender.localRequest={_,body->JSONObject().put("eventId",body!!.getString("eventId")).put("revision",body.optInt("revision",1)).put("receiverAcknowledged",true).put("gridCms","HISTORY_ONLY")}
        drain();assertTrue(store.pending().isEmpty());assertEquals(1,store.confirmedCount())
        assertEquals("",DevicePairingManager.token(app));assertEquals("HISTORY_ONLY",store.state("grid_delivery"))
    }
    @Test fun invalidAckAndInterleavedEnrichmentKeepOutboxRevision() {
        val id=store.observe("com.whatsapp","key",System.currentTimeMillis())!!
        store.publish(id,reason="PHONE_NOT_EXPOSED")
        NetworkSender.localRequest={_,body->store.publish(id,"0591234567");JSONObject().put("eventId",id).put("revision",body!!.getInt("revision")).put("receiverAcknowledged",true).put("gridCms","NUMBER_UNAVAILABLE")}
        drain();assertEquals("0591234567",JSONObject(store.pending().single().second).getString("number"))
        NetworkSender.localRequest={_,_->JSONObject().put("eventId","wrong").put("revision",2).put("receiverAcknowledged",true)}
        drain();assertEquals(1,store.pending().size)
    }
    @Test fun messageAndStandaloneOngoingNotificationsNeverCreateCallEvents() {
        val service=Robolectric.buildService(WhatsAppNotificationListener::class.java).create().get()
        service.processSafely(sbn("com.whatsapp",1,"0591234567",category=Notification.CATEGORY_MESSAGE))
        service.processSafely(sbn("com.whatsapp.w4b",1,"0591234567",text="Ongoing call"));drain()
        assertTrue(store.pending().isEmpty());service.onDestroy()
    }
    @Test fun explicitInternationalPhonesUnicodeAndInvalidNumbers() {
        val formats=mapOf("+٤٤ ٢٠ ٧٩٤٦ ٠٠١٨" to "+442079460018","00442079460018" to "+442079460018","+1 (202) 555-0123" to "+12025550123","+971 50 123 4567" to "+971501234567","+972 54 2345678" to "+972542345678")
        for((input,expected) in formats){assertEquals(expected,PhoneNormalizer.identity(input));assertEquals(expected,PhoneNormalizer.extract("Incoming call from $input"))}
        assertEquals("2025550123",PhoneNormalizer.normalize("2025550123"));assertEquals("+1591234567",PhoneNormalizer.normalize("+1 591234567"))
        assertEquals("",PhoneNormalizer.extract("+442079460018 / +12025550123"))
    }
    @Test fun manualPairingRejectsPublicIpAndPersistsDeviceIdentity() {
        assertFalse(LocalReceiverTransport.validHost("8.8.8.8"));assertFalse(LocalReceiverTransport.validHost("192.168.1.999"))
        LocalReceiverTransport.configure(app,"192.168.1.5",5051,"a".repeat(64),"b".repeat(64))
        val device=LocalReceiverTransport.deviceId(app);assertEquals(device,LocalReceiverTransport.deviceId(app));assertTrue(LocalReceiverTransport.enabled(app))
        assertEquals("https://192.168.1.5:5051",LocalReceiverTransport.endpoint(app))
    }
}
