package com.maktab.calls

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.service.notification.NotificationListenerService
import android.util.Log

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action !in setOf(
                Intent.ACTION_BOOT_COMPLETED,
                Intent.ACTION_LOCKED_BOOT_COMPLETED,
                Intent.ACTION_MY_PACKAGE_REPLACED
            )
        ) return

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try {
                NotificationListenerService.requestRebind(
                    ComponentName(context, WhatsAppNotificationListener::class.java)
                )
            } catch (error: Exception) {
                Log.w("MaktabCalls", "Notification listener rebind failed after boot", error)
            }
        }
    }
}
