package com.maktab.calls

import android.Manifest
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.service.notification.NotificationListenerService
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver

@Composable
internal fun OfficeCallsEntry(activity: MainActivity) {
    var revision by remember { mutableIntStateOf(0) }
    val prefs = remember { activity.getSharedPreferences(PermissionSetup.PREFS, Context.MODE_PRIVATE) }
    // Reading system truth after a result matters more than the callback's granted boolean.
    val contacts = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { revision++ }
    @Suppress("UNUSED_VARIABLE") val current = revision
    val state = PermissionSetup.read(activity)
    var openError by remember { mutableStateOf("") }
    fun refresh() { revision++ }
    fun open(intents: List<Intent>) {
        openError = if (PermissionSetup.openSettings(activity, intents)) "" else "تعذر فتح الإعدادات تلقائياً. افتح إعدادات الهاتف ثم التطبيقات ← مكالمات المكتب."
    }
    fun rebind() {
        if (PermissionSetup.notificationAccess(activity) && !WhatsAppNotificationListener.connected)
            runCatching { NotificationListenerService.requestRebind(ComponentName(activity, WhatsAppNotificationListener::class.java)) }
                .onFailure { openError = "تعذر طلب اتصال المراقبة. أعد فتح إعداد الوصول إلى الإشعارات، ثم ارجع إلى التطبيق." }
    }
    DisposableEffect(activity) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) { refresh() } }
        activity.lifecycle.addObserver(observer)
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) { refresh() }
        }
        ContextCompat.registerReceiver(activity, receiver, IntentFilter().apply {
            addAction(WhatsAppNotificationListener.ACTION_LISTENER_STATE)
            addAction(NetworkSender.ACTION_SEND_STATUS)
            addAction("com.maktab.calls.DIAGNOSTICS_CHANGED")
        }, ContextCompat.RECEIVER_NOT_EXPORTED)
        // Permission results and ON_RESUME above refresh system truth using public APIs.
        // PackageManager.OnPermissionsChangedListener is not part of the public Android SDK.
        // A permission already enabled during upgrade may need an official rebind on first entry.
        // Automatic recovery belongs to Application/listener/JobService, not UI entry.
        onDispose {
            activity.lifecycle.removeObserver(observer)
            activity.unregisterReceiver(receiver)
        }
    }
    if (PermissionSetup.completed(activity) && state.ready) {
        if(prefs.getBoolean(SystemCheck.REVIEWED,false)) OfficeCallsScreen(activity)
        else SystemCheckFlow(activity,onContinue={prefs.edit().putBoolean(SystemCheck.REVIEWED,true).apply();refresh()},
            onRepairPermissions={prefs.edit().putBoolean(PermissionSetup.COMPLETED,false).apply();refresh()})
    }
    else PermissionSetupScreen(state, error = openError,
        restrictedHelp = Build.VERSION.SDK_INT >= 33, manufacturer = Build.MANUFACTURER,
        onContacts = {
            val requested = prefs.getBoolean(PermissionSetup.CONTACTS_REQUESTED, false)
            if (requested && !activity.shouldShowRequestPermissionRationale(Manifest.permission.READ_CONTACTS)) open(listOf(PermissionSetup.appInfo(activity)))
            else {
                prefs.edit().putBoolean(PermissionSetup.CONTACTS_REQUESTED, true).apply()
                contacts.launch(Manifest.permission.READ_CONTACTS)
            }
        },
        onContactsSettings = { open(listOf(PermissionSetup.appInfo(activity))) },
        onNotification = { open(PermissionSetup.notificationIntents(activity)) },
        onAppInfo = { open(listOf(PermissionSetup.appInfo(activity))) },
        onBattery = { open(PermissionSetup.batteryIntents()) },
        onBackground = { open(PermissionSetup.backgroundIntents(activity, false)) },
        onAutoStart = { open(PermissionSetup.backgroundIntents(activity, true)) },
        onBackgroundReviewed = { PermissionSetup.reviewed(activity, PermissionSetup.BACKGROUND_REVIEWED, it); refresh() },
        onAutoStartReviewed = { PermissionSetup.reviewed(activity, PermissionSetup.AUTOSTART_REVIEWED, it); refresh() },
        onRefresh = { refresh(); rebind() },
        onEnter = { if (PermissionSetup.finish(activity)) refresh() else { openError = "تغيرت حالة إعداد ضروري. أكمل العناصر التي تحتاج تفعيل ثم حاول مجدداً."; refresh() } })
}

