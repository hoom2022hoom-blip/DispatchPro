package com.maktab.calls

import android.content.Context
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34])
class SystemCheckAndroidTest {
    private fun setup()=PermissionSetup.Snapshot(true,true,true,true,false,true,true,true)
    @Test fun tcpAloneCanPermitRealCallTestButNeverProvesAck() {
        val s=SystemCheck.Snapshot(setup(),true,true,"192.168.1.8:5050",true,false)
        assertTrue(s.canTestCall);assertFalse(s.ready)
        assertFalse(s.copy(ackVerified=true).ready) // Foreground ACK does not prove the Home case.
        assertTrue(s.copy(ackVerified=true,backgroundAckVerified=true).ready)
    }
    @Test fun missingAnyCriticalRequirementCannotBeReady() {
        val s=SystemCheck.Snapshot(setup(),true,true,"host:5050",true,true,backgroundAckVerified=true)
        assertFalse(s.copy(businessInstalled=false).ready)
        assertFalse(s.copy(receiverConfigured=false).ready)
        assertFalse(s.copy(tcpConnected=false).ready)
        assertFalse(s.copy(setup=setup().copy(listenerConnected=false)).ready)
        assertFalse(s.copy(setup=setup().copy(contacts=false)).ready)
    }
    @Test fun receiverValidationRejectsInvalidInputs() {
        listOf("" to "5050","localhost" to "0","localhost" to "65536","http://host" to "5050","bad host" to "5050").forEach {assertFalse(SystemCheck.validReceiver(it.first,it.second))}
        assertTrue(SystemCheck.validReceiver("192.168.1.8","5050"));assertTrue(SystemCheck.validReceiver("office.local","5050"))
    }
    @Test fun changingIpDoesNotInvalidateHttpsButChangingOfficeInvalidatesEvidence() {
        val app=RuntimeEnvironment.getApplication()
        val store=CallStore.get(app)
        val prefs=app.getSharedPreferences(NetworkSender.PREFS_NAME,Context.MODE_PRIVATE)
        prefs.edit().putString(NetworkSender.KEY_HOST,"192.168.1.8").putInt(NetworkSender.KEY_PORT,5050).commit()
        val pairing=app.getSharedPreferences("officecalls3_credentials",Context.MODE_PRIVATE)
        pairing.edit().putString("office","office-a").commit()
        store.setState("server_health_time",System.currentTimeMillis().toString());store.setState("server_health_office","office-a")
        store.setState("last_ack","real-confirmation");store.setState("last_ack_target",OfficeHttpsTransport.BASE);store.setState("last_ack_office","office-a")
        assertTrue(SystemCheck.read(app).tcpConnected);assertTrue(SystemCheck.read(app).ackVerified)
        prefs.edit().putString(NetworkSender.KEY_HOST,"192.168.1.9").commit()
        assertTrue(SystemCheck.read(app).tcpConnected);assertTrue(SystemCheck.read(app).ackVerified)
        pairing.edit().putString("office","office-b").commit()
        assertFalse(SystemCheck.read(app).tcpConnected);assertFalse(SystemCheck.read(app).ackVerified)
    }
}
