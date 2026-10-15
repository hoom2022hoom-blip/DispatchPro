package com.maktab.calls

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper

class RetryJobService : JobService() {
    private val running = mutableMapOf<Int, NetworkSender.Cancellation>()
    private val main = Handler(Looper.getMainLooper())
    override fun onStartJob(params: JobParameters): Boolean {
        val cancellation = NetworkSender.Cancellation()
        running[params.jobId] = cancellation
        BackgroundRuntime.record(applicationContext,"JOB_STARTED","kind=OUTBOX; jobId=${params.jobId}; expedited=${Build.VERSION.SDK_INT >= 31 && params.isExpeditedJob}")
        NetworkSender.flushCancellable(applicationContext,cancellation) { pending ->
            main.post {
                if(running[params.jobId] === cancellation && !cancellation.cancelled) {
                    running.remove(params.jobId)
                    BackgroundRuntime.record(applicationContext,"JOB_FINISHED","kind=OUTBOX; pending=$pending")
                    jobFinished(params,pending)
                }
            }
        }
        return true
    }
    override fun onStopJob(params: JobParameters): Boolean {
        running.remove(params.jobId)?.cancelled = true
        BackgroundRuntime.record(applicationContext,"JOB_STOPPED","kind=OUTBOX; jobId=${params.jobId}; reason=${if(Build.VERSION.SDK_INT >= 31) params.stopReason else -1}")
        return true // System reschedules; pending payload/eventId stays unchanged.
    }
    override fun onDestroy() {
        running.values.forEach {it.cancelled = true};running.clear()
        super.onDestroy()
    }
    companion object {
        private const val ID = 5050
        fun schedule(context: Context) {
            val scheduler = context.getSystemService(JobScheduler::class.java)
            if (CallStore.get(context).pending().isEmpty() && ReliableDeliveryQueue(context).awaiting().isEmpty()) return
            // Keep a single system-owned job; callbacks must not create concurrent retries.
            if (scheduler.getPendingJob(ID) != null) return
            fun job(expedited: Boolean): JobInfo {
                val builder = JobInfo.Builder(ID, ComponentName(context.applicationContext, RetryJobService::class.java))
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true)
                    // Transport already backs off. Doubling the system delay as well
                    // can consume the entire five-minute live display window.
                    .setBackoffCriteria(10_000, JobInfo.BACKOFF_POLICY_LINEAR)
                if(Build.VERSION.SDK_INT >= 31 && expedited) builder.setExpedited(true)
                return builder.build()
            }
            val expedited = Build.VERSION.SDK_INT >= 31
            var result = runCatching {scheduler.schedule(job(expedited))}.getOrDefault(JobScheduler.RESULT_FAILURE)
            if(result != JobScheduler.RESULT_SUCCESS && expedited) {
                BackgroundRuntime.record(context,"JOB_EXPEDITED_UNAVAILABLE","kind=OUTBOX; fallback=REGULAR")
                result = runCatching {scheduler.schedule(job(false))}.getOrDefault(JobScheduler.RESULT_FAILURE)
            }
            BackgroundRuntime.record(context,if(result == JobScheduler.RESULT_SUCCESS) "JOB_SCHEDULED" else "JOB_SCHEDULE_FAILED","kind=OUTBOX; event retained")
        }
    }
}
