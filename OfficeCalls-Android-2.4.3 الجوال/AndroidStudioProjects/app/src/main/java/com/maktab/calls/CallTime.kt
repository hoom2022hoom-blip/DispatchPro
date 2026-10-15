package com.maktab.calls

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** Epoch milliseconds are immutable. Palestine civil time is presentation only. */
internal object CallTime {
    const val ZONE = "Asia/Hebron"
    fun incoming(postTime: Long, callbackTime: Long): Long = if (postTime > 0) postTime else callbackTime
    fun format(value: Long, millis: Boolean = false): String {
        if (value <= 0) return "—"
        return SimpleDateFormat(if (millis) "yyyy-MM-dd HH:mm:ss.SSS" else "yyyy-MM-dd HH:mm:ss", Locale.US)
            .apply { timeZone = TimeZone.getTimeZone(ZONE) }.format(Date(value))
    }
}
