package com.maktab.calls

import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
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
@Config(sdk = [34], qualifiers = "w360dp-h780dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class PermissionSetupUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private fun ready() = PermissionSetup.Snapshot(true, true, true, true, false, true, true, true)
    private fun screenshot(name: String) {
        val folder = File(System.getProperty("user.dir"), "../../artifacts/whatsapp-office/rebuild-2.6.0/ui-legacy").canonicalFile
        folder.mkdirs()
        // PixelCopy/forceRedraw waits for a device compositor frame, which Robolectric does not
        // supply. Render the actual activity view to native Canvas after Compose becomes idle.
        compose.waitForIdle()
        val view = compose.activity.window.decorView
        val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
        compose.runOnIdle { view.draw(Canvas(bitmap)) }
        assertTrue(bitmap.width > 0 && bitmap.height > 0)
        File(folder, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
    @Test fun firstRunArabicRtlGateAndOrderedContactsNotificationSteps() {
        val state = mutableStateOf(ready().copy(contacts = false, notificationEnabled = false, listenerConnected = false,
            batteryExempt = false, backgroundReviewed = false, autoStartReviewed = false))
        compose.setContent { MaterialTheme { CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) { PermissionSetupScreen(state.value, manufacturer = "TECNO") } } }
        compose.onNodeWithText("إعداد OfficeCalls").assertIsDisplayed()
        compose.onNodeWithTag("setup-contacts").assertIsEnabled()
        compose.onNodeWithTag("setup-notifications").assertIsNotEnabled()
        compose.onNodeWithTag("setup-enter").assertIsNotEnabled()
        screenshot("first-run-light")
        compose.runOnIdle { state.value = state.value.copy(contacts = true) }
        compose.onNodeWithTag("setup-notifications").performScrollTo().assertIsEnabled()
        compose.onNodeWithText("هل يظهر «يتحكم فيه إعداد محظور»؟").assertDoesNotExist()
        compose.onNodeWithTag("setup-restricted-help").performScrollTo().performClick()
        compose.onNodeWithText("هل يظهر «يتحكم فيه إعداد محظور»؟").assertExists()
        screenshot("restricted-settings-help")
    }
    @Test fun enterRequiresLiveConnectionAndRevocationDisablesItAgain() {
        val state = mutableStateOf(ready().copy(listenerConnected = false))
        var enters = 0
        compose.setContent { MaterialTheme { CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) { PermissionSetupScreen(state.value, onEnter = { enters++ }) } } }
        compose.onNodeWithTag("setup-enter").assertIsNotEnabled()
        compose.runOnIdle { state.value = ready() }
        compose.onNodeWithTag("setup-enter").assertIsEnabled().performClick()
        assertEquals(1, enters)
        compose.runOnIdle { state.value = ready().copy(contacts = false) }
        compose.onNodeWithTag("setup-enter").assertIsNotEnabled()
    }
    @Test fun oemReviewHasHonestStatusAndAccessibleCheckbox() {
        val state = mutableStateOf(ready().copy(autoStartReviewed = false))
        compose.setContent { MaterialTheme { CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
            PermissionSetupScreen(state.value, manufacturer = "TECNO", onAutoStartReviewed = { state.value = state.value.copy(autoStartReviewed = it) })
        } } }
        compose.onNodeWithTag("setup-autostart-review").performScrollTo().assertIsEnabled().performClick()
        compose.onNodeWithText("✓ تمت المراجعة اليدوية — التفعيل غير قابل للتحقق").assertExists()
        compose.onNodeWithTag("setup-enter").assertIsEnabled()
        screenshot("oem-review-light")
    }
    @Test fun darkModeKeepsArabicSetupAndDisabledActionReadable() {
        compose.setContent { MaterialTheme(colorScheme = darkColorScheme()) { CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
            PermissionSetupScreen(ready().copy(notificationEnabled = false, listenerConnected = false), manufacturer = "TECNO")
        } } }
        compose.onNodeWithTag("setup-enter").assertIsNotEnabled()
        screenshot("first-run-dark")
    }
    @Test @Config(qualifiers = "w800dp-h360dp-land-mdpi") fun landscapeLargeTextCanScrollToEveryRequiredStepAndEnter() {
        compose.setContent { MaterialTheme(colorScheme = lightColorScheme()) { CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl,
            LocalDensity provides Density(1f, 1.8f)) { PermissionSetupScreen(ready(), manufacturer = "TECNO") } } }
        compose.onNodeWithTag("setup-autostart-review").performScrollTo().assertIsDisplayed()
        screenshot("landscape-large-text-oem")
        compose.onNodeWithTag("setup-enter").performScrollTo().assertIsDisplayed().assertIsEnabled()
        screenshot("landscape-large-text-enter")
    }
}
