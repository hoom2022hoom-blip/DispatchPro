package com.maktab.calls

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.service.notification.NotificationListenerService

/** One system-owned recovery attempt per real lifecycle loss/process start; no timer or polling loop. */
class ListenerRecoveryJobService : JobService() {
    override fun onStartJob(params: JobParameters): Boolean {
        BackgroundRuntime.record(this, "JOB_STARTED", "kind=LISTENER_RECOVERY; jobId=${params.jobId}")
        if (PermissionSetup.notificationAccess(this) && !WhatsAppNotificationListener.connected) {
            runCatching { NotificationListenerService.requestRebind(ComponentName(this, WhatsAppNotificationListener::class.java)) }
                .onSuccess { BackgroundRuntime.record(this, "LISTENER_REBIND_REQUESTED", "source=RECOVERY_JOB") }
                .onFailure { BackgroundRuntime.record(this, "LISTENER_REBIND_FAILED", "error=${it.javaClass.simpleName}") }
        }
        RetryJobService.schedule(this)
        return false
    }
    override fun onStopJob(params: JobParameters): Boolean = false
    companion object {
        internal const val ID = 5051
        fun schedule(context: Context, reason: String) {
            val app = context.applicationContext
            if (!PermissionSetup.notificationAccess(app)) return
            if (reason == "PROCESS_START" && WhatsAppNotificationListener.connected) return
            val scheduler = app.getSystemService(JobScheduler::class.java)
            if (scheduler.getPendingJob(ID) != null) return
            fun job(expedited: Boolean): JobInfo {
                val builder = JobInfo.Builder(ID, ComponentName(app, ListenerRecoveryJobService::class.java)).setPersisted(true)
                if (Build.VERSION.SDK_INT >= 31 && expedited) builder.setExpedited(true)
                else builder.setMinimumLatency(0) // Ordinary jobs require an explicit constraint on older Android.
                return builder.build()
            }
            val expedited = Build.VERSION.SDK_INT >= 31
            var result = runCatching {scheduler.schedule(job(expedited))}.getOrDefault(JobScheduler.RESULT_FAILURE)
            if (result != JobScheduler.RESULT_SUCCESS && expedited) result = runCatching {scheduler.schedule(job(false))}.getOrDefault(JobScheduler.RESULT_FAILURE)
            BackgroundRuntime.record(app, if(result == JobScheduler.RESULT_SUCCESS) "LISTENER_RECOVERY_SCHEDULED" else "LISTENER_RECOVERY_FAILED", "reason=$reason; jobId=$ID")
        }
    }
}
