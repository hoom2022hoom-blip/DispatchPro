package com.maktab.calls

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class) @Config(sdk=[24,34])
class Pairing321AndroidTest {
    private fun offer()=JSONObject().put("pairId","a".repeat(32)).put("issuedAt",1791735384000L).put("expiresAt",1791735564000L)
    @Test fun receiverConfirmedWindowAllowsClockSkewInBothDirections() {
        val p=offer()
        LocalReceiverTransport.validatePairingWindow(p,p.getLong("issuedAt")+163000+60000)
        LocalReceiverTransport.validatePairingWindow(p,p.getLong("issuedAt")-3600000)
        // This only validates the structure; import still must confirm live over pinned TLS.
    }
    @Test fun invalidWindowAndIdentifierAreRejected() {
        assertThrows(Exception::class.java){LocalReceiverTransport.validatePairingWindow(offer().put("expiresAt",1791735564001L),0)}
        assertThrows(Exception::class.java){LocalReceiverTransport.validatePairingWindow(offer().put("expiresAt",1791735384000L),0)}
        assertThrows(Exception::class.java){LocalReceiverTransport.validatePairingWindow(offer().put("pairId","../invalid"),0)}
    }
    @Test fun legacyOffersStillRejectExpiredAndUnboundedWindows() {
        assertThrows(Exception::class.java){LocalReceiverTransport.validatePairingWindow(JSONObject().put("expiresAt",100L),101L)}
        assertThrows(Exception::class.java){LocalReceiverTransport.validatePairingWindow(JSONObject().put("expiresAt",300002L),1L)}
    }
}
