package com.maktab.calls

import android.content.Context
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger

/** Observation only: foreground state never gates parsing, queuing or delivery. No notification text. */
internal object BackgroundRuntime {
    @Volatile var processId: String = ""
        private set
    private val activities = AtomicInteger()
    val foreground get() = activities.get() > 0
    fun start(context: Context) {
        activities.set(0)
        val store = CallStore.get(context.applicationContext)
        val previous = store.state("process_id")
        processId = UUID.randomUUID().toString()
        store.setState("process_id", processId)
        store.setState("process_started_at", System.currentTimeMillis().toString())
        record(context, if (previous.isBlank()) "PROCESS_CREATED" else "PROCESS_RESTARTED", "pid=${android.os.Process.myPid()}")
    }
    fun activityStarted(context: Context) {
        if (activities.incrementAndGet() == 1) record(context, "ACTIVITY_FOREGROUND")
    }
    fun activityStopped(context: Context) {
        if (activities.updateAndGet { maxOf(0, it - 1) } == 0) record(context, "ACTIVITY_LEFT_FOREGROUND")
    }
    fun serviceCreated(context: Context): String {
        val generation=UUID.randomUUID().toString()
        CallStore.get(context.applicationContext).setState("listener_generation",generation)
        record(context,"SERVICE_CREATED")
        return generation
    }
    fun record(context: Context, status: String, detail: String = "", pkg: String = "") {
        val store = CallStore.get(context.applicationContext)
        val now = System.currentTimeMillis()
        store.setState("trace_${status.lowercase(java.util.Locale.ROOT)}", now.toString())
        if (status.startsWith("NOTIFICATION_RECEIVED_")) {
            store.setState("last_notification_at", now.toString())
            store.setState("last_notification_process", processId)
        }
        if (status == "NOTIFICATION_RECEIVED_BACKGROUND") store.setState("last_background_event_at", now.toString())
        store.log(pkg, status=status, detail="atMs=$now; process=$processId; activityForeground=$foreground; $detail")
    }
    fun queued(context: Context, eventId: String, background: Boolean, listenerGeneration: String) {
        val store=CallStore.get(context.applicationContext)
        store.setState("delivery_context_$eventId", if (background) "$processId|$listenerGeneration" else "FOREGROUND")
    }
    fun delivered(context: Context, eventId: String, target: String) {
        val store = CallStore.get(context.applicationContext)
        val now = System.currentTimeMillis().toString()
        store.setState("last_tcp_delivery_at", now)
        store.setState("last_tcp_delivery_process", processId)
        val origin = store.state("delivery_context_$eventId")
        if (origin.isNotBlank() && origin != "FOREGROUND" && !foreground) {
            val receiveProcess=origin.substringBefore('|')
            val receiveGeneration=origin.substringAfter('|',"")
            store.setState("last_background_ack_at", now)
            store.setState("last_background_ack_process", receiveProcess)
            store.setState("last_background_ack_generation", receiveGeneration)
            store.setState("last_background_ack_target", target)
            record(context, "BACKGROUND_DELIVERY_CONFIRMED", "eventId=$eventId; receiveProcess=$receiveProcess; listenerGeneration=$receiveGeneration")
        }
        store.removeState("delivery_context_$eventId")
    }
}
