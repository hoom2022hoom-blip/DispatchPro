package com.maktab.calls

import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],qualifiers="w360dp-h780dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class OfficeHome320UiTest {
    @get:Rule val compose=createAndroidComposeRule<MainActivity>()
    @Test fun homeKeepsOneActionAndSetupProvidesQrAndManualCodeWithoutFingerprintEntry() {
        compose.onNodeWithText("مكالمات المكتب").assertIsDisplayed()
        compose.onNodeWithText("آخر مكالمة").assertIsDisplayed()
        compose.onAllNodes(hasClickAction()).assertCountEquals(2)
        picture("android-home")
        compose.onNodeWithText("إعداد الاتصال").performScrollTo().performClick()
        compose.onNodeWithText("مسح رمز الكمبيوتر").assertExists()
        compose.onNodeWithText("استخدام رمز اقتران بدل الكاميرا").performScrollTo().performClick()
        compose.onNodeWithText("رمز الاقتران الظاهر على الكمبيوتر").performScrollTo().assertExists()
        compose.onAllNodes(hasText("SHA-256",substring=true)).assertCountEquals(0)
        picture("android-pairing")
    }
    private fun picture(name:String) {
        compose.waitForIdle();val view=compose.activity.window.decorView
        val bitmap=Bitmap.createBitmap(view.width,view.height,Bitmap.Config.ARGB_8888)
        compose.runOnIdle {view.draw(Canvas(bitmap))}
        val cwd=File(System.getProperty("user.dir")!!);val project=if(File(cwd,"gradlew.bat").exists())cwd else cwd.parentFile
        val folder=File(project,"../../artifacts/officecalls-repair-20261011/ui").canonicalFile.apply {mkdirs()}
        File(folder,"$name.png").outputStream().use {assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG,100,it))};bitmap.recycle()
    }
}
