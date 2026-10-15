package com.maktab.calls

import android.app.Application
import android.app.Notification
import android.app.NotificationManager
import android.Manifest
import android.app.job.JobParameters
import android.os.Looper
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context
import android.os.UserHandle
import android.provider.Settings
import android.provider.ContactsContract as C
import android.service.notification.StatusBarNotification
import org.junit.Assert.*
import org.junit.Before
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.net.ServerSocket
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.robolectric.android.controller.ServiceController

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35])
class BackgroundLifecycleAndroidTest {
    private lateinit var app: Application
    private lateinit var store: CallStore
    private lateinit var scheduler: JobScheduler
    private val services=mutableListOf<ServiceController<WhatsAppNotificationListener>>()
    @Before fun setup() {
        app=RuntimeEnvironment.getApplication();store=CallStore.get(app)
        assertTrue("Android must create the independent Application before any Activity",app is OfficeCallsApplication)
        assertFalse("Application initializes runtime without MainActivity",BackgroundRuntime.processId.isBlank())
        listOf("outbox","call_history","call_metadata","sessions","aliases","diagnostics","state","delivery").forEach {store.writableDatabase.delete(it,null,null)}
        store.writableDatabase.execSQL("CREATE TABLE IF NOT EXISTS local_retry(id TEXT PRIMARY KEY, revision INTEGER, retries INTEGER DEFAULT 0, next_attempt INTEGER DEFAULT 0)")
        store.writableDatabase.delete("local_retry",null,null)
        scheduler=app.getSystemService(JobScheduler::class.java);scheduler.cancelAll()
        NetworkSender.clock={1000L}
        NetworkSender.localRequest={_,_->throw java.io.IOException("OFFLINE_FIXTURE")}
        app.getSharedPreferences(NetworkSender.PREFS_NAME,Context.MODE_PRIVATE).edit().clear()
            .putString(NetworkSender.KEY_HOST,"192.168.1.8").putInt(NetworkSender.KEY_PORT,5051)
            .putString("local_token","a".repeat(64)).putString("local_pin","b".repeat(64)).commit()
        val component=ComponentName(app,WhatsAppNotificationListener::class.java)
        Settings.Secure.putString(app.contentResolver,"enabled_notification_listeners",component.flattenToString())
        shadowOf(app.getSystemService(NotificationManager::class.java)).setNotificationListenerAccessGranted(component,true)
        shadowOf(app).denyPermissions(Manifest.permission.READ_CONTACTS)
        shadowOf(app).grantPermissions("${app.packageName}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION")
        WhatsAppNotificationListener::class.java.getDeclaredField("connected").apply {isAccessible=true}.setBoolean(null,false)
        BackgroundRuntime.start(app)
    }
    @After fun cleanup() {
        services.forEach {drain(it.get());it.destroy()}
        drainNetwork()
        NetworkSender.localRequest=LocalReceiverTransport::request;NetworkSender.clock=System::currentTimeMillis
    }
    private fun service() = Robolectric.buildService(WhatsAppNotificationListener::class.java).create().also {services.add(it)}.get()
    private fun drain(service: WhatsAppNotificationListener) {
        val events=WhatsAppNotificationListener::class.java.getDeclaredField("events").apply {isAccessible=true}.get(service) as java.util.concurrent.ExecutorService
        if(!events.isShutdown) events.submit {}.get(10,TimeUnit.SECONDS)
    }
    private fun drainNetwork() {
        val executor=NetworkSender::class.java.getDeclaredField("executor").apply {isAccessible=true}.get(NetworkSender) as java.util.concurrent.ExecutorService
        executor.submit {}.get(10,TimeUnit.SECONDS)
    }
    private fun awaitAck() {
        val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(8)
        while(store.state("last_ack").isBlank() && System.nanoTime()<deadline) Thread.sleep(10)
        assertFalse("Service pipeline must deliver without any Activity/manual flush",store.state("last_ack").isBlank())
        assertTrue(store.pending().isEmpty())
    }
    private fun receiver(action: ()->Unit): String {
        ServerSocket(0).use {server ->
            server.soTimeout=10000
            val worker=Executors.newSingleThreadExecutor()
            val received=worker.submit<String> {server.accept().use {socket ->
                socket.soTimeout=10000
                val line=socket.getInputStream().bufferedReader().readLine()
                val id=org.json.JSONObject(line).getString("eventId")
                socket.getOutputStream().write("OK $id\n".toByteArray());line
            }}
            // Explicit local HTTPS test boundary; the payload is checked over a real loopback TCP ACK fixture.
            // This does not claim production TLS or a WhatsApp call on a physical phone.
            app.getSharedPreferences(NetworkSender.PREFS_NAME,0).edit().putInt(NetworkSender.KEY_PORT,server.localPort).commit()
            NetworkSender.localRequest={_,body->
                require(body!=null)
                CallTcpTransport.send("127.0.0.1",server.localPort,body.toString(),body.getString("eventId"))
                org.json.JSONObject().put("eventId",body.getString("eventId")).put("revision",body.getInt("revision")).put("receiverAcknowledged",true).put("gridCms","RECEIVER_ACK")
            }
            try {action();val body=received.get(10,TimeUnit.SECONDS);awaitAck();return body} finally {worker.shutdownNow()}
        }
    }
    // Construct the framework's public test object using its hidden constructor in the test sandbox only.
    // This never appears in production and does not forge/execute a real system job on the phone.
    private fun params(id: Int=5050): JobParameters {
        val constructor=JobParameters::class.java.declaredConstructors.first {it.parameterCount>1}.apply {isAccessible=true}
        val arguments=constructor.parameterTypes.map {type -> when(type) {
            java.lang.Integer.TYPE -> id
            java.lang.Boolean.TYPE -> false
            android.os.PersistableBundle::class.java -> android.os.PersistableBundle()
            android.os.Bundle::class.java -> android.os.Bundle()
            else -> null
        }}.toTypedArray()
        return constructor.newInstance(*arguments) as JobParameters
    }
    private fun notification(caller: String="0591234567"): StatusBarNotification {
        val builder=if(android.os.Build.VERSION.SDK_INT >= 26) Notification.Builder(app,"calls") else Notification.Builder(app)
        val n=builder.setSmallIcon(android.R.drawable.sym_call_incoming)
            .setCategory(Notification.CATEGORY_CALL).setContentTitle(caller).setContentText("Incoming voice call").build()
        n.extras.putInt("android.callType",1)
        return StatusBarNotification("com.whatsapp.w4b","com.whatsapp.w4b",7,null,1000,0,0,n,UserHandle.getUserHandleForUid(0),1000)
    }
    @Test fun destroyedListenerHasOfficialRecoveryWithoutOpeningActivityOrHavingOutbox() {
        val controller=Robolectric.buildService(WhatsAppNotificationListener::class.java).create()
        controller.destroy()
        assertTrue("Listener destruction must schedule recovery even with empty outbox",scheduler.allPendingJobs.any {it.service.className.endsWith("ListenerRecoveryJobService")})
    }
    @Test fun callbackEntryIsRecordedBeforeDeferredProcessing() {
        val controller=Robolectric.buildService(WhatsAppNotificationListener::class.java).create()
        try {
            controller.get().onNotificationPosted(notification())
            assertFalse("Callback arrival must be durable before executor runs",store.state("last_notification_at").isBlank())
        } finally {drain(controller.get());controller.destroy()}
    }
    @Test fun backgroundDeliveryJobUsesExpeditedLifecycleOnModernAndroid() {
        store.capture("com.whatsapp.w4b","key","0591234567",1000)
        RetryJobService.schedule(app)
        assertTrue(scheduler.allPendingJobs.single {it.service.className.endsWith("RetryJobService")}.isExpedited)
    }
    @Test fun deliveryRetriesDoNotCompoundTransportBackoffWithExponentialSystemDelays() {
        store.capture("com.whatsapp.w4b","retry-policy","0591234567",System.currentTimeMillis())
        RetryJobService.schedule(app)
        val job=scheduler.allPendingJobs.single {it.service.className.endsWith("RetryJobService")}
        assertEquals(android.app.job.JobInfo.BACKOFF_POLICY_LINEAR,job.backoffPolicy)
        assertEquals(10_000L,job.initialBackoffMillis)
        assertTrue(job.isPersisted)
        RetryJobService.schedule(app)
        assertEquals(1,scheduler.allPendingJobs.count {it.service.className.endsWith("RetryJobService")})
    }
    @Test fun actualCallbackQueuesWritesAndAcksWhenActivityNeverExisted() {
        assertFalse(BackgroundRuntime.foreground)
        val body=receiver {service().onNotificationPosted(notification())}
        assertEquals("0591234567",org.json.JSONObject(body).getString("number"))
        assertEquals("",store.state("trace_activity_foreground"))
        listOf("SERVICE_CREATED","NOTIFICATION_RECEIVED_BACKGROUND","NOTIFICATION_PROCESSING","CALL_SESSION_CREATED","PHONE_EXTRACTED","QUEUED","SENT","SENT","ACK").forEach {status ->
            assertTrue("Missing $status",store.logs().any {it.contains(" $status\n")})
        }
        drainNetwork();assertFalse(store.state("last_background_ack_at").isBlank())
    }
    @Test fun contactIndexInitializesFromServiceAndSavedNameAcksWithoutActivity() {
        shadowOf(app).grantPermissions(Manifest.permission.READ_CONTACTS)
        org.robolectric.shadows.ShadowContentResolver.registerProviderInternal(C.AUTHORITY,object: android.content.ContentProvider() {
            override fun onCreate()=true
            override fun query(uri: android.net.Uri, projection: Array<out String>?, selection: String?, args: Array<out String>?, sort: String?): android.database.Cursor {
                val cols=projection!!
                val cursor=android.database.MatrixCursor(cols)
                if(uri != android.provider.ContactsContract.Data.CONTENT_URI) cursor.addRow(cols.map<String,Any?> {col -> when(col) {
                    "_id" -> if(uri == android.provider.ContactsContract.RawContacts.CONTENT_URI) 11L else 1L
                    "contact_id" -> 1L
                    "raw_contact_id" -> 11L
                    "deleted" -> 0
                    "lookup" -> "synthetic-contact"
                    "data1" -> "+970591234567"
                    else -> "رمزي دياب"
                }}.toTypedArray())
                return cursor
            }
            override fun getType(uri: android.net.Uri): String?=null
            override fun insert(uri: android.net.Uri,values: android.content.ContentValues?): android.net.Uri?=null
            override fun delete(uri: android.net.Uri,selection: String?,args: Array<out String>?)=0
            override fun update(uri: android.net.Uri,values: android.content.ContentValues?,selection: String?,args: Array<out String>?)=0
        })
        val body=receiver {service().onNotificationPosted(notification("رمزي دياب"))}
        assertEquals("0591234567",org.json.JSONObject(body).getString("number"))
        assertEquals("رمزي دياب",org.json.JSONObject(body).getString("displayName"));assertFalse(BackgroundRuntime.foreground)
        assertTrue(store.logs().any {it.contains("PHONE_FROM_CONTACTS")})
    }
    @Test fun homeStopsActivityButCallbackPipelineStillDelivers() {
        val listener=service()
        val activity=Robolectric.buildActivity(MainActivity::class.java).setup()
        assertTrue(BackgroundRuntime.foreground)
        activity.pause().stop()
        assertFalse(BackgroundRuntime.foreground)
        try {receiver {listener.onNotificationPosted(notification())}} finally {activity.destroy()}
        assertTrue(store.logs().any {it.contains("ACTIVITY_LEFT_FOREGROUND")})
    }
    @Test fun destroyedActivityDoesNotDestroyOrGateListener() {
        val listener=service();listener.onListenerConnected();drain(listener)
        val activity=Robolectric.buildActivity(MainActivity::class.java).setup()
        activity.pause().stop().destroy()
        assertTrue(WhatsAppNotificationListener.connected);assertFalse(BackgroundRuntime.foreground)
        receiver {listener.onNotificationPosted(notification())}
    }
    @Test fun listenerCreatedAfterSimulatedProcessRestartRestoresOutboxWithoutActivity() {
        store.capture("com.whatsapp.w4b","old","0591234567",1000)
        val original=store.pending().single()
        val oldProcess=BackgroundRuntime.processId
        BackgroundRuntime.start(app)
        assertNotEquals(oldProcess,BackgroundRuntime.processId)
        val body=receiver {service()}
        assertEquals(original.second,body)
        assertTrue(store.logs().any {it.contains("PROCESS_RESTARTED")})
        assertEquals("",store.state("trace_activity_foreground"))
    }
    @Test fun queuedOutboxRunsFromJobServiceWithoutOpeningActivity() {
        store.capture("com.whatsapp.w4b","old","0591234567",1000)
        val original=store.pending().single()
        val controller=Robolectric.buildService(RetryJobService::class.java).create()
        try {
            val body=receiver {assertTrue(controller.get().onStartJob(params()))}
            assertEquals(original.second,body)
            shadowOf(Looper.getMainLooper()).idle()
            assertTrue(store.logs().any {it.contains("JOB_STARTED") && it.contains("kind=OUTBOX")})
        } finally {controller.destroy()}
    }
    @Test fun recoveryJobRequestsOfficialRebindWithoutActivity() {
        val controller=Robolectric.buildService(ListenerRecoveryJobService::class.java).create()
        try {
            assertFalse(controller.get().onStartJob(params(5051)))
            assertTrue(store.logs().any {it.contains("LISTENER_REBIND_REQUESTED") && it.contains("source=RECOVERY_JOB")})
            assertFalse(BackgroundRuntime.foreground)
        } finally {controller.destroy()}
    }
    @Test fun listenerDeathDoesNotThrowAndNewInstanceCanDeliver() {
        val first=Robolectric.buildService(WhatsAppNotificationListener::class.java).create()
        first.get().onListenerConnected();drain(first.get());first.destroy();drainNetwork()
        assertFalse(WhatsAppNotificationListener.connected)
        assertTrue(store.logs().any {it.contains("SERVICE_DESTROYED")})
        assertTrue(scheduler.allPendingJobs.any {it.service.className.endsWith("ListenerRecoveryJobService")})
        receiver {service().onNotificationPosted(notification())}
    }
    @Test fun callbacksAfterDestructionAreIgnoredWithoutExecutorCrash() {
        val first=Robolectric.buildService(WhatsAppNotificationListener::class.java).create()
        first.destroy()
        first.get().onNotificationPosted(notification());first.get().onNotificationRemoved(notification())
        drainNetwork();assertTrue(store.pending().isEmpty())
        assertTrue(store.logs().any {it.contains("CALLBACK_AFTER_DESTROY")})
    }
    @Test fun duplicateCallbacksWithoutActivityRetainSingleQueueEvent() {
        val listener=service();drainNetwork()
        repeat(6) {listener.onNotificationPosted(notification())};drain(listener);drainNetwork()
        assertEquals(1,store.pending().size)
        assertEquals(1,store.logs().count {it.contains(" CALL_SESSION_CREATED\n")})
    }
    @Test fun removalCallbackClosesSessionWithoutActivity() {
        val listener=service();listener.onNotificationPosted(notification());drain(listener)
        listener.onNotificationRemoved(notification());drain(listener);drainNetwork()
        assertTrue(store.logs().any {it.contains("CALL_FINISHED")})
        listener.onNotificationPosted(notification());drain(listener);drainNetwork()
        assertEquals(2,store.pending().size)
    }
    @Test fun reopeningActivityIsObservationOnlyAndDoesNotFlushWarmProcessOutbox() {
        val listener=service();drainNetwork()
        val activity=Robolectric.buildActivity(MainActivity::class.java).setup()
        activity.pause().stop()
        store.capture("com.whatsapp.w4b","old","0591234567",1000)
        val before=store.logs().count {it.contains("SENT") || it.contains("TCP_FAILED")}
        activity.start().resume();shadowOf(Looper.getMainLooper()).idle();drainNetwork()
        assertEquals(before,store.logs().count {it.contains("SENT") || it.contains("TCP_FAILED")})
        assertEquals(1,store.pending().size)
        activity.pause().stop().destroy();drain(listener)
    }
    @Test fun stoppingJobCancelsRemainingWorkAndDoesNotFinishStoppedJob() {
        store.capture("com.whatsapp.w4b","old","0591234567",1000)
        val controller=Robolectric.buildService(RetryJobService::class.java).create()
        val parameter=params()
        try {
            controller.get().onStartJob(parameter);assertTrue(controller.get().onStopJob(parameter))
            drainNetwork();shadowOf(Looper.getMainLooper()).idle()
            assertEquals(1,store.pending().size)
            assertFalse(store.logs().any {it.contains("JOB_FINISHED")})
        } finally {controller.destroy()}
    }
    @Test fun recoveryIsNotAnEndlessPeriodicOrForegroundService() {
        ListenerRecoveryJobService.schedule(app,"TEST")
        val job=scheduler.allPendingJobs.single {it.service.className.endsWith("ListenerRecoveryJobService")}
        assertFalse(job.isPeriodic);assertTrue(job.isPersisted);assertTrue(job.isExpedited)
        assertEquals(0,job.networkType)
        val before=scheduler.allPendingJobs.size
        ListenerRecoveryJobService.schedule(app,"TEST_AGAIN");assertEquals(before,scheduler.allPendingJobs.size)
    }
    @Test fun noRecoveryRebindIsNeededWhenConnectedOrAccessRevoked() {
        val listener=service();listener.onListenerConnected();drain(listener);scheduler.cancelAll()
        ListenerRecoveryJobService.schedule(app,"PROCESS_START");assertTrue(scheduler.allPendingJobs.isEmpty())
        val component=ComponentName(app,WhatsAppNotificationListener::class.java)
        shadowOf(app.getSystemService(NotificationManager::class.java)).setNotificationListenerAccessGranted(component,false)
        Settings.Secure.putString(app.contentResolver,"enabled_notification_listeners","")
        listener.onListenerDisconnected();assertTrue(scheduler.allPendingJobs.isEmpty())
    }
    @Test @Config(sdk=[24]) fun olderAndroidStillSchedulesPersistedOrdinaryRecoveryAndDelivery() {
        service().onNotificationPosted(notification())
        services.forEach {drain(it.get())};drainNetwork()
        assertEquals("API 24 callback must still queue a call: ${store.logs()}",1,store.pending().size)
        assertTrue(scheduler.allPendingJobs.single {it.service.className.endsWith("RetryJobService")}.isPersisted)
        ListenerRecoveryJobService.schedule(app,"TEST")
        assertTrue(scheduler.allPendingJobs.single {it.service.className.endsWith("ListenerRecoveryJobService")}.isPersisted)
    }
    @Test fun foregroundAckCannotMasqueradeAsBackgroundProof() {
        val activity=Robolectric.buildActivity(MainActivity::class.java).setup()
        try {
            receiver {service().onNotificationPosted(notification())};drainNetwork()
            assertEquals("",store.state("last_background_ack_at"))
            assertFalse(SystemCheck.read(app).backgroundAckVerified)
        } finally {activity.pause().stop().destroy()}
    }
    @Test fun backgroundProofFromEarlierProcessDoesNotProveRecreatedListener() {
        receiver {service().onNotificationPosted(notification())};drainNetwork()
        assertTrue(SystemCheck.read(app).backgroundAckVerified)
        BackgroundRuntime.start(app)
        assertFalse(SystemCheck.read(app).backgroundAckVerified)
        assertFalse(store.state("last_background_event_at").isBlank())
    }
    @Test fun exhaustedExpeditedQuotaFallsBackToPersistedOrdinaryJob() {
        shadowOf(scheduler).failExpeditedJob(true)
        store.capture("com.whatsapp.w4b","old","0591234567",1000)
        RetryJobService.schedule(app)
        val delivery=scheduler.allPendingJobs.single {it.service.className.endsWith("RetryJobService")}
        assertFalse(delivery.isExpedited);assertTrue(delivery.isPersisted)
        ListenerRecoveryJobService.schedule(app,"TEST")
        val recovery=scheduler.allPendingJobs.single {it.service.className.endsWith("ListenerRecoveryJobService")}
        assertFalse(recovery.isExpedited);assertTrue(recovery.isPersisted)
        assertEquals(1,store.pending().size)
    }
    @Test fun schedulingFailureIsRecordedAndDoesNotLoseQueuedCall() {
        shadowOf(scheduler).failOnJob(5050);shadowOf(scheduler).failOnJob(5051)
        store.capture("com.whatsapp.w4b","old","0591234567",1000)
        val original=store.pending().single()
        RetryJobService.schedule(app);ListenerRecoveryJobService.schedule(app,"TEST")
        assertTrue(scheduler.allPendingJobs.isEmpty())
        assertEquals(listOf(original),store.pending())
        assertTrue(store.logs().any {it.contains("JOB_SCHEDULE_FAILED")})
        assertTrue(store.logs().any {it.contains("LISTENER_RECOVERY_FAILED")})
    }
    @Test fun frameworkDestroyInvokesDisconnectBeforeFinalCleanupOnAndroid15() {
        val first=Robolectric.buildService(WhatsAppNotificationListener::class.java).create()
        first.destroy();drainNetwork()
        val logs=store.logs().asReversed()
        val disconnected=logs.indexOfFirst {it.contains(" LISTENER_DISCONNECTED\n")}
        val destroyed=logs.indexOfFirst {it.contains(" SERVICE_DESTROYED\n")}
        assertTrue(disconnected>=0);assertTrue(destroyed>disconnected)
        assertFalse(logs.any {it.contains("PIPELINE_EXECUTOR_REJECTED")})
    }
    @Test fun oldBackgroundAckDoesNotProveReplacementServiceInSameProcess() {
        receiver {service().onNotificationPosted(notification())};drainNetwork()
        assertTrue(SystemCheck.read(app).backgroundAckVerified)
        service()
        assertFalse(SystemCheck.read(app).backgroundAckVerified)
        assertFalse(store.state("last_tcp_delivery_at").isBlank())
    }
    @Test fun connectedActiveSnapshotDoesNotMasqueradeAsPostedBackgroundCallback() {
        val listener=service();drainNetwork()
        shadowOf(listener).addActiveNotification(notification())
        receiver {listener.onListenerConnected()};drainNetwork()
        assertFalse(store.state("last_tcp_delivery_at").isBlank())
        assertEquals("",store.state("last_notification_at"))
        assertFalse(SystemCheck.read(app).backgroundAckVerified)
    }
    @Test fun alreadyAcceptedWorkKeepsItsOldServiceGenerationWhenReplacementStarts() {
        val old=service();drainNetwork()
        val entered=java.util.concurrent.CountDownLatch(1)
        val release=java.util.concurrent.CountDownLatch(1)
        val executor=WhatsAppNotificationListener::class.java.getDeclaredField("events").apply {isAccessible=true}.get(old) as java.util.concurrent.ExecutorService
        executor.execute {entered.countDown();release.await(10,TimeUnit.SECONDS)}
        assertTrue(entered.await(5,TimeUnit.SECONDS))
        try {
            receiver {old.onNotificationPosted(notification());service();release.countDown()}
            drainNetwork()
            assertFalse("Old accepted work cannot certify a new listener",SystemCheck.read(app).backgroundAckVerified)
            assertFalse(store.state("last_tcp_delivery_at").isBlank())
        } finally {release.countDown()}
    }
}

