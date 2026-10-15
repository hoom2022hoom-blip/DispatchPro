package com.maktab.calls

import android.app.Notification
import android.content.ComponentName
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

class WhatsAppNotificationListener : NotificationCaptureService() {
    companion object {
        const val ACTION_WHATSAPP_EVENT = "com.maktab.calls.WHATSAPP_EVENT"
        const val ACTION_LISTENER_STATE = "com.maktab.calls.LISTENER_STATE"
        const val EXTRA_CALLER = "caller"
        const val EXTRA_NUMBER = "number"
        @Volatile var connected = false
            private set
    }
    private val events = Executors.newSingleThreadExecutor()
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) { NetworkSender.resume(applicationContext) }
    }
    private var registered = false
    private var listenerGeneration = ""
    @Volatile private var destroying = false
    override fun onCreate() {
        super.onCreate()
        listenerGeneration = BackgroundRuntime.serviceCreated(applicationContext)
        connected = false
        broadcastConnection()
        // Application and Service initialization do not require MainActivity.
        NetworkSender.resume(applicationContext)
    }
    private fun dispatch(action: () -> Unit) {
        if (destroying) { BackgroundRuntime.record(applicationContext,"CALLBACK_AFTER_DESTROY");return }
        try { events.execute { runCatching(action).onFailure {
            CallStore.get(applicationContext).log(status="PIPELINE_FAILED",detail="error=${it.javaClass.simpleName}; listenerConnected=$connected")
        } } } catch (_: RejectedExecutionException) {
            BackgroundRuntime.record(applicationContext,"PIPELINE_EXECUTOR_REJECTED")
            ListenerRecoveryJobService.schedule(applicationContext,"EXECUTOR_REJECTED")
        }
    }
    override fun onListenerConnected() {
        super.onListenerConnected()
        if (destroying || CallStore.get(applicationContext).state("listener_generation") != listenerGeneration) return
        connected = true
        broadcastConnection()
        val active = runCatching {activeNotifications.orEmpty().filter { it.packageName in CallNotificationRules.packages }}.getOrNull()
        BackgroundRuntime.record(applicationContext,"LISTENER_CONNECTED")
        dispatch {
            if(active != null) {
                CallStore.get(this).reconcile(active.map { it.key }.toSet())
                active.forEach {process(it)}
            } else CallStore.get(this).log(status="LIFECYCLE_SNAPSHOT_UNAVAILABLE",detail="stage=LISTENER_CONNECTED; existing sessions retained")
            NetworkSender.resume(this)
        }
        if (!registered) {
            runCatching { getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(networkCallback) }
                .onSuccess { registered = true }
        }
    }
    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        if (CallStore.get(applicationContext).state("listener_generation") == listenerGeneration) connected = false
        broadcastConnection()
        val access=PermissionSetup.notificationAccess(this)
        // Android calls this virtual callback inside super.onDestroy(). Never submit it to
        // an executor that onDestroy may already have shut down (2.5.0 crashed here).
        BackgroundRuntime.record(applicationContext,"LISTENER_DISCONNECTED","notificationAccess=$access; destroying=$destroying")
        CallStore.get(applicationContext).log(status="LISTENER_NOT_CONNECTED",detail="notificationAccess=$access; destroying=$destroying")
        if(!access) CallStore.get(applicationContext).log(status="NOTIFICATION_ACCESS_DISABLED",detail="stage=LISTENER_DISCONNECTED")
        if(access) ListenerRecoveryJobService.schedule(applicationContext,"LISTENER_DISCONNECTED")
        // One official rebind attempt per disconnect, never a polling loop.
        if(access && !destroying) runCatching { requestRebind(ComponentName(this, WhatsAppNotificationListener::class.java)) }
            .onSuccess {BackgroundRuntime.record(applicationContext,"LISTENER_REBIND_REQUESTED","source=LISTENER_DISCONNECTED")}
            .onFailure {BackgroundRuntime.record(applicationContext,"LISTENER_REBIND_FAILED","source=LISTENER_DISCONNECTED; error=${it.javaClass.simpleName}")}
    }
    override fun onDestroy() {
        destroying = true
        try {
            // Framework first: it synchronously invokes our onListenerDisconnected().
            super.onDestroy()
        } finally {
            if (CallStore.get(applicationContext).state("listener_generation") == listenerGeneration) connected = false
            broadcastConnection()
            if (registered) runCatching { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(networkCallback) }
            registered = false
            BackgroundRuntime.record(applicationContext,"SERVICE_DESTROYED")
            events.shutdown() // Already accepted work can finish; late callbacks are guarded.
            ListenerRecoveryJobService.schedule(applicationContext,"SERVICE_DESTROYED")
        }
    }
    override fun onTaskRemoved(rootIntent: Intent?) {
        BackgroundRuntime.record(applicationContext,"TASK_REMOVED")
        super.onTaskRemoved(rootIntent)
    }
    private fun broadcastConnection() {
        sendBroadcast(Intent(ACTION_LISTENER_STATE).setPackage(packageName))
    }
    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null || sbn.packageName !in CallNotificationRules.packages) return
        val background = !BackgroundRuntime.foreground
        // Durable callback entry BEFORE enqueue: distinguish missing callback from stalled work.
        BackgroundRuntime.record(applicationContext,if(background) "NOTIFICATION_RECEIVED_BACKGROUND" else "NOTIFICATION_RECEIVED_FOREGROUND","id=${sbn.id}",sbn.packageName)
        dispatch { process(sbn,background) }
    }
    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        if (sbn == null || sbn.packageName !in CallNotificationRules.packages) return
        BackgroundRuntime.record(applicationContext,"NOTIFICATION_REMOVED","id=${sbn.id}",sbn.packageName)
        val active = runCatching { activeNotifications.orEmpty().filter { it.packageName == sbn.packageName && (it.key != sbn.key || it.postTime > sbn.postTime) } }.getOrNull()
        dispatch { processRemoval(sbn, active) }
    }
    internal fun processRemoval(sbn: StatusBarNotification, active: List<StatusBarNotification>?) {
        // The active snapshot is taken on the callback thread, before later calls can enter it.
        active?.filter { it.packageName == sbn.packageName }?.forEach {process(it)}
        if (active?.any { it.key == sbn.key } != true) CallStore.get(this).removed(sbn.key)
        if (active == null) CallStore.get(this).log(sbn.packageName, status = "LIFECYCLE_SNAPSHOT_UNAVAILABLE", detail = "id=${sbn.id}; removal applied to tracked alias")
    }
    private fun process(sbn: StatusBarNotification, background: Boolean = false) {
        BackgroundRuntime.record(applicationContext,"NOTIFICATION_PROCESSING","id=${sbn.id}",sbn.packageName)
        runCatching { processSafely(sbn,background) }.onFailure {
            CallStore.get(this).log(sbn.packageName, status = "FAILED", detail = "NOTIFICATION_PARSE_ERROR:${it.javaClass.simpleName}")
            NetworkSender.resume(applicationContext) // A checkpointed call must still reach Windows after parsing fails.
        }
    }
    internal fun processSafely(sbn: StatusBarNotification, background: Boolean = false) {
        val notification = sbn.notification ?: return
        if (notification.category == Notification.CATEGORY_MESSAGE) return
        val versions = listOfNotNull(notification, notification.publicVersion)
        // Message notifications cannot masquerade as calls. Current MessagingStyle data on an
        // independently verified call is readable; history and the local user are excluded by the extractor.
        val callVersions = versions.filterNot { it.category == Notification.CATEGORY_MESSAGE }
        if (callVersions.isEmpty()) return
        val values = callVersions.flatMap { n ->
        val fields = listOf(Notification.EXTRA_TITLE, Notification.EXTRA_TEXT, Notification.EXTRA_SUB_TEXT,
                Notification.EXTRA_BIG_TEXT, Notification.EXTRA_INFO_TEXT, Notification.EXTRA_SUMMARY_TEXT, Notification.EXTRA_TITLE_BIG)
            fields.mapNotNull { n.extras.getCharSequence(it)?.toString()?.trim() } +
                n.extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES).orEmpty().map { it.toString() } + listOfNotNull(n.tickerText?.toString())
        }
        val actions = callVersions.flatMap { it.actions.orEmpty().mapNotNull { action -> action.title?.toString() } }
        // CallStyle exists since API 31; the public constant was exposed on API 34.
        val type = if (Build.VERSION.SDK_INT >= 31) callVersions.map { it.extras.getInt("android.callType", 0) }.firstOrNull { it != 0 } ?: 0 else 0
        val store = CallStore.get(this)
        val sessions = CallSessionManager(this)
        if (CallNotificationRules.finished(values, type)) {
            store.ended(sbn.key, sbn.packageName)
            return
        }
        val summary = notification.flags and Notification.FLAG_GROUP_SUMMARY != 0
        val now = System.currentTimeMillis()
        val incoming = CallNotificationRules.incoming(values, actions, type)
        if (CallNotificationRules.outgoing(values)) return
        // Once incoming direction is established, category=call / callPerson updates can
        // enrich the SAME session without repeating the incoming phrase or answer buttons.
        // No standalone outgoing/ongoing/message event can acquire an incoming identity.
        if (!incoming) {
            val callUpdate = callVersions.any { it.category == Notification.CATEGORY_CALL || it.extras.containsKey("android.callPerson") } || CallNotificationRules.ongoing(values,type)
            if (!callUpdate || sessions.observe(sbn.packageName, sbn.key, now, summary, "", create = false, name="",group=if(sbn.isGroup) sbn.groupKey else "") == null) {
                if (callVersions.any { it.category == Notification.CATEGORY_CALL || it.extras.containsKey("android.callPerson") }) {
                    store.log(sbn.packageName, status = "NO_CALL_NOTIFICATION", detail = "reason=NO_VERIFIED_INCOMING_SESSION; package=${sbn.packageName}; id=${sbn.id}; category=${notification.category}; channel=${notification.channelIdSafe()}; callType=$type")
                    store.log(sbn.packageName,status="CALL_IGNORED",detail="reason=NO_VERIFIED_INCOMING_SESSION; id=${sbn.id}")
                }
                return
            }
            // A verified incoming session may expose its phone only after answering. Resolve that
            // update too; a standalone ongoing/outgoing notification can never create a call event.
        }
        val eventId = sessions.observe(sbn.packageName, sbn.key, now, summary, "", create=incoming, name="",group=if(sbn.isGroup) sbn.groupKey else "",eventTime=CallTime.incoming(sbn.postTime,now)) ?: return
        val names = NotificationCallIdentity.names(callVersions,values)
        sessions.enrich(eventId,names,now)
        // Durable event before Contacts/provider parsing; an exception still leaves a visible call.
        store.checkpoint(eventId)
        val previousNames = store.session(eventId)?.candidateIdentities.orEmpty()
        val identity = PhoneExtractor.resolve(callVersions, values, this, previousNames)
        // Failed name matching includes the one bounded caller label and up to three candidate names,
        // locally only. Successful calls and network payloads never include contact names.
        store.log(sbn.packageName, status = "NOTIFICATION_DETECTED", detail =
            "id=${sbn.id}; category=${notification.category}; channel=${notification.channelIdSafe()}; group=${sbn.isGroup}; summary=${notification.flags and Notification.FLAG_GROUP_SUMMARY != 0}; fullscreen=${notification.fullScreenIntent != null}; callType=$type; public=${notification.publicVersion != null}; fields=${values.count { it.isNotBlank() }}")
        store.log(sbn.packageName, status = "CALL_METADATA", detail = NotificationCallIdentity.structure(callVersions))
        val detail = "sessionId=$eventId; eventId=$eventId; package=${sbn.packageName}; id=${sbn.id}; key=${sbn.key.take(140)}; category=${notification.category}; channel=${notification.channelIdSafe()}; foreground=${!background}; listenerConnected=$connected; source=${identity.source}; rawCallerName=\"${ContactNameNormalizer.diagnostic(names.firstOrNull().orEmpty())}\"; normalizedCallerName=\"${ContactNameNormalizer.diagnostic(ContactIndex.matchingKey(names.firstOrNull().orEmpty()))}\"; ${identity.detail}"
        if(identity.detail.contains("personPresent=true")) store.log(sbn.packageName,status="PERSON_FOUND",detail="sessionId=$eventId; source=${identity.source}")
        if(identity.source == "PHONE_FROM_CONTACTS" || identity.source.startsWith("CONTACT"))
            store.log(sbn.packageName,status="CONTACT_LOOKUP",detail="sessionId=$eventId; ${identity.detail}")
        if (identity.ambiguous || identity.phone.isBlank()) {
            val stop=identity.detail.substringAfter("stop=","").substringBefore(';').trim()
            store.log(sbn.packageName, status = if (identity.ambiguous) "AMBIGUOUS_CONTACT" else stop.ifBlank {identity.source}, detail = detail)
            store.log(sbn.packageName, status = "CONTACT_NAME_ONLY", detail = detail)
            store.log(sbn.packageName, status = "EXTRACTION_FAILED", detail = detail)
            store.publish(eventId, source=identity.source, reason=if(identity.ambiguous) "AMBIGUOUS_IDENTITY" else identity.source.ifBlank {"PHONE_NOT_EXPOSED"})
            BackgroundRuntime.queued(applicationContext,eventId,background,listenerGeneration)
            NetworkSender.resume(this)
            sendBroadcast(Intent(ACTION_WHATSAPP_EVENT).setPackage(packageName))
            return
        }
        val number = PhoneNormalizer.identity(identity.phone)
        val parsed = PhoneNormalizer.parse(number)
        store.metadata(eventId,number,identity.source,if(type==2) "ONGOING" else "RINGING")
        store.log(sbn.packageName,status="PHONE_PARSE",detail="eventId=$eventId; reason=${parsed?.reason ?: "INVALID_PHONE"}; e164Verified=${parsed?.e164?.isNotBlank() == true}")
        DiagnosticsManager(this).record("PHONE_NORMALIZED","sessionId=$eventId; source=${identity.source}",sbn.packageName,number)
        store.log(sbn.packageName,number,"PHONE_FOUND",detail="sessionId=$eventId; source=${identity.source}")
        if(identity.source == "PHONE_FROM_CONTACTS") {
            store.log(sbn.packageName,number,if(identity.detail.contains("matchingStage=EXACT")) "CONTACT_EXACT_MATCH" else "CONTACT_SAFE_MATCH",detail="sessionId=$eventId")
            store.log(sbn.packageName,number,"PHONE_FROM_CONTACT",detail="sessionId=$eventId")
        } else {
            val field=identity.detail.substringAfter("field=","").substringBefore(';')
            val stage=when {
                field.contains("callPerson") || field.contains("people.list") || field.contains("sender_person") -> "PHONE_FROM_PERSON"
                field.contains("ticker") || field=="renderedText" || listOf("android.title","android.text","android.subText","android.bigText","android.infoText","android.summaryText").any(field::contains) -> "PHONE_FROM_TEXT"
                else -> "PHONE_FROM_EXTRAS"
            }
            if(stage != identity.source) store.log(sbn.packageName,number,stage,detail="sessionId=$eventId; field=$field")
        }
        BackgroundRuntime.record(applicationContext,"PHONE_EXTRACTED","eventId=$eventId; source=${identity.source}",sbn.packageName)
        if (identity.source == "PHONE_FROM_CONTACTS") store.log(sbn.packageName, number, "CONTACT_RESOLVED", "normalizedPhone=$number; ${identity.detail}")
        val extractionStatus=identity.detail.substringAfter("extractionSource=","").substringBefore(';').trim().ifBlank {identity.source}
        store.log(sbn.packageName, number, extractionStatus, detail = detail)
        if (sessions.capture(sbn.packageName, sbn.key, number, System.currentTimeMillis(), summary)) {
            BackgroundRuntime.queued(applicationContext,eventId!!,background,listenerGeneration)
            NetworkSender.resume(this)
            sendBroadcast(Intent(ACTION_WHATSAPP_EVENT).setPackage(packageName).putExtra(EXTRA_CALLER, parsed?.display.orEmpty()).putExtra(EXTRA_NUMBER, parsed?.display.orEmpty()))
        }
    }
    private fun Notification.channelIdSafe(): String = if (Build.VERSION.SDK_INT >= 26) channelId.orEmpty().take(60) else "legacy"
}