@Composable
internal fun PermissionSetupScreen(
    state: PermissionSetup.Snapshot, error: String = "", restrictedHelp: Boolean = true, manufacturer: String = Build.MANUFACTURER,
    onContacts: () -> Unit = {}, onContactsSettings: () -> Unit = {}, onNotification: () -> Unit = {}, onAppInfo: () -> Unit = {},
    onBattery: () -> Unit = {}, onBackground: () -> Unit = {}, onAutoStart: () -> Unit = {},
    onBackgroundReviewed: (Boolean) -> Unit = {}, onAutoStartReviewed: (Boolean) -> Unit = {}, onRefresh: () -> Unit = {}, onEnter: () -> Unit = {}
) {
    var showRestrictedHelp by remember {mutableStateOf(false)}
    val next = when {
        !state.contacts -> "فعّل جهات الاتصال للانتقال إلى الخطوة التالية."
        !state.notificationEnabled -> "فعّل الوصول إلى الإشعارات ثم ارجع إلى التطبيق."
        !state.listenerConnected -> "الوصول مفعّل، لكن المراقبة لم تتصل بعد. أعد التحقق أو راجع إعداد الإشعارات."
        !state.batteryExempt -> "استثنِ مكالمات المكتب من تحسين البطارية."
        state.backgroundRestricted == true -> "أزل تقييد التشغيل في الخلفية من إعدادات التطبيق."
        !state.backgroundReviewed -> "راجع إعدادات الخلفية الخاصة بجهازك."
        !state.internetDeclared -> "تعذر التحقق من إعداد الشبكة الداخلي. أعد التحقق؛ لا يحتاج إذناً من المستخدم."
        !state.autoStartReviewed -> "راجع إعداد التشغيل التلقائي قبل الدخول."
        state.readErrors.isNotEmpty() -> "تعذر قراءة بعض إعدادات Android. أعد التحقق."
        else -> "اكتملت الإعدادات الضرورية. يمكنك الدخول الآن."
    }
    Surface(Modifier.fillMaxSize().testTag("setup-screen"), color = MaterialTheme.colorScheme.background) {
        BoxWithConstraints(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
        val compact = maxHeight < 480.dp || LocalDensity.current.fontScale > 1.5f
        Column(Modifier.fillMaxSize().then(if (compact) Modifier.verticalScroll(rememberScrollState()) else Modifier), horizontalAlignment = Alignment.CenterHorizontally) {
            Column((if (compact) Modifier else Modifier.weight(1f)).widthIn(max = 640.dp).fillMaxWidth()
                .then(if (compact) Modifier else Modifier.verticalScroll(rememberScrollState())).padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("إعداد OfficeCalls", fontSize = 28.sp, fontWeight = FontWeight.Bold)
                Text("ستتحقق هذه الشاشة من جاهزية قراءة مكالمات WhatsApp Business والعمل في الخلفية. تُفحص الإعدادات تلقائياً عند العودة من إعدادات الهاتف.", fontSize = 16.sp)
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
                    Text(next, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSecondaryContainer)
                }
                SetupStep("1", "جهات الاتصال", state.contacts, "للعثور على رقم المتصل عندما يعرض WhatsApp الاسم فقط. لن يُرسل دفتر جهات الاتصال.") {
                    if (!state.contacts) {
                        Button(onContacts, Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("setup-contacts")) { Text("تفعيل جهات الاتصال") }
                        TextButton(onContactsSettings, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("فتح إعدادات إذن جهات الاتصال") }
                    }
                }
                SetupStep("2", "الوصول إلى الإشعارات", state.notificationReady,
                    "مطلوب السماح لمكالمات المكتب بالوصول إلى الإشعارات لقراءة مكالمات WhatsApp Business.") {
                    Text(if (!state.notificationEnabled) "✕ الوصول غير مفعّل" else "✓ الوصول مفعّل", fontWeight = FontWeight.Medium)
                    Text(if (state.listenerConnected && state.notificationEnabled) "✓ خدمة مراقبة المكالمات متصلة فعلياً" else "✕ خدمة مراقبة المكالمات غير متصلة بعد")
                    if (!state.notificationReady) Button(onNotification, Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("setup-notifications"), enabled = state.contacts) { Text("تفعيل الوصول إلى الإشعارات") }
                    if(restrictedHelp && !state.notificationEnabled) TextButton({showRestrictedHelp=!showRestrictedHelp},
                        Modifier.fillMaxWidth().heightIn(min=48.dp).testTag("setup-restricted-help")) {Text("تظهر رسالة إعداد محظور؟")}
                    if (restrictedHelp && !state.notificationEnabled && showRestrictedHelp) {
                        HorizontalDivider()
                        Text("هل يظهر «يتحكم فيه إعداد محظور»؟", fontWeight = FontWeight.Bold)
                        Text("إذا عرض Android أن الوصول محظور: افتح معلومات التطبيق ← قائمة ⋮ ← السماح بالإعدادات المحظورة، ثم أكّد طلب Android وارجع لتفعيل الوصول إلى الإشعارات. قد تختلف الأسماء على TECNO وXiaomi. هذه الخطوة مطلوبة فقط إذا ظهرت رسالة الحظر.")
                        Text("إذا لم يظهر الخيار، حاول تفعيل الوصول أولاً لعرض رسالة الحظر ثم راجع معلومات التطبيق. إذا كان الهاتف مُداراً أو بقي الخيار محظوراً، راجع مسؤول الجهاز. التطبيق لا يستطيع رفع هذا الحظر بنفسه.")
                        OutlinedButton(onAppInfo, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("فتح معلومات التطبيق") }
                    }
                }
                SetupStep("3", "استثناء تحسين البطارية", state.batteryExempt,
                    "مطلوب لتحسين استمرار مراقبة المكالمات بالخلفية. اختر مكالمات المكتب من قائمة تحسين البطارية، ثم فعّل الاستثناء حسب الخيارات المتاحة.") {
                    if (!state.batteryExempt) Button(onBattery, Modifier.fillMaxWidth().heightIn(min = 48.dp), enabled = state.criticalReady) { Text("فتح إعداد استثناء البطارية") }
                }
                SetupStep("4", "التشغيل في الخلفية", state.backgroundRestricted != true && state.backgroundReviewed,
                    "الجهاز: $manufacturer. راجع قيود الطاقة والخلفية الخاصة بالشركة المصنعة.",
                    customStatus = if (state.backgroundRestricted == true) "✕ Android يقيّد التشغيل في الخلفية" else if (state.backgroundReviewed) "✓ تمت المراجعة اليدوية" else "✕ تحتاج مراجعة") {
                    Text(when (state.backgroundRestricted) { true -> "أزل تقييد الخلفية من إعدادات التطبيق."; false -> "✓ لا يوجد تقييد خلفية حسب Android. قيود الشركة المصنعة لا يمكن التحقق منها بالكامل."; null -> "لا يوفر هذا الإصدار قياساً عاماً لهذه القيود. راجعها يدوياً." })
                    OutlinedButton(onBackground, Modifier.fillMaxWidth().heightIn(min = 48.dp), enabled = state.criticalReady && state.batteryExempt) { Text("فتح إعدادات الخلفية / البطارية") }
                    ReviewCheck("راجعت السماح لمكالمات المكتب بالعمل في الخلفية", state.backgroundReviewed,
                        state.criticalReady && state.batteryExempt && state.backgroundRestricted != true, onBackgroundReviewed, "setup-background-review")
                }
                SetupStep("5", "الشبكة", state.internetDeclared,
                    if (state.internetDeclared) "INTERNET موجود في التطبيق؛ لا يحتاج Android طلب إذن أثناء التشغيل. إعداد Receiver IP والمنفذ 5050 متاح داخل التطبيق." else "تعذر التحقق من INTERNET في التطبيق. أعد التحقق؛ لا يوجد إذن شبكة يُطلب أثناء التشغيل.") {
                    Text("توفر اتصال الشبكة يُفحص في شاشة اختبار النظام. عدم وجود شبكة الآن لا يغيّر صلاحية INTERNET ولا يمنع حفظ المكالمات لإعادة المحاولة.")
                }
                SetupStep("6", "التشغيل التلقائي بعد إعادة التشغيل", state.autoStartReviewed,
                    "يستقبل التطبيق إعادة تشغيل Android. على TECNO / Xiaomi وغيرها، قد تحتاج السماح بالتشغيل التلقائي من إعدادات الشركة المصنعة.",
                    customStatus = if (state.autoStartReviewed) "✓ تمت المراجعة اليدوية — التفعيل غير قابل للتحقق" else "✕ تحتاج مراجعة يدوية") {
                    Text("لا يوفر Android طريقة عامة لمنح أو تأكيد Auto-start للشركة المصنعة. علامة المراجعة تؤكد أنك راجعت الإعداد فقط.")
                    if (manufacturer.lowercase(java.util.Locale.ROOT) in setOf("tecno", "infinix", "itel")) Text("على أجهزة TECNO، راجع Phone Master أو إدارة التطبيقات ثم التشغيل التلقائي / البطارية؛ قد تختلف القوائم حسب إصدار HiOS.")
                    OutlinedButton(onAutoStart, Modifier.fillMaxWidth().heightIn(min = 48.dp), enabled = state.criticalReady && state.batteryExempt && state.backgroundReviewed && state.internetDeclared) { Text("فتح إعدادات التشغيل التلقائي") }
                    ReviewCheck("راجعت إعداد التشغيل التلقائي على هذا الجهاز", state.autoStartReviewed,
                        state.criticalReady && state.batteryExempt && state.backgroundRestricted != true && state.backgroundReviewed && state.internetDeclared, onAutoStartReviewed, "setup-autostart-review")
                }
                if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
                if (state.readErrors.isNotEmpty()) Text("تعذر التحقق من بعض إعدادات الجهاز. أعد المحاولة أو راجع إعدادات التطبيق.", color = MaterialTheme.colorScheme.error)
                Text("لا يحتاج التطبيق إذن SMS أو الهاتف أو الموقع أو الكاميرا أو الميكروفون أو نشر الإشعارات.")
            }
            Surface(shadowElevation = 4.dp) {
                Column(Modifier.widthIn(max = 640.dp).fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (!state.ready) Text(next, style = MaterialTheme.typography.bodyMedium)
                    Button(onEnter, Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("setup-enter"), enabled = state.ready) { Text("الدخول إلى التطبيق") }
                    TextButton(onRefresh, Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("setup-refresh")) { Text("إعادة التحقق من الإعدادات") }
                }
            }
        }
        }
    }
}

@Composable
private fun SetupStep(number: String, title: String, enabled: Boolean, description: String, customStatus: String? = null, content: @Composable ColumnScope.() -> Unit) {
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("$number. $title", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(customStatus ?: if (enabled) "✓ مفعلة" else "✕ تحتاج تفعيل", color = if (enabled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error)
            Text(description, style = MaterialTheme.typography.bodyLarge)
            content()
        }
    }
}
@Composable
private fun ReviewCheck(label: String, checked: Boolean, enabled: Boolean, change: (Boolean) -> Unit, tag: String) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag(tag).toggleable(checked, enabled = enabled, role = Role.Checkbox, onValueChange = change), verticalAlignment = Alignment.CenterVertically) {
        Checkbox(checked, null, enabled = enabled, modifier = Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp))
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
    }
}
