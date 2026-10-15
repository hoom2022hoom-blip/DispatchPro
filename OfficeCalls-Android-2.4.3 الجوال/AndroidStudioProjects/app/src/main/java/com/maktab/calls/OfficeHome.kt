package com.maktab.calls

import android.Manifest
import android.content.*
import android.net.Uri
import android.provider.Settings
import android.service.notification.NotificationListenerService
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.*
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver

@Composable
internal fun OfficeCallsContent(activity:MainActivity) {
    val store=remember {CallStore.get(activity)}
    var page by remember {mutableStateOf("الرئيسية")}
    var status by remember {mutableStateOf(NetworkSender.connectionStatus)}
    var revision by remember {mutableIntStateOf(0)}
    BackHandler(page!="الرئيسية"){page=if(page=="إعداد الاتصال") "الرئيسية" else "إعداد الاتصال"}
    val contacts=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()){revision++;NetworkSender.resume(activity)}
    LaunchedEffect(activity) {if(SystemCheck.read(activity).receiverConfigured)NetworkSender.sendTest(activity)}
    DisposableEffect(activity) {
        fun refresh(){revision++;status=NetworkSender.connectionStatus}
        val observer=LifecycleEventObserver {_,event->if(event==Lifecycle.Event.ON_RESUME){refresh();if(SystemCheck.read(activity).receiverConfigured)NetworkSender.sendTest(activity)}}
        activity.lifecycle.addObserver(observer)
        val receiver=object:BroadcastReceiver(){override fun onReceive(context:Context?,intent:Intent?){refresh()}}
        ContextCompat.registerReceiver(activity,receiver,IntentFilter().apply {
            addAction(NetworkSender.ACTION_SEND_STATUS);addAction(WhatsAppNotificationListener.ACTION_WHATSAPP_EVENT)
            addAction(WhatsAppNotificationListener.ACTION_LISTENER_STATE);addAction("com.maktab.calls.DIAGNOSTICS_CHANGED")
        },ContextCompat.RECEIVER_NOT_EXPORTED)
        onDispose {activity.lifecycle.removeObserver(observer);activity.unregisterReceiver(receiver)}
    }
    val snapshot=revision
    val system=SystemCheck.read(activity)
    val access=PermissionSetup.notificationAccess(activity)
    val running=WhatsAppNotificationListener.connected&&access
    val contactAllowed=ContactIndex.permissionGranted(activity)
    if(page=="فحص النظام"||page=="جهات الاتصال") {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            TextButton({page="تشخيص المطور"},Modifier.fillMaxWidth().heightIn(min=48.dp)){Text("العودة")}
            Box(Modifier.weight(1f)){if(page=="فحص النظام")SystemCheckFlow(activity,onRepairPermissions={page="الصلاحيات"})else ContactsProbeFlow(activity)}
        };return
    }
    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
        Text("مكالمات المكتب",fontSize=28.sp,fontWeight=FontWeight.Bold)
        if(page!="الرئيسية") TextButton({page=if(page=="إعداد الاتصال") "الرئيسية" else "إعداد الاتصال"},Modifier.fillMaxWidth().heightIn(min=48.dp)){Text("العودة")}
        when(page) {
            "الرئيسية" -> {
                Card(Modifier.fillMaxWidth()){Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                    Text("واتساب: ${if(system.businessInstalled&&running) "يعمل" else "يحتاج تفعيل"}",color=if(system.businessInstalled&&running)MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.error)
                    Text("كمبيوتر المكتب: ${if(system.tcpConnected) "متصل" else "غير متصل"}")
                }}
                Card(Modifier.fillMaxWidth()){Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
                    Text("آخر مكالمة",style=MaterialTheme.typography.titleMedium)
                    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
                        Text(store.state("last_call").ifBlank {if(store.state("last_call_time").isBlank()) "—" else "الرقم غير متاح"},fontSize=30.sp,fontWeight=FontWeight.Bold)
                    }
                    store.state("last_call_name").takeIf {it.isNotBlank()}?.let {Text(it,fontSize=20.sp)}
                    Text(when(store.state("last_call_source")){"com.whatsapp.w4b"->"واتساب بزنس";"com.whatsapp"->"واتساب";else->"—"})
                    CallTimeText(store.state("last_call_time"))
                    Text("بتوقيت فلسطين — Asia/Hebron",style=MaterialTheme.typography.bodySmall)
                    if(store.state("last_call").isBlank() && store.state("last_call_time").isNotBlank())
                        Text("لم يكشف الإشعار رقمًا مؤكدًا. رقم ملف واتساب لا يكون متاحًا دائمًا للإشعارات؛ حفظه في جهات اتصال الهاتف قد يتيح مطابقة الاسم.",style=MaterialTheme.typography.bodySmall)
                }}
                Text("المكالمات المعلقة: ${store.pending().size}",style=MaterialTheme.typography.titleMedium)
                Button({page="إعداد الاتصال"},Modifier.fillMaxWidth().heightIn(min=52.dp)){Text("إعداد الاتصال")}
                TextButton({page="سجل المكالمات"},Modifier.fillMaxWidth().heightIn(min=48.dp)){Text("سجل المكالمات")}
            }
            "سجل المكالمات" -> {
                Text("سجل المكالمات — بتوقيت فلسطين",style=MaterialTheme.typography.titleMedium)
                store.history().forEach {call->Card(Modifier.fillMaxWidth()){Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) {
                    val phone=call.optString("number")
                    if(phone.isBlank())Text("الرقم غير متاح")else CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr){Text(phone)}
                    call.optString("displayName").takeIf {it.isNotBlank()}?.let {Text(it)}
                    CallTimeText(call.optLong("timestamp").toString())
                    Text(if(call.optBoolean("acknowledged")) "تم تأكيد الحفظ" else "معلقة — محفوظة لإعادة الإرسال")
                }}}
            }
            "إعداد الاتصال" -> {
                PairingScreen(activity)
                if(!LocalReceiverTransport.enabled(activity) && LocalReceiverTransport.saved(activity)) {
                    Text("المسار الحالي سحابي. يوجد ربط محلي محفوظ بكمبيوتر المكتب.")
                    OutlinedButton({LocalReceiverTransport.useSaved(activity)},Modifier.fillMaxWidth().heightIn(min=48.dp)){Text("استخدام ربط الكمبيوتر المحفوظ")}
                }
                Text(status,style=MaterialTheme.typography.bodyLarge)
                if(LocalReceiverTransport.enabled(activity) && kotlin.math.abs(store.state("local_clock_delta").toLongOrNull() ?: 0L)>30_000) {
                    Text("يوجد اختلاف بين ساعة الهاتف والكمبيوتر. فعّل الوقت التلقائي على الجهازين؛ تبقى أوقات المكالمات القديمة محفوظة.",color=MaterialTheme.colorScheme.error)
                    TextButton({PermissionSetup.openSettings(activity,listOf(Intent(Settings.ACTION_DATE_SETTINGS)))}){Text("إعدادات الوقت والتاريخ")}
                }
                Button({NetworkSender.sendTest(activity)},Modifier.fillMaxWidth().heightIn(min=48.dp),enabled=system.receiverConfigured){Text("اختبار الاتصال")}
                OutlinedButton({page="الصلاحيات"},Modifier.fillMaxWidth().heightIn(min=48.dp)){Text("تفعيل واتساب والصلاحيات")}
                TextButton({page="تشخيص المطور"},Modifier.fillMaxWidth().heightIn(min=48.dp)){Text("تشخيص المطور")}
            }
            "الصلاحيات" -> {
                PermissionRow("الوصول إلى الإشعارات",access){PermissionSetup.openSettings(activity,PermissionSetup.notificationIntents(activity))}
                Text(if(running) "مستمع المكالمات يعمل" else "مستمع المكالمات يحتاج تفعيل")
                PermissionRow("جهات الاتصال — للتعرف على الأسماء المحفوظة",contactAllowed){if(contactAllowed)PermissionSetup.openSettings(activity,listOf(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:${activity.packageName}"))))else contacts.launch(Manifest.permission.READ_CONTACTS)}
                OutlinedButton({runCatching {NotificationListenerService.requestRebind(ComponentName(activity,WhatsAppNotificationListener::class.java))}},Modifier.fillMaxWidth().heightIn(min=48.dp)){Text("إعادة تفعيل مستمع المكالمات")}
                OutlinedButton({PermissionSetup.openSettings(activity,listOf(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:${activity.packageName}"))))},Modifier.fillMaxWidth().heightIn(min=48.dp)){Text("فتح إعدادات البطارية والتطبيق")}
                Text("قد يؤخر الهاتف العمل بسبب قيود البطارية. الإيقاف الإجباري وتعطيل الوصول للإشعارات يمنعان استقبال المكالمات حتى إعادة التفعيل.")
            }
            "تشخيص المطور" -> {
                Text("OfficeCalls ${BuildConfig.VERSION_NAME}")
                Text("المستقبل: ${system.endpoint}")
                Text("آخر خطأ: ${store.state("last_error")}")
                Text("آخر تأكيد: ${store.state("last_ack")}")
                Text("GRIDCMS: ${store.state("grid_delivery")} — تأكيد Windows يثبت الحفظ، وإرسال UDP لا يثبت العرض.")
                Button({page="فحص النظام"},Modifier.fillMaxWidth().heightIn(min=48.dp)){Text("فحص النظام")}
                OutlinedButton({page="جهات الاتصال"},Modifier.fillMaxWidth().heightIn(min=48.dp)){Text("فحص مطابقة جهات الاتصال")}
                OutlinedButton({copyOfficeDiagnostics(activity)},Modifier.fillMaxWidth().heightIn(min=48.dp)){Text("نسخ التشخيص")}
                var legacy by remember {mutableStateOf("")}
                OutlinedTextField(legacy,{legacy=it},label={Text("استيراد إعداد قديم — نص الربط")},modifier=Modifier.fillMaxWidth())
                OutlinedButton({NetworkSender.pair(activity,legacy)},Modifier.fillMaxWidth().heightIn(min=48.dp),enabled=legacy.isNotBlank()){Text("استيراد الإعداد")}
                store.logs().forEach {Card(Modifier.fillMaxWidth()){Text(it,Modifier.padding(12.dp))}}
            }
        }
    }
}

@Composable
private fun CallTimeText(value: String) {
    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
        Text(formatCallTime(value),style=MaterialTheme.typography.bodyLarge)
    }
}
