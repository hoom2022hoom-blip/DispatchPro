package com.maktab.calls

import android.Manifest
import android.app.ActivityManager
import android.app.Application
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.PowerManager
import android.provider.Settings
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PermissionSetupAndroidTest {
    private lateinit var app: Application
    private lateinit var component: ComponentName
    @Before fun setup() {
        app = RuntimeEnvironment.getApplication()
        component = ComponentName(app, WhatsAppNotificationListener::class.java)
        app.getSharedPreferences(PermissionSetup.PREFS, Context.MODE_PRIVATE).edit().clear().commit()
        shadowOf(app).denyPermissions(Manifest.permission.READ_CONTACTS)
        Settings.Secure.putString(app.contentResolver, "enabled_notification_listeners", "")
        shadowOf(app.getSystemService(NotificationManager::class.java)).setNotificationListenerAccessGranted(component, false)
        shadowOf(app.getSystemService(PowerManager::class.java)).setIgnoringBatteryOptimizations(app.packageName, false)
        shadowOf(app.getSystemService(ActivityManager::class.java)).setBackgroundRestricted(false)
        setConnected(false)
    }
    // Test fixture only. Production learns this state solely from NotificationListenerService callbacks.
    private fun setConnected(value: Boolean) {
        WhatsAppNotificationListener::class.java.getDeclaredField("connected").apply { isAccessible = true }.setBoolean(null, value)
    }
    private fun grantAccess() {
        Settings.Secure.putString(app.contentResolver, "enabled_notification_listeners", component.flattenToString())
        shadowOf(app.getSystemService(NotificationManager::class.java)).setNotificationListenerAccessGranted(component, true)
    }
    private fun fullyReady() {
        shadowOf(app).grantPermissions(Manifest.permission.READ_CONTACTS)
        grantAccess(); setConnected(true)
        shadowOf(app.getSystemService(PowerManager::class.java)).setIgnoringBatteryOptimizations(app.packageName, true)
        PermissionSetup.reviewed(app, PermissionSetup.BACKGROUND_REVIEWED, true)
        PermissionSetup.reviewed(app, PermissionSetup.AUTOSTART_REVIEWED, true)
    }
    @Test fun firstLaunchIsBlockedAndCannotPersistCompletion() {
        assertFalse(PermissionSetup.completed(app)); assertFalse(PermissionSetup.read(app).ready)
        assertFalse(PermissionSetup.finish(app)); assertFalse(PermissionSetup.completed(app))
    }
    @Test fun contactsAreReadFromAndroidAndRevocationBlocksEvenSavedOnboarding() {
        fullyReady(); assertTrue(PermissionSetup.finish(app)); assertTrue(PermissionSetup.completed(app))
        shadowOf(app).denyPermissions(Manifest.permission.READ_CONTACTS)
        assertFalse(PermissionSetup.read(app).contacts); assertFalse(PermissionSetup.read(app).ready)
        assertFalse(PermissionSetup.finish(app))
    }
    @Test fun accessRequiresEnabledPackageExactComponentAndLiveConnection() {
        fullyReady(); assertTrue(PermissionSetup.read(app).notificationReady)
        setConnected(false); assertTrue(PermissionSetup.read(app).notificationEnabled); assertFalse(PermissionSetup.read(app).ready)
        setConnected(true)
        Settings.Secure.putString(app.contentResolver, "enabled_notification_listeners", "")
        assertFalse(PermissionSetup.read(app).notificationReady)
        grantAccess()
        shadowOf(app.getSystemService(NotificationManager::class.java)).setNotificationListenerAccessGranted(component, false)
        assertFalse(PermissionSetup.read(app).notificationReady)
    }
    @Test fun enabledOtherServiceInSamePackageCannotCountAsOfficeCallsAccess() {
        fullyReady()
        val other = ComponentName(app.packageName, "OtherListener")
        Settings.Secure.putString(app.contentResolver, "enabled_notification_listeners", other.flattenToString())
        shadowOf(app.getSystemService(NotificationManager::class.java)).setNotificationListenerAccessGranted(component, false)
        assertFalse(PermissionSetup.read(app).notificationEnabled)
    }
    @Test fun batteryExemptionAndBackgroundRestrictionUseActualSystemState() {
        fullyReady(); assertTrue(PermissionSetup.read(app).ready)
        shadowOf(app.getSystemService(PowerManager::class.java)).setIgnoringBatteryOptimizations(app.packageName, false)
        assertFalse(PermissionSetup.read(app).ready)
        shadowOf(app.getSystemService(PowerManager::class.java)).setIgnoringBatteryOptimizations(app.packageName, true)
        shadowOf(app.getSystemService(ActivityManager::class.java)).setBackgroundRestricted(true)
        assertFalse(PermissionSetup.read(app).ready)
    }
    @Test fun manualOemReviewDoesNotReplaceAnyCriticalGrant() {
        PermissionSetup.reviewed(app, PermissionSetup.BACKGROUND_REVIEWED, true)
        PermissionSetup.reviewed(app, PermissionSetup.AUTOSTART_REVIEWED, true)
        assertFalse(PermissionSetup.read(app).ready)
        fullyReady(); assertTrue(PermissionSetup.finish(app))
        val host = "192.168.1.8"
        app.getSharedPreferences(NetworkSender.PREFS_NAME, Context.MODE_PRIVATE).edit().putString(NetworkSender.KEY_HOST, host).putInt(NetworkSender.KEY_PORT, 5050).commit()
        assertTrue(PermissionSetup.finish(app))
        assertEquals(host, app.getSharedPreferences(NetworkSender.PREFS_NAME, 0).getString(NetworkSender.KEY_HOST, ""))
        assertEquals(5050, app.getSharedPreferences(NetworkSender.PREFS_NAME, 0).getInt(NetworkSender.KEY_PORT, 0))
    }
    @Test fun permissionSetupChecksInternetDeclarationWithoutRuntimeRequest() {
        assertTrue(PermissionSetup.read(app).internetDeclared)
        val manifest = app.packageManager.getPackageInfo(app.packageName, android.content.pm.PackageManager.GET_PERMISSIONS).requestedPermissions.orEmpty()
        for (unneeded in listOf(Manifest.permission.READ_SMS, Manifest.permission.READ_PHONE_STATE, Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO, Manifest.permission.POST_NOTIFICATIONS)) assertFalse(unneeded in manifest)
    }
    @Test fun settingsIntentTargetsOfficialListenerDetailThenList() {
        val intents = PermissionSetup.notificationIntents(app)
        assertEquals(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS, intents.first().action)
        assertEquals(component.flattenToString(), intents.first().getStringExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME))
        assertEquals(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS, intents.last().action)
    }
    @Test fun unsupportedAndSecurityFailingOemIntentsFallBackWithoutCrashing() {
        val candidate = Intent("test.OEM")
        val attempted = mutableListOf<String?>()
        assertTrue(PermissionSetup.openSettings(app, listOf(candidate), canOpen = { true }, launch = {
            attempted.add(it.action)
            if (it.action == candidate.action) throw SecurityException("not exported")
        }))
        assertEquals(listOf("test.OEM", Settings.ACTION_APPLICATION_DETAILS_SETTINGS), attempted)
    }
    @Test fun noSettingsHandlerOrAllFallbacksFailReturnsFalse() {
        assertFalse(PermissionSetup.openSettings(app, emptyList(), canOpen = { false }, launch = { fail("Must not launch") }))
        assertFalse(PermissionSetup.openSettings(app, PermissionSetup.notificationIntents(app), canOpen = { true }, launch = { throw android.content.ActivityNotFoundException() }))
    }
    @Test fun oemCandidatesAreScopedAndUnsupportedBrandHasNoInventedSuccess() {
        assertTrue(PermissionSetup.oemIntents("TECNO", true).all { it.component?.packageName?.startsWith("com.transsion.") == true })
        assertTrue(PermissionSetup.oemIntents("Xiaomi", true).all { it.component?.packageName == "com.miui.securitycenter" })
        assertTrue(PermissionSetup.oemIntents("unrecognized-device", true).isEmpty())
        assertFalse(PermissionSetup.read(app).autoStartReviewed)
    }
    @Test fun deniedNotificationAccessAfterCompletionCannotUseCachedReadyValue() {
        fullyReady(); assertTrue(PermissionSetup.finish(app))
        Settings.Secure.putString(app.contentResolver, "enabled_notification_listeners", "")
        assertFalse(PermissionSetup.read(app).criticalReady)
        assertFalse(PermissionSetup.finish(app))
    }
    @Test fun listenerDisconnectPublishesImmediateStateChange() {
        val service = Robolectric.buildService(WhatsAppNotificationListener::class.java).create().get()
        setConnected(true)
        service.onListenerDisconnected()
        assertFalse(WhatsAppNotificationListener.connected)
        assertTrue(shadowOf(app).broadcastIntents.any { it.action == WhatsAppNotificationListener.ACTION_LISTENER_STATE && it.`package` == app.packageName })
    }
    @Test @Config(sdk = [24]) fun minimumAndroidUsesExactSecureComponentAndHonestUnknownBackgroundState() {
        Settings.Secure.putString(app.contentResolver, "enabled_notification_listeners", component.flattenToString())
        assertTrue(PermissionSetup.notificationAccess(app))
        assertNull(PermissionSetup.read(app).backgroundRestricted)
        assertEquals(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS, PermissionSetup.notificationIntents(app).single().action)
    }
}
