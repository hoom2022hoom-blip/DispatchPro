package com.maktab.calls

import android.os.Looper
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 34])
class ActivityCompatibilityAndroidTest {
    @Test fun arabicHomeLaunchesOnMinimumAndModernAndroid() {
        val app: android.app.Application = org.robolectric.RuntimeEnvironment.getApplication()
        // Android grants this merged-manifest signature permission at install; model it in Robolectric.
        shadowOf(app).grantPermissions("${app.packageName}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION")
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        try {
            shadowOf(Looper.getMainLooper()).idle()
            assertNotNull(controller.get().window.decorView)
            assertFalse(controller.get().isFinishing)
            val service = Robolectric.buildService(WhatsAppNotificationListener::class.java).create().get()
            val n = android.app.Notification.Builder(app).setSmallIcon(android.R.drawable.sym_call_incoming)
                .setContentTitle("0591234567").setContentText("Incoming voice call").setCategory(android.app.Notification.CATEGORY_CALL).build()
            val sbn = android.service.notification.StatusBarNotification("com.whatsapp", "com.whatsapp", 1, null, 1000, 0, 0, n, android.os.UserHandle.getUserHandleForUid(0), 1000L)
            service.processSafely(sbn)
            assertTrue(CallStore.get(app).pending().any { it.second.contains("0591234567") })
        } finally { controller.pause().stop().destroy() }
    }
}
