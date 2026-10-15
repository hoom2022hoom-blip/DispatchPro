package com.maktab.calls

import android.content.Context
import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp

@Composable
internal fun SystemCheckFlow(activity: MainActivity, onContinue: (() -> Unit)? = null, onRepairPermissions: () -> Unit = {}) {
    val prefs=remember {activity.getSharedPreferences(NetworkSender.PREFS_NAME,Context.MODE_PRIVATE)}
    var host by remember {mutableStateOf(prefs.getString(NetworkSender.KEY_HOST,"").orEmpty())}
    var port by remember {mutableStateOf(prefs.getInt(NetworkSender.KEY_PORT,5050).toString())}
    var revision by remember {mutableIntStateOf(0)}
    var message by remember {mutableStateOf("")}
    @Suppress("UNUSED_VARIABLE") val observed=revision
    val snapshot=SystemCheck.read(activity)
    val dirty=false
    SystemCheckScreen(snapshot,host,port,dirty,message,
        onHost={host=it},onPort={port=it.filter(Char::isDigit).take(5)},onSave={},
        onRefresh={revision++; if(PermissionSetup.notificationAccess(activity)) runCatching {
            android.service.notification.NotificationListenerService.requestRebind(android.content.ComponentName(activity,WhatsAppNotificationListener::class.java))
        }}, onProbe={NetworkSender.sendTest(activity)},
        onFix={key -> when(key) {
            "contacts","notification","listener","background" -> onRepairPermissions()
            "business" -> { PermissionSetup.openSettings(activity,listOf(Intent(Settings.ACTION_APPLICATION_SETTINGS)));message="ثبّت واتساب أو واتساب بزنس إذا لم يكن موجوداً، ثم أعد الفحص." }
        }}, onContinue=onContinue)
}

