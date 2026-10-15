package com.maktab.calls

import android.content.Context
import android.content.ContextWrapper
import android.database.DatabaseErrorHandler
import android.database.sqlite.SQLiteDatabase
import android.graphics.BitmapFactory
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RuntimeEnvironment
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class) @Config(sdk=[24,34])
class Professional320AndroidTest {
    private fun fixture()=JSONObject(javaClass.getResourceAsStream("/pairing320.json")!!.bufferedReader().use {it.readText()})
    @Test fun windowsEnvelopeAuthenticatesOnBothSupportedAndroidApis() {
        val f=fixture();val payload=LocalReceiverTransport.decodeOffer(f.getJSONObject("offer"),f.getString("code"),f.getLong("now"))
        assertEquals(f.getJSONObject("payload").toString(),payload.toString())
        assertThrows(Exception::class.java){LocalReceiverTransport.decodeOffer(f.getJSONObject("offer"),"0000000000000000",f.getLong("now"))}
        assertThrows(Exception::class.java){LocalReceiverTransport.decodeOffer(f.getJSONObject("offer"),f.getString("code"),f.getLong("now")+180001)}
        val bad=JSONObject(f.getJSONObject("offer").toString()).put("iv","AA==")
        assertThrows(Exception::class.java){LocalReceiverTransport.decodeOffer(bad,f.getString("code"),f.getLong("now"))}
    }
    @Test fun actualWindowsQrPngIsReadableAndTransfersTheAuthenticatedSettings() {
        val bitmap=javaClass.getResourceAsStream("/pairing320.png")!!.use {BitmapFactory.decodeStream(it)}
        val text=PairingQrDecoder.decode(bitmap)
        assertEquals(fixture().getJSONObject("payload").toString(),JSONObject(text).toString())
        bitmap.recycle()
        val photo=PairingQrDecoder.photo {javaClass.getResourceAsStream("/pairing320.png")}
        assertEquals(text,PairingQrDecoder.decode(photo));photo.recycle()
    }
    @Test fun sixPendingCallsAndPairingSurviveDatabaseReopenAndReboot() {
        val app=RuntimeEnvironment.getApplication()
        val context=object:ContextWrapper(app) {
            override fun getApplicationContext():Context=this
            override fun getDatabasePath(name:String)=app.getDatabasePath("upgrade320_$name")
            override fun openOrCreateDatabase(name:String,mode:Int,factory:SQLiteDatabase.CursorFactory?):SQLiteDatabase=app.openOrCreateDatabase("upgrade320_$name",mode,factory)
            override fun openOrCreateDatabase(name:String,mode:Int,factory:SQLiteDatabase.CursorFactory?,handler:DatabaseErrorHandler?):SQLiteDatabase=app.openOrCreateDatabase("upgrade320_$name",mode,factory,handler)
        }
        app.deleteDatabase("upgrade320_office_call_events.db")
        val id=LocalReceiverTransport.deviceId(app)
        LocalReceiverTransport.configure(app,"192.168.1.8",5051,"a".repeat(64),"b".repeat(64))
        val store=CallStore(context)
        val snapshot=try {
            repeat(6){n->val session=store.observe(if(n%2==0) "com.whatsapp" else "com.whatsapp.w4b","ring-$n",1700000000000+n,false,"",true,"أحمد ⭐",strictAliases=true)!!;store.publish(session,if(n==0) "" else "0591234567",reason="PHONE_NOT_EXPOSED")}
            assertEquals(6,store.pending().size);store.pending().toMap()
        }finally{store.close()}
        val reopened=CallStore(context)
        try {assertEquals(6,reopened.writableDatabase.version);assertEquals(snapshot,reopened.pending().toMap());reopened.deviceBoot();assertEquals(snapshot,reopened.pending().toMap())}finally{reopened.close()}
        assertEquals(id,LocalReceiverTransport.deviceId(app));assertTrue(LocalReceiverTransport.endpoint(app).endsWith(":5051"))
        app.deleteDatabase("upgrade320_office_call_events.db")
    }
    @Test fun failedExpiredPairingCannotOverwritePreviousSettings() {
        val app=RuntimeEnvironment.getApplication();LocalReceiverTransport.configure(app,"192.168.1.10",5051,"a".repeat(64),"b".repeat(64))
        assertThrows(Exception::class.java){LocalReceiverTransport.importPairing(app,fixture().getJSONObject("payload").toString())}
        assertEquals("https://192.168.1.10:5051",LocalReceiverTransport.endpoint(app))
        assertFalse(NetworkSender.friendlyError(IllegalArgumentException("LOCAL_PAIRING_REQUIRED")).contains("LOCAL_PAIRING_REQUIRED"))
    }
}
