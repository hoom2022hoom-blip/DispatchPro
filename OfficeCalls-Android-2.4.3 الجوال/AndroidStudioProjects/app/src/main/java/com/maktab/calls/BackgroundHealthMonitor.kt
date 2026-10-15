package com.maktab.calls
import android.content.Context
internal object BackgroundHealthMonitor {
    fun connected(context: Context)=PermissionSetup.notificationAccess(context) && WhatsAppNotificationListener.connected
    fun requestRecovery(context: Context)=ListenerRecoveryJobService.schedule(context,"USER_HEALTH_CHECK")
}
