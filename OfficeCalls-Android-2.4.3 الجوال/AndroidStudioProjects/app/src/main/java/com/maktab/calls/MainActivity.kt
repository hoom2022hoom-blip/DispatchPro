package com.maktab.calls

import android.Manifest
import android.app.ActivityManager
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.service.notification.NotificationListenerService
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme(colorScheme = if (androidx.compose.foundation.isSystemInDarkTheme()) darkColorScheme() else lightColorScheme()) {
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) { OfficeCallsScreen(this) }
        } }
    }
}

@Composable
internal fun OfficeCallsScreen(activity: MainActivity) {
    Surface(Modifier.fillMaxSize(), color=MaterialTheme.colorScheme.background, contentColor=MaterialTheme.colorScheme.onBackground) {
        OfficeCallsContent(activity)
    }
}

@Composable
internal fun PermissionRow(label: String, enabled: Boolean, open: () -> Unit) {
    Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp)) {
        Text("${if (enabled) "✓ مفعلة" else "✕ تحتاج تفعيل"} — $label")
        OutlinedButton(open, Modifier.fillMaxWidth()) { Text("فتح الإعدادات") }
    } }
}
private fun notificationAccess(context: Context): Boolean = PermissionSetup.notificationAccess(context)
@Composable
private fun StatusLine(label: String, ok: Boolean, success: String, failure: String, warning: Boolean=false) {
    Text("$label: ${if(ok) "✓ $success" else if(warning) "تنبيه: $failure" else "✕ $failure"}",
        color=if(ok) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.error)
}
internal fun formatCallTime(value: String): String = CallTime.format(value.toLongOrNull() ?: 0L)
internal fun copyOfficeDiagnostics(context: Context) {
    val store=CallStore.get(context)
    val system=SystemCheck.read(context)
    val text="OfficeCalls ${BuildConfig.VERSION_NAME}\n${Build.MANUFACTURER} ${Build.MODEL}; Android ${Build.VERSION.RELEASE}\nnotificationAccess=${system.setup.notificationEnabled}; listenerConnected=${system.setup.listenerConnected}; receiver=${system.endpoint}; backgroundRestricted=${system.setup.backgroundRestricted}\n"+store.logs().asReversed().joinToString("\n\n")
    context.getSystemService(android.content.ClipboardManager::class.java).setPrimaryClip(android.content.ClipData.newPlainText("OfficeCalls diagnostics",text))
}
