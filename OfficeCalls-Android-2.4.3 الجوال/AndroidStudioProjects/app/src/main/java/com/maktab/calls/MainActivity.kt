package com.maktab.calls

import android.Manifest
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.Switch
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme { OfficeCallsScreen(this) } }
    }
}

@Composable
private fun OfficeCallsScreen(context: Context) {
    val prefs = remember { context.getSharedPreferences(NetworkSender.PREFS_NAME, Context.MODE_PRIVATE) }
    val authPrefs = remember { context.getSharedPreferences(NetworkSender.AUTH_PREFS_NAME, Context.MODE_PRIVATE) }
    var legacyTcp by remember { mutableStateOf(prefs.getBoolean(NetworkSender.KEY_LEGACY_TCP, false)) }
    var host by remember { mutableStateOf(prefs.getString(if (legacyTcp) NetworkSender.KEY_HOST else NetworkSender.KEY_HTTP_HOST, if (legacyTcp) "192.168.1.100" else NetworkSender.DEFAULT_HOST) ?: "") }
    var port by remember { mutableStateOf(prefs.getInt(if (legacyTcp) NetworkSender.KEY_PORT else NetworkSender.KEY_HTTP_PORT, if (legacyTcp) 5050 else NetworkSender.DEFAULT_PORT).toString()) }
    var token by remember { mutableStateOf(authPrefs.getString(NetworkSender.KEY_TOKEN, "").orEmpty()) }
    var notificationAccess by remember { mutableStateOf(isNotificationAccessEnabled(context)) }
    var contactsAccess by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED)
    }
    var status by remember { mutableStateOf("جاهز للإعداد") }
    var lastCaller by remember { mutableStateOf("لا توجد مكالمة حتى الآن") }

    fun saveSettings(): Boolean {
        val portNumber = port.toIntOrNull()
        if (host.isBlank() || portNumber == null || portNumber !in 1..65535) {
            status = "تحقق من عنوان IP والمنفذ"
            return false
        }
        if (!legacyTcp) {
            try { CallHttpTransport.endpoint(host, portNumber) }
            catch (_: IllegalArgumentException) { status = "أدخل عنوان IPv4 المحلي للكمبيوتر"; return false }
            if (token.trim().length < 32 || token.any { it == '\r' || it == '\n' }) {
                status = "ألصق رمز Bearer من الكمبيوتر (دون كلمة Bearer)"
                return false
            }
            authPrefs.edit().putString(NetworkSender.KEY_TOKEN, token.trim()).apply()
        }
        prefs.edit().putBoolean(NetworkSender.KEY_LEGACY_TCP, legacyTcp)
            .putString(if (legacyTcp) NetworkSender.KEY_HOST else NetworkSender.KEY_HTTP_HOST, host)
            .putInt(if (legacyTcp) NetworkSender.KEY_PORT else NetworkSender.KEY_HTTP_PORT, portNumber).apply()
        return true
    }

    val contactsPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        contactsAccess = granted
        if (granted) ContactIndex.refreshAsync(context, force = true)
        status = if (granted) "تم السماح، ويجري تجهيز فهرس الأسماء السريع" else "لن يُرسل اسم جهة الاتصال؛ يلزم ظهور الرقم في الإشعار أو السماح بمطابقته"
    }

    DisposableEffect(context) {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(receiverContext: Context?, intent: Intent?) {
                when (intent?.action) {
                    WhatsAppNotificationListener.ACTION_WHATSAPP_EVENT -> {
                        lastCaller = intent.getStringExtra(WhatsAppNotificationListener.EXTRA_CALLER) ?: "متصل غير معروف"
                        status = "تم التقاط المكالمة؛ جارٍ الإرسال إلى الكمبيوتر"
                    }
                    NetworkSender.ACTION_SEND_STATUS -> status = intent.getStringExtra(NetworkSender.EXTRA_STATUS) ?: status
                    ContactIndex.ACTION_INDEX_STATUS -> status = intent.getStringExtra(ContactIndex.EXTRA_INDEX_STATUS) ?: status
                }
            }
        }
        val filter = IntentFilter().apply {
            addAction(WhatsAppNotificationListener.ACTION_WHATSAPP_EVENT)
            addAction(NetworkSender.ACTION_SEND_STATUS)
            addAction(ContactIndex.ACTION_INDEX_STATUS)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            context.registerReceiver(receiver, filter)
        }
        onDispose { context.unregisterReceiver(receiver) }
    }

    LaunchedEffect(Unit) { notificationAccess = isNotificationAccessEnabled(context) }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Top
    ) {
        Image(
            painter = painterResource(R.drawable.office_logo),
            contentDescription = "شعار تكسي نابلس والمهندس",
            contentScale = ContentScale.Crop,
            modifier = Modifier.size(150.dp).clip(CircleShape)
        )
        Spacer(Modifier.height(10.dp))
        Text("مكالمات المكتب", fontSize = 30.sp, fontWeight = FontWeight.Bold)
        Text("إعداد وتطوير: إبراهيم دياب", fontSize = 15.sp, fontWeight = FontWeight.Medium)
        Text("WhatsApp + WhatsApp Business → Windows 10", fontSize = 16.sp)
        Spacer(Modifier.height(18.dp))
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                Text("آخر متصل", fontWeight = FontWeight.Bold)
                Text(lastCaller, fontSize = 22.sp, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
            }
        }
        Spacer(Modifier.height(14.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("مستقبل Windows القديم (TCP)", modifier = Modifier.weight(1f))
            Switch(checked = legacyTcp, onCheckedChange = { enabled ->
                legacyTcp = enabled
                host = prefs.getString(if (enabled) NetworkSender.KEY_HOST else NetworkSender.KEY_HTTP_HOST, if (enabled) "192.168.1.100" else NetworkSender.DEFAULT_HOST).orEmpty()
                port = prefs.getInt(if (enabled) NetworkSender.KEY_PORT else NetworkSender.KEY_HTTP_PORT, if (enabled) 5050 else NetworkSender.DEFAULT_PORT).toString()
            })
        }
        OutlinedTextField(
            value = host,
            onValueChange = { host = it.trim() },
            label = { Text("عنوان IP لجهاز Windows") },
            placeholder = { Text("مثال: 192.168.1.50") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
        OutlinedTextField(
            value = port,
            onValueChange = { port = it.filter(Char::isDigit).take(5) },
            label = { Text("المنفذ") },
            singleLine = true,
            keyboardOptions = KeyboardOptions.Default,
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(12.dp))
        if (!legacyTcp) {
            OutlinedTextField(
                value = token, onValueChange = { token = it.trim() },
                label = { Text("رمز Bearer من الكمبيوتر") },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true, modifier = Modifier.fillMaxWidth()
            )
            Text("http://$host:$port/api/calls", fontSize = 12.sp)
            Text("اختبار الاتصال ينشئ طلب واتساب تجريبيًا في لوحة المكتب.", fontSize = 12.sp)
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = {
                if (saveSettings()) status = "تم حفظ الإعدادات"
            }, modifier = Modifier.weight(1f)) { Text("حفظ") }
            Button(onClick = {
                if (saveSettings()) {
                    status = "جارٍ اختبار الاتصال..."
                    NetworkSender.sendTest(context)
                }
            }, modifier = Modifier.weight(1f)) { Text("اختبار الاتصال") }
        }
        Spacer(Modifier.height(10.dp))
        Button(onClick = {
            context.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            notificationAccess = isNotificationAccessEnabled(context)
        }, modifier = Modifier.fillMaxWidth()) {
            Text(if (notificationAccess) "الوصول إلى الإشعارات مفعّل ✓" else "تفعيل الوصول إلى الإشعارات")
        }
        Button(onClick = { contactsPermission.launch(Manifest.permission.READ_CONTACTS) }, modifier = Modifier.fillMaxWidth()) {
            Text(if (contactsAccess) "جهات الاتصال مفعّلة ✓" else "السماح بمطابقة الاسم مع رقم الهاتف")
        }
        if (contactsAccess) {
            Button(onClick = {
                ContactIndex.refreshAsync(context, force = true)
                status = "يجري تحديث فهرس الأسماء في الخلفية"
            }, modifier = Modifier.fillMaxWidth()) {
                Text("تحديث دليل الأسماء")
            }
        }
        Spacer(Modifier.height(12.dp))
        Text(status, textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.primary)
        Text("يجب أن يكون الهاتف والكمبيوتر على شبكة المكتب نفسها.", fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 8.dp))
    }
}

private fun isNotificationAccessEnabled(context: Context): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
        context.getSystemService(NotificationManager::class.java)
            .isNotificationListenerAccessGranted(ComponentName(context, WhatsAppNotificationListener::class.java))
    } else {
        Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")?.contains(context.packageName) == true
    }
}
