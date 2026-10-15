package com.maktab.calls

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class) @Config(sdk=[24,34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class Pairing322AndroidTest {
    private fun qr()=javaClass.getResourceAsStream("/pairing320.png")!!.use {BitmapFactory.decodeStream(it)}
    // JPEG sampling requires Robolectric's native graphics, available from API 26.
    @Test @Config(sdk=[34]) fun photoKeepsEnoughQrDetailInLargeCameraFrame() {
        val code=qr();val expected=PairingQrDecoder.decode(code)
        // Independent JPEG encoder supplies actual image pixels, not Robolectric graphics shadows.
        val sampled=PairingQrDecoder.photo {javaClass.getResourceAsStream("/pairing322-photo.jpg")}
        try {assertEquals(2016,sampled.width);assertEquals(expected,PairingQrDecoder.decode(sampled))}
        finally {sampled.recycle();code.recycle()}
    }
    @Test fun invertedQrCanBeReadWithoutChangingItsPayload() {
        val code=qr();val expected=PairingQrDecoder.decode(code)
        val pixels=IntArray(code.width*code.height);code.getPixels(pixels,0,code.width,0,0,code.width,code.height)
        pixels.indices.forEach {i->pixels[i]=pixels[i] xor 0x00ffffff}
        val inverted=Bitmap.createBitmap(pixels,code.width,code.height,Bitmap.Config.ARGB_8888)
        try {assertEquals(expected,PairingQrDecoder.decode(inverted))}finally {inverted.recycle();code.recycle()}
    }
    @Test fun photoWithoutQrFailsRatherThanCreatingPairingData() {
        val empty=Bitmap.createBitmap(600,600,Bitmap.Config.ARGB_8888);empty.eraseColor(Color.WHITE)
        try {assertThrows(com.google.zxing.NotFoundException::class.java){PairingQrDecoder.decode(empty)}}finally {empty.recycle()}
    }
}
