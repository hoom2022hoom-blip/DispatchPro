package com.maktab.calls

import android.content.Context
import android.os.Build
import android.provider.SimPhonebookContract.ElementaryFiles as Files
import android.provider.SimPhonebookContract.SimRecords as Records
import androidx.annotation.RequiresApi

/** Read-only public SIM phonebook (API 31+). READ_CONTACTS is sufficient; no telephony permission. */
internal object SimContactIndex {
    data class Record(val subscription: Int, val record: Int, val name: String, val phone: String)
    data class Snapshot(val records: List<Record>, val status: String)
    fun read(context: Context): Snapshot {
        if (Build.VERSION.SDK_INT < 31) return Snapshot(emptyList(), "API_UNSUPPORTED")
        return readAvailable(context)
    }
    @RequiresApi(31)
    private fun readAvailable(context: Context): Snapshot {
        val result = linkedMapOf<Pair<Int, Int>, Record>()
        return try {
            val subscriptions = linkedSetOf<Int>()
            val files = context.contentResolver.query(Files.CONTENT_URI,
                arrayOf(Files.SUBSCRIPTION_ID, Files.EF_TYPE), null, null, null)
                ?: return Snapshot(emptyList(), "PROVIDER_UNAVAILABLE")
            files.use {
                val sub = it.getColumnIndexOrThrow(Files.SUBSCRIPTION_ID)
                val type = it.getColumnIndexOrThrow(Files.EF_TYPE)
                while (it.moveToNext()) if (it.getInt(type) == Files.EF_ADN && it.getInt(sub) >= 0) subscriptions.add(it.getInt(sub))
            }
            for (subscription in subscriptions) {
                val rows = context.contentResolver.query(Records.getContentUri(subscription, Files.EF_ADN),
                    arrayOf(Records.RECORD_NUMBER, Records.NAME, Records.PHONE_NUMBER), null, null, null)
                    ?: return Snapshot(emptyList(), "PROVIDER_UNAVAILABLE")
                rows.use {
                    val number = it.getColumnIndexOrThrow(Records.RECORD_NUMBER)
                    val name = it.getColumnIndexOrThrow(Records.NAME)
                    val phone = it.getColumnIndexOrThrow(Records.PHONE_NUMBER)
                    while (it.moveToNext()) {
                        val record = it.getInt(number)
                        val label = it.getString(name).orEmpty()
                        if (record <= 0 || label.isBlank()) continue
                        val value = Record(subscription, record, label, CallPhoneNumber.normalize(it.getString(phone).orEmpty()))
                        val previous = result.put(subscription to record, value)
                        if (previous != null && previous != value) return Snapshot(emptyList(), "INCONSISTENT_RECORD")
                    }
                }
            }
            Snapshot(result.values.toList(), "READ")
        } catch (_: SecurityException) {
            Snapshot(emptyList(), "ACCESS_DENIED")
        } catch (error: Exception) {
            // SIM absent, switched, unsupported by OEM, or unavailable profile: ordinary Contacts still work.
            Snapshot(emptyList(), "UNAVAILABLE_${error.javaClass.simpleName}")
        }
    }
}
