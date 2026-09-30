package com.maktab.calls

import android.app.Notification
import android.app.Person
import android.content.Intent
import android.content.ComponentName
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import java.util.concurrent.Executors

class WhatsAppNotificationListener : NotificationListenerService() {
    companion object {
        const val ACTION_WHATSAPP_EVENT = "com.maktab.calls.WHATSAPP_EVENT"
        const val EXTRA_CALLER = "caller"
        const val EXTRA_NUMBER = "number"
        private const val TAG = "MaktabCalls"
        private val whatsappPackages = setOf("com.whatsapp", "com.whatsapp.w4b")
    }

    // عدة مسارات مستقلة حتى لا تؤخر مكالمةٌ المكالمات التالية في وقت الضغط.
    private val callExecutor = Executors.newFixedThreadPool(4)
    private val callEvents = CallEventTracker()

    override fun onListenerConnected() {
        super.onListenerConnected()
        Log.i(TAG, "Notification listener connected")
        ContactIndex.refreshAsync(applicationContext)
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        Log.w(TAG, "Notification listener disconnected; requesting rebind")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            requestRebind(ComponentName(this, WhatsAppNotificationListener::class.java))
        }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null || sbn.packageName !in whatsappPackages) return
        val notification = sbn.notification ?: return
        val extras = notification.extras
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim().orEmpty()
        val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.trim().orEmpty()
        val subText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString()?.trim().orEmpty()
        val infoText = extras.getCharSequence(Notification.EXTRA_INFO_TEXT)?.toString()?.trim().orEmpty()
        val summaryText = extras.getCharSequence(Notification.EXTRA_SUMMARY_TEXT)?.toString()?.trim().orEmpty()
        val actionLabels = notification.actions?.mapNotNull { it.title?.toString() }.orEmpty()
        val visibleValues = listOf(title, text, bigText, subText, infoText, summaryText)
        val callScope = sbn.packageName
        val notificationKey = sbn.key
        if (looksLikeFinishedCall(visibleValues, actionLabels)) {
            callEvents.closeScope(callScope)
            return
        }
        if (!looksLikeIncomingCall(notification, visibleValues, actionLabels)) return

        // كل تحديثات الرنين للمفتاح نفسه تشترك في eventId واحد. المتتبع متزامن،
        // ولذلك لا يستطيع مساران متوازيان حجز الإرسال للمكالمة نفسها.
        val claim = callEvents.claim(callScope, notificationKey)
        if (!claim.shouldResolve) return

        val callerLabel = chooseCallerLabel(visibleValues)
        val visibleNumber = extractPhoneNumber(visibleValues.joinToString(" "))
        val metadataNumber = extractNumberFromMetadata(notification)
        val numberInNotification = visibleNumber.ifBlank { metadataNumber }
        val sourcePackage = sbn.packageName

        // البحث في جهات الاتصال خارج مسار إشعار النظام حتى لا يتأخر التقاط المكالمة.
        callExecutor.execute {
            var resolvedNumber = numberInNotification
            if (resolvedNumber.isBlank()) {
                // الفهرس المحلي يعيد النتيجة فورًا عادةً. المحاولات القصيرة تعالج لحظة تحديث الدليل فقط.
                for (attempt in 0 until 4) {
                    resolvedNumber = ContactIndex.lookup(applicationContext, callerLabel)
                    if (resolvedNumber.isNotBlank()) break
                    if (attempt < 3) Thread.sleep(120)
                }
            }
            val number = normalizePalestinianNumber(resolvedNumber)
            if (number.isBlank()) {
                // لا نرسل الاسم أبدًا، لكن نسمح لتحديث الإشعار التالي بإعادة محاولة استخراج الرقم.
                callEvents.releaseResolution(callScope, claim.eventId)
                Log.w(TAG, "No phone number found for the incoming WhatsApp call")
                return@execute
            }
            if (!callEvents.markSent(callScope, claim.eventId)) return@execute
            val caller = number
            val now = System.currentTimeMillis()
            NetworkSender.sendCall(applicationContext, claim.eventId, caller, number, "", sourcePackage, now)
            sendBroadcast(Intent(ACTION_WHATSAPP_EVENT).apply {
                setPackage(applicationContext.packageName)
                putExtra(EXTRA_CALLER, caller)
                putExtra(EXTRA_NUMBER, number)
            })
        }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        super.onNotificationRemoved(sbn)
        if (sbn == null || sbn.packageName !in whatsappPackages) return
        callEvents.closeNotification(sbn.packageName, sbn.key)
    }

    private fun looksLikeIncomingCall(notification: Notification, values: List<String>, actions: List<String>): Boolean {
        val allText = (values + actions).joinToString(" ").lowercase()
        val hasAnswer = actions.any {
            val value = it.lowercase()
            value.contains("answer") || value.contains("accept") ||
                value.contains("إجابة") || value.contains("قبول") || value == "رد"
        }
        val hasDecline = actions.any {
            val value = it.lowercase()
            value.contains("decline") || value.contains("reject") ||
                value.contains("رفض") || value.contains("تجاهل")
        }
        val hasIncomingPhrase = listOf(
            "incoming call", "incoming voice call", "incoming video call", "is calling",
            "voice call from", "video call from", "calling you",
            "مكالمة واردة", "مكالمة صوتية واردة", "مكالمة فيديو واردة", "يتصل بك",
            "مكالمة من", "مكالمة صوتية من", "مكالمة فيديو من", "اتصال وارد"
        ).any(allText::contains)
        // لا تكفي كلمة "رد" وحدها: واتساب يستخدمها أيضًا للرد على الرسائل.
        // لا نعتمد على CATEGORY_CALL وحدها لأنها تظهر أيضًا أثناء المكالمة الصادرة.
        // بعض نسخ WhatsApp Business/MIUI لا تعرض actions ولا CATEGORY_CALL
        // لمستمع الإشعارات، لكنها تعرض عبارة اتصال وارد مؤكدة. لذلك تكفي العبارة
        // الواضحة وحدها، ولا تكفي كلمات عامة مثل "رد" حتى لا نلتقط الرسائل.
        return hasIncomingPhrase || (hasAnswer && hasDecline)
    }

    private fun looksLikeFinishedCall(values: List<String>, actions: List<String>): Boolean {
        val allText = (values + actions).joinToString(" ").lowercase()
        return listOf(
            "missed call", "call ended", "outgoing call", "ongoing call",
            "مكالمة فائتة", "انتهت المكالمة", "مكالمة صادرة", "مكالمة جارية"
        ).any(allText::contains)
    }

    private fun chooseCallerLabel(values: List<String>): String {
        val genericTerms = listOf("whatsapp", "incoming", "voice call", "video call", "calling", "مكالمة", "واتساب", "واردة", "صوتية", "فيديو", "يتصل بك")
        val directLabel = values.firstOrNull { value ->
            value.isNotBlank() && genericTerms.none { term -> value.lowercase().contains(term) }
        }.orEmpty()
        if (directLabel.isNotBlank()) return directLabel

        val phrasePatterns = listOf(
            Regex("(?i)^(.+?)\\s+is calling.*$"),
            Regex("(?i)^incoming(?: voice| video)? call from\\s+(.+)$"),
            Regex("^(.+?)\\s+يتصل بك.*$"),
            Regex("^مكالمة(?: صوتية| فيديو)?(?: واردة)? من\\s+(.+)$")
        )
        for (value in values) {
            for (pattern in phrasePatterns) {
                val match = pattern.find(value.trim()) ?: continue
                val candidate = match.groupValues.getOrNull(1)?.trim().orEmpty()
                if (candidate.isNotBlank()) return candidate
            }
        }
        return ""
    }

    private fun extractPhoneNumber(value: String): String {
        val candidate = Regex("(?:\\+|00)?[0-9][0-9 ()-]{6,18}[0-9]").find(value)?.value.orEmpty()
        val normalized = candidate.replace(Regex("[^0-9+]"), "")
        return if (normalized.count(Char::isDigit) >= 7) normalized else ""
    }

    private fun extractNumberFromMetadata(notification: Notification): String {
        val candidates = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            notification.shortcutId?.let(candidates::add)
        }
        notification.extras.getStringArray(Notification.EXTRA_PEOPLE)?.let(candidates::addAll)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            @Suppress("DEPRECATION")
            notification.extras.getParcelableArrayList<Person>(Notification.EXTRA_PEOPLE_LIST)?.forEach { person ->
                person.uri?.let(candidates::add)
                person.key?.let(candidates::add)
                person.name?.toString()?.let(candidates::add)
            }
            @Suppress("DEPRECATION")
            (notification.extras.getParcelable("android.callPerson") as? Person)?.let { person ->
                person.uri?.let(candidates::add)
                person.key?.let(candidates::add)
                person.name?.toString()?.let(candidates::add)
            }
        }
        return candidates.asSequence().map(::extractPhoneNumber).firstOrNull { it.isNotBlank() }.orEmpty()
    }

    private fun normalizePalestinianNumber(value: String): String {
        var digits = value.filter(Char::isDigit)
        digits = when {
            digits.startsWith("00970") || digits.startsWith("00972") -> digits.drop(5)
            digits.startsWith("970") || digits.startsWith("972") -> digits.drop(3)
            else -> digits
        }
        if (digits.length == 9 && !digits.startsWith("0")) digits = "0$digits"
        return digits
    }

}
