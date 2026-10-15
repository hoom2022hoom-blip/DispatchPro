package com.maktab.calls

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.ContactsContract
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp

@Composable
internal fun ContactsProbeFlow(activity: MainActivity) {
    val app=activity.applicationContext
    var name by remember {mutableStateOf("رمزي دياب")}
    var report by remember {mutableStateOf(CallStore.get(app).state(ContactsProviderProbe.REPORT_STATE))}
    var busy by remember {mutableStateOf(false)}
    var message by remember {mutableStateOf("")}
    fun run(picked: Uri?=null) {
        if(busy) return
        busy=true;message=""
        ContactsProviderProbe.run(app,name,picked) {
            report=CallStore.get(app).state(ContactsProviderProbe.REPORT_STATE).ifBlank {it.text}
            busy=false;message="اكتمل الفحص. يمكنك نسخ التقرير الآمن."
        }
    }
    val picker=rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {result ->
        if(result.resultCode == Activity.RESULT_OK && result.data?.data != null) run(result.data!!.data)
        else message="لم تُحدد جهة اتصال."
    }
    ContactsProbeScreen(name,report,busy,message,onName={name=it},onRun={run()},onPick={
        runCatching {picker.launch(Intent(Intent.ACTION_PICK,ContactsContract.Contacts.CONTENT_URI))}
            .onFailure {message="تعذر فتح اختيار جهات الاتصال على هذا الجهاز."}
    },onLoad={report=CallStore.get(app).state(ContactsProviderProbe.REPORT_STATE);message="تم عرض آخر تقرير محفوظ؛ قد يكون من فشل مكالمة سابق."},onCopy={
        app.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("OfficeCalls Contacts Provider Probe",report))
        message="تم نسخ التقرير الآمن."
    })
}

@Composable
internal fun ContactsProbeScreen(name: String,report: String,busy: Boolean,message: String="",onName:(String)->Unit={},
    onRun:()->Unit={},onPick:()->Unit={},onLoad:()->Unit={},onCopy:()->Unit={}) {
    Surface(Modifier.fillMaxSize(),color=MaterialTheme.colorScheme.background) {
    Column(Modifier.fillMaxSize().testTag("contacts-probe").verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement=Arrangement.spacedBy(12.dp)) {
        Text("تشخيص الاسم من جهات الاتصال",style=MaterialTheme.typography.headlineSmall)
        Text("هذه نسخة تشخيصية. الفحص يقرأ مزود جهات الاتصال على هاتفك ويبحث عن الاسم كاملاً بعد التطبيع. لا يغيّر المطابقة ولا يرسل مكالمة للمكتب.")
        OutlinedTextField(name,onName,label={Text("الاسم كما ظهر في WhatsApp")},singleLine=true,enabled=!busy,
            modifier=Modifier.fillMaxWidth().testTag("probe-name"))
        Button(onRun,Modifier.fillMaxWidth().heightIn(min=48.dp).testTag("probe-run"),enabled=!busy && name.isNotBlank()) {Text("فحص الاسم على هذا الهاتف")}
        OutlinedButton(onPick,Modifier.fillMaxWidth().heightIn(min=48.dp).testTag("probe-pick"),enabled=!busy && name.isNotBlank()) {Text("فحص جهة اتصال تختارها")}
        Text("إذا لم يُعثر على الاسم، اختر «رمزي دياب» من قائمة الهاتف لمقارنة صف الجهة المحددة بالبحث العام. يتم إظهار IDs وحالات الربط فقط؛ الأرقام وأسماء الحسابات ومفاتيح lookup لا تظهر في التقرير.")
        if(busy) {LinearProgressIndicator(Modifier.fillMaxWidth());Text("جارٍ قراءة مصادر الاسم وربط الهوية…")}
        OutlinedButton(onLoad,Modifier.fillMaxWidth().heightIn(min=48.dp),enabled=!busy) {Text("عرض آخر تقرير محفوظ")}
        OutlinedButton(onCopy,Modifier.fillMaxWidth().heightIn(min=48.dp).testTag("probe-copy"),enabled=!busy && report.isNotBlank()) {Text("نسخ التقرير الآمن")}
        if(message.isNotBlank()) Text(message)
        if(report.isBlank()) Text(if(busy) "تظهر النتيجة هنا بعد اكتمال القراءة." else "لا يوجد تقرير بعد. اضغط فحص الاسم.")
        else CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
            SelectionContainer {Text(report,Modifier.fillMaxWidth().testTag("probe-report"),style=MaterialTheme.typography.bodyMedium)}
        }
    }
    }
}