@Composable
internal fun SystemCheckScreen(state: SystemCheck.Snapshot, host: String, port: String, dirty: Boolean=false,
    message: String="", onHost:(String)->Unit={}, onPort:(String)->Unit={}, onSave:()->Unit={}, onRefresh:()->Unit={},
    onProbe:()->Unit={}, onFix:(String)->Unit={}, onContinue:(()->Unit)?=null) {
    Surface(color=MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxSize().testTag("system-check").statusBarsPadding().navigationBarsPadding()
            .verticalScroll(rememberScrollState()).widthIn(max=640.dp).padding(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
            Text("فحص النظام",style=MaterialTheme.typography.headlineMedium,fontWeight=FontWeight.Bold)
            Text(when {dirty -> "أكمل إعداد IP والاقتران المحلي ثم اختبر الاتصال.";state.ready -> "ثبت استقبال مكالمة وحفظها في Windows Receiver مع ACK أثناء غياب Activity في هذه العملية. هذا دليل سابق؛ لا يضمن استمرار OEM."
                state.canTestCall -> "الإعدادات تسمح باختبار مكالمة. اتصال listener وحده لا يثبت العمل بعد Home.";else -> "أكمل المتطلبات أدناه قبل اختبار مكالمة."},style=MaterialTheme.typography.bodyLarge)
            CheckRow("جهات الاتصال",state.setup.contacts,"يُفحص إذن Android الفعلي.","contacts",onFix)
            CheckRow("الوصول للإشعارات",state.setup.notificationEnabled,"يُفحص الوصول الخاص بخدمة OfficeCalls.","notification",onFix)
            CheckRow("Notification Listener متصل",state.setup.notificationReady,"callback متصل، وليس إثباتاً لاستقبال مكالمة في الخلفية. راجع التوقيتات أدناه.","listener",onFix)
            CheckRow("واتساب أو بزنس مكتشف",state.businessInstalled,"يجب أن يكون التطبيق مثبتاً ومرئياً لنظام Android.","business",onFix)
            OutlinedCard(Modifier.fillMaxWidth()) {Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                Text("العمل بالخلفية",style=MaterialTheme.typography.titleMedium)
                Text(when {
                    state.setup.backgroundRestricted==true -> "تحذير: Android يفرض قيوداً على التطبيق؛ راجع إعدادات البطارية."
                    state.setup.backgroundRestricted==false -> "لا توجد قيود خلفية معلنة من Android؛ تحقق بمكالمة والشاشة مغلقة."
                    else -> "حالة قيود الخلفية غير متاحة؛ تحقق بمكالمة والشاشة مغلقة."
                })
                Text("إعدادات TECNO الداخلية لا يمكن التحقق منها آلياً. استثناء البطارية ليس شرطاً لفتح التطبيق.")
                if(state.setup.backgroundRestricted==true) OutlinedButton({onFix("background")},Modifier.fillMaxWidth().heightIn(min=48.dp)) {Text("مراجعة إعدادات البطارية")}
            }}
            OutlinedCard(Modifier.fillMaxWidth().testTag("system-background-evidence")) {Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                Text("دليل استقبال وتسليم حقيقي",style=MaterialTheme.typography.titleMedium)
                Text("آخر بدء process: ${eventTime(state.lastProcessStartAt)}")
                Text("آخر إنشاء خدمة: ${eventTime(state.lastServiceCreatedAt)}")
                Text("آخر إتلاف خدمة: ${eventTime(state.lastServiceDestroyedAt)}")
                Text("آخر notification استلمه callback: ${eventTime(state.lastNotificationAt)}")
                Text("آخر notification بدون Activity ظاهرة: ${eventTime(state.lastBackgroundEventAt)}")
                Text("آخر حفظ في Windows Receiver مع ACK: ${eventTime(state.lastTcpDeliveryAt)}")
                Text(if(state.backgroundAckVerified && !dirty) "✓ ثبت حفظ حدث مستلم بالخلفية في Windows Receiver في process الحالية" else "العمل بعد Home: غير مثبت بعد — اختبر مكالمة والتطبيق بالخلفية",
                    color=if(state.backgroundAckVerified && !dirty) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error)
                Text("التوقيتات تاريخية. عدم تغير توقيت notification بعد المكالمة يعني أن callback لم يسجل وصولها؛ تغيره دون تسليم يحدد توقف المعالجة أو الشبكة من السجل.")
            } }
            OutlinedCard(Modifier.fillMaxWidth()) {Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                Text("الاتصال المحلي المشفّر",style=MaterialTheme.typography.titleMedium)
                Text("${state.endpoint} — يعمل عبر IP على الشبكة المحلية")
                Text(if(state.receiverConfigured) "الجهاز مربوط؛ فحص الاتصال يتحقق من شهادة المستقبِل ورمز الاقتران" else "افتح إعداد IP والاقتران من الرئيسية")
                Text(if(state.tcpConnected) "آخر فحص Windows حديث وناجح" else "اتصال Windows يحتاج فحصاً حديثاً")
                Button(onProbe,Modifier.fillMaxWidth().heightIn(min=48.dp).testTag("system-probe"),enabled=state.receiverConfigured) {Text("اختبار اتصال Windows")}
                Text("الفحص لا ينشئ مكالمة. ACK المستقبِل يعني حفظ الحدث؛ التسليم النهائي لكل برنامج يظهر منفصلاً في الرئيسية.")
            } }
            OutlinedCard(Modifier.fillMaxWidth()) {Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                Text("ACK",style=MaterialTheme.typography.titleMedium)
                Text(if(state.ackVerified && !dirty) "✓ ACK المستقبِل ناجح لآخر مكالمة حقيقية" else "لم يُتحقق بعد — يلزم اتصال WhatsApp حقيقي يُكتشف عبر الإشعارات")
                Text("لن نرسل Caller ID وهمياً لفحص ACK. عند تعذر استخراج الرقم يظهر الحدث في Windows وسجل التشخيص.")
            } }
            if(message.isNotBlank()) Text(message,color=MaterialTheme.colorScheme.primary)
            TextButton(onRefresh,Modifier.fillMaxWidth().heightIn(min=48.dp).testTag("system-refresh")) {Text("إعادة الفحص")}
            if(onContinue != null) Button(onContinue,Modifier.fillMaxWidth().heightIn(min=48.dp).testTag("system-continue"),enabled=state.canTestCall && !dirty) {
                Text(if(state.ready) "الدخول إلى التطبيق" else "الدخول لاختبار مكالمة حقيقية")
            }
        }
    }
}
@Composable
private fun CheckRow(label: String, good: Boolean, detail: String, key: String, fix:(String)->Unit) {
    OutlinedCard(Modifier.fillMaxWidth()) {Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Text("${if(good) "✓" else "✕"} $label",style=MaterialTheme.typography.titleMedium,
            color=if(good) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error)
        Text(detail,style=MaterialTheme.typography.bodyLarge)
        if(!good) OutlinedButton({fix(key)},Modifier.fillMaxWidth().heightIn(min=48.dp)) {Text("إصلاح — $label")}
    } }
}
private fun eventTime(value: String): String = value.toLongOrNull()?.let {
    java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS",java.util.Locale.US).format(java.util.Date(it))
} ?: "لم يُسجّل بعد"
