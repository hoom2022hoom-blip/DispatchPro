package com.maktab.calls
import android.service.notification.NotificationListenerService
/** Stable manifest component remains WhatsAppNotificationListener to preserve granted access on upgrade. */
abstract class NotificationCaptureService : NotificationListenerService()
