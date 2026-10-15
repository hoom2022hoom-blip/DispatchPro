package com.maktab.calls

import android.content.Context
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class) @Config(sdk=[35])
class ReliableDeliveryQueue300Test {
    private lateinit var app: Context;private lateinit var store: CallStore;private var now=System.currentTimeMillis()
    @Before fun setup(){app=RuntimeEnvironment.getApplication();store=CallStore.get(app);ReliableDeliveryQueue(app)
        listOf("outbox","sessions","aliases","diagnostics","state","delivery","https_delivery").forEach {store.writableDatabase.delete(it,null,null)}
        NetworkSender.clock={now};NetworkSender.transport=OfficeHttpsTransport::request
        app.getSharedPreferences(NetworkSender.PREFS_NAME,0).edit().clear().putString("delivery_mode","cloud").commit()
    }
    @After fun reset(){NetworkSender.transport=OfficeHttpsTransport::request;NetworkSender.clock=System::currentTimeMillis}
    private fun flush(){val done=CountDownLatch(1);NetworkSender.flush(app){done.countDown()};assertTrue(done.await(10,TimeUnit.SECONDS))}
    @Test fun retainedEventUsesStableIdAcrossNetworkChangeAndBackoffThenTracksIndependentDestinations(){
        store.capture("com.whatsapp.w4b","key","0591234567",now);val original=store.pending().single();var attempts=0;var accepted=false;var polls=0
        NetworkSender.transport={path,_,body->attempts++;if(!accepted)throw java.io.IOException("OFFLINE")
            if(path!="/events")polls++
            JSONObject().put("eventId",body?.getString("eventId") ?: path.substringAfterLast('/')).put("serverAcknowledged",true).put("dispatchPro","DELIVERED").put("gridCms",if(polls<2) "PENDING" else "RECEIVER_ACK").put("gridVisibleConfirmed",false)}
        flush();assertEquals(listOf(original),store.pending());assertEquals(1,attempts)
        flush();assertEquals(1,attempts) // Repeated callbacks do not defeat exponential backoff.
        now+=120_001;accepted=true;flush();assertTrue(store.pending().isEmpty());assertTrue(store.logs().any {it.contains("SERVER_ACK")})
        assertEquals("DELIVERED",store.state("dispatch_delivery"));assertEquals("PENDING",store.state("grid_delivery"))
        // Simulate a restart of the queue helper; receipts remain on disk and poll independently.
        assertEquals(listOf(original.first),ReliableDeliveryQueue(app).awaiting());flush();assertEquals("RECEIVER_ACK",store.state("grid_delivery"))
    }
    @Test fun foreignServerAckCannotRemovePendingEvent(){
        store.capture("com.whatsapp.w4b","key","0591234567",now);val original=store.pending().single()
        NetworkSender.transport={_,_,_->JSONObject().put("eventId","different-event").put("serverAcknowledged",true).put("dispatchPro","DELIVERED").put("gridCms","UDP_SENT")}
        flush();assertEquals(listOf(original),store.pending());assertEquals("",store.state("last_ack"))
    }
    @Test fun repeated530RecoversWithinLiveCallWindowWithStableId(){
        store.capture("com.whatsapp.w4b","transient","0591234567",now)
        val original=store.pending().single();val ids=mutableListOf<String>();val queue=ReliableDeliveryQueue(app){now}
        NetworkSender.transport={path,_,body->
            if(path=="/events") {
                ids+=body!!.getString("eventId")
                if(ids.size<=6)throw OfficeHttpsTransport.HttpFailure(530)
            }
            JSONObject().put("eventId",body?.getString("eventId") ?: path.substringAfterLast('/')).put("serverAcknowledged",true).put("dispatchPro","DELIVERED").put("gridCms","RECEIVER_ACK")
        }
        repeat(6){flush();now+=30_001}
        assertTrue("A transient outage must not impose an hour-long queue backoff",queue.due(original.first,now-180_006))
        flush();assertTrue(store.pending().isEmpty());assertEquals(7,ids.size);assertEquals(setOf(original.first),ids.toSet())
    }
    @Test fun expiryIsFailureWithoutFabricatedServerAck(){
        store.capture("com.whatsapp.w4b","key","0591234567",now-25L*60*60*1000);var attempts=0
        NetworkSender.transport={_,_,_->attempts++;JSONObject()};flush();assertEquals(0,attempts);assertTrue(store.pending().isEmpty());assertEquals("",store.state("last_ack"));assertTrue(store.logs().any {it.contains("RETENTION_24H_EXCEEDED")})
    }
    @Test fun queuedPhoneNeverMovesToAnotherOfficeAfterRePairing(){
        val prefs=app.getSharedPreferences("officecalls3_credentials",Context.MODE_PRIVATE)
        try {
            prefs.edit().putString("office","office-a").commit()
            store.capture("com.whatsapp.w4b","key","0591234567",now)
            val original=store.pending().single()
            prefs.edit().putString("office","office-b").commit()
            var attempts=0;NetworkSender.transport={_,_,_->attempts++;JSONObject()}
            flush();assertEquals(0,attempts);assertEquals(listOf(original),store.pending())
            assertTrue(store.state("last_error").contains("QUEUED_EVENT_OFFICE_MISMATCH"))
        } finally {prefs.edit().clear().commit()}
    }
    @Test fun freshCallIsDeliveredBeforeOldRetryAndBothIdsSurvive() {
        store.capture("com.whatsapp.w4b","old-retry","0591234567",now-60_000)
        store.capture("com.whatsapp.w4b","current-call","0561234567",now)
        val attempted=mutableListOf<String>()
        NetworkSender.transport={path,_,body->if(path=="/events"){attempted+=body!!.getString("phone");if(body.getString("phone")=="0591234567")throw java.net.SocketTimeoutException("READ_TIMEOUT")};JSONObject().put("eventId",body?.getString("eventId") ?: path.substringAfterLast('/')).put("serverAcknowledged",true).put("dispatchPro","DELIVERED").put("gridCms","RECEIVER_ACK")}
        flush();assertEquals(listOf("0561234567","0591234567"),attempted)
        assertEquals("0591234567",JSONObject(store.pending().single().second).getString("number"))
    }
}

