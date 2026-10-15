package com.maktab.calls

import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.activity.ComponentActivity
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
@Config(sdk=[34],qualifiers="w360dp-h780dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ContactsProbeUiTest {
    @get:Rule val compose=createAndroidComposeRule<ComponentActivity>()
    private fun picture(name: String) {
        compose.waitForIdle()
        val view=compose.activity.window.decorView
        val bitmap=Bitmap.createBitmap(view.width,view.height,Bitmap.Config.ARGB_8888)
        compose.runOnIdle {view.draw(Canvas(bitmap))}
        val cwd=File(requireNotNull(System.getProperty("user.dir")))
        val project=if(File(cwd,"gradlew.bat").exists()) cwd else cwd.parentFile
        val folder=File(project,"../../artifacts/whatsapp-office/contacts-probe-2.5.2/ui").canonicalFile.apply {mkdirs()}
        File(folder,"$name.png").outputStream().use {assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG,100,it))}
    }
    @Test fun busyProbeDisablesRepeatedRunPickerAndCopyAndShowsProgress() {
        compose.setContent {MaterialTheme {CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
            ContactsProbeScreen("رمزي دياب","",true)
        }}}
        compose.onNodeWithTag("probe-run").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithTag("probe-pick").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithText("جارٍ قراءة مصادر الاسم وربط الهوية…").assertExists()
        compose.onNodeWithTag("probe-copy").performScrollTo().assertIsNotEnabled()
        picture("probe-busy-rtl")
    }
    @Test @Config(qualifiers="w800dp-h360dp-land-mdpi") fun darkLargeTextReportAndCopyRemainReachableWithoutNumbers() {
        var copies=0
        compose.setContent {MaterialTheme(colorScheme=darkColorScheme()) {CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl,
            LocalDensity provides Density(1f,1.8f)) {
            ContactsProbeScreen("رمزي دياب","exactNameSeenInPhoneRows=true; contactId=99; hasValidPhone=true; phoneNumbers=NOT_LOGGED",false,onCopy={copies++})
        }}}
        compose.onNodeWithTag("probe-copy").performScrollTo().assertIsEnabled().performClick()
        assertEquals(1,copies)
        compose.onNodeWithTag("probe-report").performScrollTo().assertIsDisplayed()
        picture("probe-report-dark-landscape")
    }
}
