package com.maktab.calls

import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.activity.compose.setContent
import androidx.compose.material3.*
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],qualifiers="w375dp-h780dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class Home260UiTest {
    @get:Rule val compose=createAndroidComposeRule<MainActivity>()
    private fun render(name: String, dark: Boolean=false, scale: Float=1f) {
        compose.activity.setContent {
            MaterialTheme(colorScheme=if(dark) darkColorScheme() else lightColorScheme()) {
                CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl,LocalDensity provides Density(1f,scale)) {
                    OfficeCallsScreen(compose.activity)
                }
            }
        }
        compose.waitForIdle()
        screenshot(name)
    }
    private fun screenshot(name: String) {
        compose.waitForIdle()
        val view=compose.activity.window.decorView
        val image=Bitmap.createBitmap(view.width,view.height,Bitmap.Config.ARGB_8888)
        compose.runOnIdle {view.draw(Canvas(image))}
        val folder=File(System.getProperty("user.dir"),"../../artifacts/whatsapp-office/OfficeCalls-3.0/ui").canonicalFile
        folder.mkdirs()
        File(folder,"$name.png").outputStream().use {assertTrue(image.compress(Bitmap.CompressFormat.PNG,100,it))}
    }
    @Test fun homeOpensWithoutBatteryExemptionOrManualOemChecklist() {
        render("home-light")
        compose.onNodeWithText("OfficeCalls ${BuildConfig.VERSION_NAME} • الرئيسية").assertIsDisplayed()
        compose.onNodeWithText("مستمع الإشعارات: تنبيه: غير متصل").assertIsDisplayed()
        compose.onNodeWithText("نسخ سجل التشخيص").performScrollTo().assertIsEnabled().performClick()
        val clip=compose.activity.getSystemService(android.content.ClipboardManager::class.java).primaryClip!!
        assertTrue(clip.getItemAt(0).text.toString().contains("OfficeCalls ${BuildConfig.VERSION_NAME}"))
        screenshot("home-actions")
    }
    @Test fun darkRtlHasReadableStatusAndTouchActions() {
        render("home-dark",dark=true)
        compose.onNodeWithText("فحص النظام").performScrollTo().assertIsEnabled()
        screenshot("home-dark-actions")
    }
    @Test @Config(qualifiers="w780dp-h375dp-mdpi") fun landscapeLargeTextKeepsActionsScrollable() {
        render("home-landscape-large-text",scale=1.6f)
        compose.onNodeWithText("اختبار اتصال HTTPS").performScrollTo().assertIsDisplayed()
        screenshot("home-landscape-large-text-actions")
    }
}
