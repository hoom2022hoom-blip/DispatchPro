package com.maktab.calls

import android.app.Notification
import android.content.Context
internal object PhoneExtractor {
    fun resolve(versions: List<Notification>,values: List<String>,context: Context?=null,names: List<String> = emptyList())=
        NotificationCallIdentity.resolve(versions,values,context,names)
}
