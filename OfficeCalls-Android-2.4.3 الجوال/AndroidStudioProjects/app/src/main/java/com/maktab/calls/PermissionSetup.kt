package com.maktab.calls

import android.Manifest
import android.app.ActivityManager
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat

/** System truth is checked on every entry/resume. Saved onboarding is never a permission grant. */
internal object PermissionSetup {
    const val PREFS = "office_calls_setup"
    const val COMPLETED = "onboarding_completed"
    const val CONTACTS_REQUESTED = "contacts_requested"
    const val BACKGROUND_REVIEWED = "background_reviewed"
    const val AUTOSTART_REVIEWED = "autostart_reviewed"

    data class Snapshot(
        val contacts: Boolean,
        val notificationEnabled: Boolean,
        val listenerConnected: Boolean,
        val batteryExempt: Boolean,
        val backgroundRestricted: Boolean?,
        val internetDeclared: Boolean,
        val backgroundReviewed: Boolean,
        val autoStartReviewed: Boolean,
        val readErrors: Set<String> = emptySet()
    ) {
        val notificationReady get() = notificationEnabled && listenerConnected
        val criticalReady get() = contacts && notificationReady
        val ready get() = criticalReady && batteryExempt && backgroundRestricted != true && internetDeclared &&
            backgroundReviewed && autoStartReviewed && readErrors.isEmpty()
    }

    fun notificationAccess(context: Context): Boolean = runCatching {
        val component = ComponentName(context, WhatsAppNotificationListener::class.java)
        val packageEnabled = context.packageName in NotificationManagerCompat.getEnabledListenerPackages(context)
        val componentEnabled = if (Build.VERSION.SDK_INT >= 27) {
            context.getSystemService(NotificationManager::class.java).isNotificationListenerAccessGranted(component)
        } else Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners").orEmpty()
            .split(':').any { ComponentName.unflattenFromString(it) == component }
        packageEnabled && componentEnabled
    }.getOrDefault(false)

    @Suppress("DEPRECATION")
    fun read(context: Context): Snapshot {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val errors = linkedSetOf<String>()
        val battery = runCatching { context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName) }
            .getOrElse { errors.add("BATTERY_STATE"); false }
        val background: Boolean? = if (Build.VERSION.SDK_INT >= 28) runCatching {
            context.getSystemService(ActivityManager::class.java).isBackgroundRestricted
        }.getOrElse { errors.add("BACKGROUND_STATE"); null } else null
        val internet = runCatching {
            val info = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)
            Manifest.permission.INTERNET in info.requestedPermissions.orEmpty()
        }.getOrElse { errors.add("MANIFEST_PERMISSIONS"); false }
        return Snapshot(ContactIndex.permissionGranted(context), notificationAccess(context), WhatsAppNotificationListener.connected,
            battery, background, internet, prefs.getBoolean(BACKGROUND_REVIEWED, false), prefs.getBoolean(AUTOSTART_REVIEWED, false), errors)
    }
    fun completed(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(COMPLETED, false)
    fun finish(context: Context): Boolean {
        if (!read(context).ready) return false
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(COMPLETED, true).apply()
        CallStore.get(context).log(status = "SETUP_COMPLETED", detail = "contacts=GRANTED; notification=ENABLED_CONNECTED; battery=EXEMPT; oem=MANUALLY_REVIEWED_NOT_VERIFIED")
        return true
    }
    fun reviewed(context: Context, key: String, value: Boolean) {
        require(key == BACKGROUND_REVIEWED || key == AUTOSTART_REVIEWED)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(key, value).apply()
    }
    fun appInfo(context: Context) = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
    fun notificationIntents(context: Context): List<Intent> = buildList {
        if (Build.VERSION.SDK_INT >= 30) add(Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
            .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, ComponentName(context, WhatsAppNotificationListener::class.java).flattenToString()))
        add(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
    }
    fun batteryIntents() = listOf(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))

    /** Known OEM pages are suggestions, not permission grants. Exported handlers are required. */
    fun oemIntents(manufacturer: String = Build.MANUFACTURER, autoStart: Boolean): List<Intent> {
        val maker = manufacturer.lowercase(java.util.Locale.ROOT)
        val components = when {
            maker in setOf("tecno", "infinix", "itel") -> listOf(
                "com.transsion.phonemaster/com.transsion.phonemaster.MainActivity",
                "com.transsion.phonemanager/com.transsion.phonemanager.MainActivity")
            maker in setOf("xiaomi", "redmi", "poco") && autoStart -> listOf("com.miui.securitycenter/com.miui.permcenter.autostart.AutoStartManagementActivity")
            maker in setOf("xiaomi", "redmi", "poco") -> listOf("com.miui.powerkeeper/com.miui.powerkeeper.ui.HiddenAppsConfigActivity")
            maker == "oppo" || maker == "realme" -> listOf("com.coloros.safecenter/com.coloros.safecenter.permission.startup.StartupAppListActivity")
            maker == "vivo" -> listOf("com.vivo.permissionmanager/com.vivo.permissionmanager.activity.BgStartUpManagerActivity")
            maker == "huawei" || maker == "honor" -> listOf("com.huawei.systemmanager/com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity")
            else -> emptyList()
        }
        return components.mapNotNull { ComponentName.unflattenFromString(it)?.let { component -> Intent().setComponent(component) } }
            .map { it.putExtra("package_name", "com.maktab.calls").putExtra("package_label", "مكالمات المكتب") }
    }
    fun backgroundIntents(context: Context, autoStart: Boolean): List<Intent> {
        val tecno = if (Build.MANUFACTURER.lowercase(java.util.Locale.ROOT) in setOf("tecno", "infinix", "itel"))
            listOf("com.transsion.phonemaster", "com.transsion.phonemanager").mapNotNull { runCatching { context.packageManager.getLaunchIntentForPackage(it) }.getOrNull() }
        else emptyList()
        return tecno + oemIntents(autoStart = autoStart) +
            (if (autoStart) emptyList() else listOf(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))) + appInfo(context)
    }

    /** Catch failures on every candidate INCLUDING fallbacks; never launch an inaccessible component. */
    fun openSettings(context: Context, candidates: List<Intent>,
        canOpen: (Intent) -> Boolean = { intent ->
            val handler = context.packageManager.resolveActivity(intent, 0)?.activityInfo
            handler != null && handler.enabled && handler.exported &&
                (handler.permission == null || context.checkSelfPermission(handler.permission) == PackageManager.PERMISSION_GRANTED)
        },
        launch: (Intent) -> Unit = { context.startActivity(it) }
    ): Boolean {
        val choices = candidates + listOf(appInfo(context), Intent(Settings.ACTION_SETTINGS))
        for (intent in choices) {
            if (runCatching { canOpen(intent) }.getOrDefault(false) && runCatching { launch(intent) }.isSuccess) return true
        }
        return false
    }
    @Suppress("DEPRECATION")
    fun installSource(context: Context): String = runCatching {
        if (Build.VERSION.SDK_INT >= 30) context.packageManager.getInstallSourceInfo(context.packageName).installingPackageName
        else context.packageManager.getInstallerPackageName(context.packageName)
    }.getOrNull().orEmpty().ifBlank { "غير متاح" }
}
