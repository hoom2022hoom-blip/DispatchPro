package com.maktab.calls

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.provider.ContactsContract
import android.util.Log
import androidx.core.content.ContextCompat
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** فهرس دائم وسريع لمطابقة اسم WhatsApp مع رقم الهاتف. */
object ContactIndex {
    const val ACTION_INDEX_STATUS = "com.maktab.calls.CONTACT_INDEX_STATUS"
    const val EXTRA_INDEX_STATUS = "index_status"
    private const val TAG = "MaktabCalls"
    private const val DB_NAME = "office_contacts.db"
    private const val DB_VERSION = 1
    private const val REFRESH_INTERVAL_MS = 6L * 60L * 60L * 1000L
    private const val PREFS = "contact_index_state"
    private const val KEY_LAST_REFRESH = "last_refresh"
    private val memory = ConcurrentHashMap<String, String>()
    private val refreshExecutor = Executors.newSingleThreadExecutor()
    private val refreshing = AtomicBoolean(false)

    fun lookup(context: Context, displayName: String): String {
        val key = normalizeName(displayName)
        if (key.isBlank()) return ""
        memory[key]?.let { return it }

        try {
            Helper(context.applicationContext).readableDatabase.rawQuery(
                "SELECT number FROM contacts WHERE name_key = ? LIMIT 1",
                arrayOf(key)
            ).use { cursor ->
                if (cursor.moveToFirst()) {
                    return cursor.getString(0).orEmpty().also { if (it.isNotBlank()) memory[key] = it }
                }
            }
        } catch (error: Exception) {
            Log.w(TAG, "Contact index lookup failed", error)
        }

        // احتياط للمكالمة الأولى إذا لم يكتمل بناء الفهرس بعد.
        return lookupExactInPhone(context, displayName).also {
            if (it.isNotBlank()) memory[key] = it
        }
    }

    fun refreshAsync(context: Context, force: Boolean = false) {
        val appContext = context.applicationContext
        if (ContextCompat.checkSelfPermission(appContext, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) return
        val last = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_LAST_REFRESH, 0L)
        if (!force && System.currentTimeMillis() - last < REFRESH_INTERVAL_MS) return
        if (!refreshing.compareAndSet(false, true)) return

        refreshExecutor.execute {
            try {
                report(appContext, "يجري تجهيز دليل الأسماء في الخلفية...")
                val count = rebuild(appContext)
                appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                    .putLong(KEY_LAST_REFRESH, System.currentTimeMillis()).apply()
                Log.i(TAG, "Persistent contact index is ready")
                report(appContext, "تم تجهيز دليل الأسماء: $count اسم ✓")
            } catch (error: Exception) {
                Log.e(TAG, "Could not refresh contact index", error)
                report(appContext, "تعذر تحديث دليل الأسماء؛ تحقق من إذن جهات الاتصال")
            } finally {
                refreshing.set(false)
            }
        }
    }

    private fun rebuild(context: Context): Int {
        val helper = Helper(context)
        val db = helper.writableDatabase
        db.execSQL("DELETE FROM contacts_build")
        var count = 0
        db.beginTransaction()
        try {
            val statement = db.compileStatement("INSERT OR IGNORE INTO contacts_build(name_key, number) VALUES(?, ?)")
            context.contentResolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                arrayOf(
                    ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY,
                    ContactsContract.CommonDataKinds.Phone.NUMBER
                ), null, null, null
            )?.use { cursor ->
                while (cursor.moveToNext()) {
                    val key = normalizeName(cursor.getString(0).orEmpty())
                    val number = cursor.getString(1).orEmpty()
                    if (key.isNotBlank() && number.isNotBlank()) {
                        statement.clearBindings()
                        statement.bindString(1, key)
                        statement.bindString(2, number)
                        if (statement.executeInsert() != -1L) count++
                    }
                }
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }

        db.beginTransaction()
        try {
            db.execSQL("DELETE FROM contacts")
            db.execSQL("INSERT OR REPLACE INTO contacts(name_key, number) SELECT name_key, number FROM contacts_build")
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        memory.clear()
        return count
    }

    private fun report(context: Context, message: String) {
        context.sendBroadcast(Intent(ACTION_INDEX_STATUS).apply {
            setPackage(context.packageName)
            putExtra(EXTRA_INDEX_STATUS, message)
        })
    }

    private fun lookupExactInPhone(context: Context, displayName: String): String = try {
        context.contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            arrayOf(ContactsContract.CommonDataKinds.Phone.NUMBER),
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY} = ?",
            arrayOf(displayName), null
        )?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0).orEmpty() else "" }.orEmpty()
    } catch (error: Exception) {
        Log.w(TAG, "Direct contact lookup failed", error)
        ""
    }

    fun normalizeName(value: String): String = value
        .replace(Regex("[\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]"), "")
        .replace(Regex("[^\\p{L}\\p{N}]"), "")
        .lowercase()

    private class Helper(context: Context) : SQLiteOpenHelper(context, DB_NAME, null, DB_VERSION) {
        override fun onCreate(db: SQLiteDatabase) {
            db.execSQL("CREATE TABLE contacts(name_key TEXT PRIMARY KEY, number TEXT NOT NULL)")
            db.execSQL("CREATE TABLE contacts_build(name_key TEXT PRIMARY KEY, number TEXT NOT NULL)")
        }

        override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit
    }
}
