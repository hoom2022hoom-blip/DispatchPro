package com.maktab.calls

import android.graphics.BitmapFactory
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.nio.ByteBuffer
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

@RunWith(RobolectricTestRunner::class) @Config(sdk=[34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class LiveQr323AndroidTest {
    @Test fun liveFrameReadsOriginalRotatedAndInvertedPayload() {
        val bitmap=javaClass.getResourceAsStream("/pairing320.png")!!.use {BitmapFactory.decodeStream(it)}
        try {
            val expected=PairingQrDecoder.decode(bitmap);val w=bitmap.width;val h=bitmap.height
            val pixels=IntArray(w*h);bitmap.getPixels(pixels,0,w,0,0,w,h)
            val gray=ByteArray(w*h){i->val c=pixels[i];(((c shr 16 and 255)+2*(c shr 8 and 255)+(c and 255))/4).toByte()}
            assertEquals(expected,LiveQrDecoder.decode(gray,w,h))
            val rotated=ByteArray(gray.size)
            for(y in 0 until h)for(x in 0 until w)rotated[x*h+(h-1-y)]=gray[y*w+x]
            assertEquals(expected,LiveQrDecoder.decode(rotated,h,w))
            assertEquals(expected,LiveQrDecoder.decode(ByteArray(gray.size){(255-(gray[it].toInt() and 255)).toByte()},w,h))
            assertNull(LiveQrDecoder.decode(ByteArray(128*128){255.toByte()},128,128))
        } finally {bitmap.recycle()}
    }
    @Test fun cameraPlaneStrideAndBufferOffsetPreservePixels() {
        val buffer=ByteBuffer.wrap(byteArrayOf(0,11,0,12,0,0,0,21,0,22));buffer.position(1)
        assertArrayEquals(byteArrayOf(11,12,21,22),LiveQrDecoder.luminance(buffer,2,2,6,2))
        assertEquals(1,buffer.position())
        assertThrows(IllegalArgumentException::class.java){LiveQrDecoder.luminance(ByteBuffer.allocate(3),2,2,2,1)}
    }
    @Test fun pairingGateAllowsOnlyOneConcurrentSubmissionAndExplicitRetry() {
        val gate=LiveQrGate();val accepted=AtomicInteger();val pool=Executors.newFixedThreadPool(4)
        try {val jobs=(1..24).map {pool.submit {if(gate.acquire())accepted.incrementAndGet()}};jobs.forEach {it.get()}}
        finally {pool.shutdown()}
        assertEquals(1,accepted.get());assertFalse(gate.acquire());gate.reset();assertTrue(gate.acquire())
    }
    @Test fun foreignAndMalformedQrNeverQualifyForPairing() {
        val payload=javaClass.getResourceAsStream("/pairing320.json")!!.bufferedReader().use {it.readText()}
        val fixture=JSONObject(payload).getJSONObject("payload").put("issuedAt",1000L).put("expiresAt",181000L).put("pairId","a".repeat(32))
        assertEquals(fixture.toString(),LivePairingPayload.validate(fixture.toString()))
        for(text in listOf("https://example.com",fixture.toString().replace("officecalls-local-v1","other"),JSONObject(fixture.toString()).put("host","8.8.8.8").toString())) {
            assertThrows(IllegalArgumentException::class.java){LivePairingPayload.validate(text)}
        }
        assertThrows(IllegalArgumentException::class.java){LivePairingPayload.validate(JSONObject(fixture.toString()).put("expiresAt",181001L).toString())}
    }
    @Test fun expiredReceiverWindowHasSpecificNewCodeInstruction() {
        val message=NetworkSender.friendlyError(IllegalArgumentException("LOCAL_HTTP_410"))
        assertTrue(message.contains("انتهت صلاحية"));assertTrue(message.contains("رمزًا جديدًا"))
    }
}
