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
class SystemCheckUiTest {
    @get:Rule val compose=createAndroidComposeRule<ComponentActivity>()
    private fun state()=SystemCheck.Snapshot(PermissionSetup.Snapshot(true,true,true,true,false,true,true,true),true,true,"192.168.1.8:5050",true,false)
    private fun picture(name: String) {
        compose.waitForIdle()
        val view=compose.activity.window.decorView
        val bitmap=Bitmap.createBitmap(view.width,view.height,Bitmap.Config.ARGB_8888)
        compose.runOnIdle {view.draw(Canvas(bitmap))}
        val cwd=File(requireNotNull(System.getProperty("user.dir")))
        val project=if(File(cwd,"gradlew.bat").exists()) cwd else cwd.parentFile
        val folder=File(project,"../../artifacts/whatsapp-office/fix-2.5.1/ui").canonicalFile.apply {mkdirs()}
        File(folder,"$name.png").outputStream().use {assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG,100,it))}
    }
    @Test fun tcpSuccessStillShowsAckAsUnverifiedAndUsesExplicitTestAction() {
        compose.setContent {MaterialTheme {CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
            SystemCheckScreen(state(),"192.168.1.8","5050",onContinue={})
        }}}
        compose.onNodeWithText("فحص النظام").assertIsDisplayed()
        compose.onNodeWithText("لم يُتحقق بعد — يلزم اتصال WhatsApp حقيقي يكشف رقماً").assertExists()
        picture("system-check-light")
        compose.onNodeWithTag("system-continue").performScrollTo().assertIsEnabled()
        compose.onNodeWithText("الدخول لاختبار مكالمة حقيقية").assertIsDisplayed()
        picture("system-check-ack-pending")
    }
    @Test fun missingRequirementsAndUnsavedEndpointCannotContinue() {
        compose.setContent {MaterialTheme {SystemCheckScreen(state().copy(receiverConfigured=false),"","5050",dirty=true,onContinue={})}}
        compose.onNodeWithTag("system-probe").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithTag("system-continue").performScrollTo().assertIsNotEnabled()
    }
    @Test @Config(qualifiers="w800dp-h360dp-land-mdpi") fun darkLargeTextLandscapeCanReachProbeAndContinue() {
        compose.setContent {MaterialTheme(colorScheme=darkColorScheme()) {CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl,
            LocalDensity provides Density(1f,1.8f)) {SystemCheckScreen(state().copy(ackVerified=true,backgroundAckVerified=true),"192.168.1.8","5050",onContinue={})}}}
        compose.onNodeWithTag("system-probe").performScrollTo().assertIsDisplayed().assertIsEnabled()
        picture("system-check-dark-landscape-probe")
        compose.onNodeWithTag("system-continue").performScrollTo().assertIsDisplayed().assertIsEnabled()
        picture("system-check-dark-landscape-enter")
    }
}
