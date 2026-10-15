package com.maktab.calls
import android.Manifest
import android.content.*
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.provider.ContactsContract as C
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.*
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowContentResolver

@RunWith(RobolectricTestRunner::class) @Config(sdk=[35])
class OfficeCalls300AndroidTest {
    @Test fun independentlyReadablePhoneSurvivesBrokenOemCursorsAndFilteredPhoneQuery() {
        val app=RuntimeEnvironment.getApplication()
        Shadows.shadowOf(app).grantPermissions(Manifest.permission.READ_CONTACTS)
        ShadowContentResolver.registerProviderInternal(C.AUTHORITY,object:ContentProvider(){
            override fun onCreate()=true
            override fun query(uri: Uri,projection: Array<out String>?,selection: String?,args: Array<out String>?,sort: String?): Cursor {
                if(uri!=C.CommonDataKinds.Phone.CONTENT_URI)return MatrixCursor(arrayOf("unsupported_oem_column"))
                if(args!=null)throw IllegalArgumentException("OEM filtered query unavailable")
                return MatrixCursor(projection!!).apply {addRow(projection.map {when(it){
                    C.Data.CONTACT_ID->77L
                    C.Data.RAW_CONTACT_ID->100L
                    C.CommonDataKinds.Phone.NUMBER->"+972\u200b59\u00a0123\u202f4567"
                    C.Contacts.LOOKUP_KEY->"fixture-identity"
                    else->"رمزي دياب"
                }}.toTypedArray())}
            }
            override fun getType(uri: Uri): String?=null
            override fun insert(uri: Uri,values: ContentValues?): Uri?=null
            override fun delete(uri: Uri,selection: String?,args: Array<out String>?)=0
            override fun update(uri: Uri,values: ContentValues?,selection: String?,args: Array<out String>?)=0
        })
        val result=ContactResolver.names(app,listOf("رَمْـزي  دياب"))
        assertEquals(result.detail,ContactIndex.Status.CONTACT_RESOLVED,result.status)
        assertEquals("+972591234567",result.phone)
        assertTrue(result.detail.contains("CURSOR_IllegalArgumentException"))
        assertEquals("",ContactResolver.names(app,listOf("شوقي دياب")).phone)
    }
    @Test @GraphicsMode(GraphicsMode.Mode.NATIVE) fun realQrImageFromWebEncoderDecodesThroughAndroidReader() {
        val image=javaClass.getResourceAsStream("/pairing-qr.png").use {android.graphics.BitmapFactory.decodeStream(it)}
        assertNotNull(image)
        val text=PairingQrDecoder.decode(image)
        assertEquals("officecalls://pair?sessionId=11111111-1111-1111-1111-111111111111&secret="+"0".repeat(64),text)
    }
    @Test fun archived260AcceptsOrdinarySpacesButRejectsZeroWidthWhile300AcceptsBoth() {
        assertEquals("0591234567",Legacy260PhoneNumber.normalize("+972 59 123 4567"))
        assertEquals("",Legacy260PhoneNumber.normalize("+972\u200b59\u200b123\u200b4567"))
        assertEquals("0591234567",PhoneNormalizer.normalize("+972\u200b59\u200b123\u200b4567"))
    }
}
