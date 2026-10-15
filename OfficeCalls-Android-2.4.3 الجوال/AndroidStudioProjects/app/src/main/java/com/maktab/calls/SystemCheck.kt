package com.maktab.calls

import android.content.Context

/** Historical server ACK and a recent authenticated HTTPS health probe are distinct evidence. */
internal object SystemCheck {
    const val REVIEWED="system_check_reviewed"
    data class Snapshot(val setup: PermissionSetup.Snapshot, val businessInstalled: Boolean,
        val receiverConfigured: Boolean, val endpoint: String, val tcpConnected: Boolean, val ackVerified: Boolean,
        val backgroundAckVerified: Boolean=false, val lastNotificationAt: String="", val lastBackgroundEventAt: String="",
        val lastTcpDeliveryAt: String="", val lastServiceCreatedAt: String="", val lastServiceDestroyedAt: String="",
        val lastProcessStartAt: String="") {
        val canTestCall get() = setup.criticalReady && setup.internetDeclared && setup.backgroundRestricted != true && businessInstalled && receiverConfigured && tcpConnected
        val ready get() = canTestCall && ackVerified && backgroundAckVerified
    }
    fun validReceiver(host: String, port: String): Boolean = host.trim().isNotEmpty() && host.none { it.isWhitespace() || it in "/\\@?#" } &&
        port.toIntOrNull()?.let { it in 1..65535 } == true
    @Suppress("DEPRECATION")
    fun read(context: Context): Snapshot {
        if(LocalReceiverTransport.enabled(context)) {
            val store=CallStore.get(context);val prefs=context.getSharedPreferences(NetworkSender.PREFS_NAME,0)
            val endpoint=LocalReceiverTransport.endpoint(context)
            val configured=LocalReceiverTransport.validHost(prefs.getString(NetworkSender.KEY_HOST,"").orEmpty()) && prefs.getString("local_pin","").orEmpty().length==64 && prefs.getString("local_token","").orEmpty().length==64
            val health=store.state("local_health_time").toLongOrNull() ?: 0L
            val connected=configured && health>0 && System.currentTimeMillis()-health in 0..59_999 && store.state("local_health_target")==endpoint
            val ack=configured && store.state("last_ack_target")==endpoint && store.state("last_ack").isNotBlank()
            val background=ack && store.state("last_background_ack_target")==endpoint && store.state("last_background_ack_process")==BackgroundRuntime.processId && store.state("last_background_ack_generation")==store.state("listener_generation") && store.state("last_background_ack_at").isNotBlank()
            val installed=CallNotificationRules.packages.any {runCatching {context.packageManager.getPackageInfo(it,0)}.isSuccess}
            return Snapshot(PermissionSetup.read(context),installed,configured,endpoint,connected,ack,background,
                store.state("last_notification_at"),store.state("last_background_event_at"),store.state("last_tcp_delivery_at"),store.state("trace_service_created"),store.state("trace_service_destroyed"),store.state("process_started_at"))
        }
        val endpoint=OfficeHttpsTransport.BASE
        val store=CallStore.get(context)
        val configured=DevicePairingManager.office(context).isNotBlank()
        val health=store.state("server_health_time").toLongOrNull() ?: 0L
        val tcp=configured && health>0 && System.currentTimeMillis()-health<60_000 && store.state("server_health_office")==DevicePairingManager.office(context)
        val ack=configured && store.state("last_ack_target") == endpoint && store.state("last_ack").isNotBlank() && store.state("last_ack_office")==DevicePairingManager.office(context)
        val backgroundAck=ack && store.state("last_background_ack_target") == endpoint &&
            BackgroundRuntime.processId.isNotBlank() && store.state("last_background_ack_process") == BackgroundRuntime.processId &&
            store.state("listener_generation").isNotBlank() && store.state("last_background_ack_generation") == store.state("listener_generation") &&
            store.state("last_background_ack_at").isNotBlank()
        return Snapshot(PermissionSetup.read(context),runCatching {context.packageManager.getPackageInfo("com.whatsapp.w4b",0)}.isSuccess,
            configured,endpoint,tcp,ack,backgroundAck,store.state("last_notification_at"),store.state("last_background_event_at"),
            store.state("last_tcp_delivery_at"),store.state("trace_service_created"),store.state("trace_service_destroyed"),store.state("process_started_at"))
    }
}
