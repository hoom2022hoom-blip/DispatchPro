package com.maktab.calls

import android.app.Activity
import android.app.Application
import android.os.Bundle

/** Created by Android for listener/jobs too, before any Activity exists. */
class OfficeCallsApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        val settings=getSharedPreferences(NetworkSender.PREFS_NAME,MODE_PRIVATE)

        BackgroundRuntime.start(this)
        if(!LocalReceiverTransport.enabled(this)) NetworkConnectionManager.start(this)
        registerActivityLifecycleCallbacks(object : ActivityLifecycleCallbacks {
            override fun onActivityStarted(activity: Activity) { BackgroundRuntime.activityStarted(this@OfficeCallsApplication) }
            override fun onActivityStopped(activity: Activity) { BackgroundRuntime.activityStopped(this@OfficeCallsApplication) }
            override fun onActivityCreated(activity: Activity, state: Bundle?) = Unit
            override fun onActivityResumed(activity: Activity) = Unit
            override fun onActivityPaused(activity: Activity) = Unit
            override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) = Unit
            override fun onActivityDestroyed(activity: Activity) = Unit
        })
        // Durable system-owned work; no Activity-triggered flush is required on process restart.
        RetryJobService.schedule(this)
        ListenerRecoveryJobService.schedule(this, "PROCESS_START")
    }
}
