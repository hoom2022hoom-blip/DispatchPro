package com.maktab.calls

import android.content.Context
/** Persistent session boundaries live in CallStore's SQLite transaction; extraction may enrich queued sessions. */
internal class CallSessionManager(context: Context) {
    private val store=CallStore.get(context)
    fun observe(pkg: String,key: String,now: Long,summary: Boolean,phone: String,create: Boolean,name: String,group: String="", eventTime: Long=now)=
        store.observe(pkg,key,now,summary,PhoneNormalizer.identity(phone),create,name,strictAliases=true,notificationGroup=group,eventTime=eventTime)
    fun enrich(id: String,names: List<String>,now: Long){store.enrich(id,names,now)}
    fun capture(pkg: String,key: String,phone: String,now: Long,summary: Boolean)=store.capture(pkg,key,PhoneNormalizer.identity(phone),now,summary)
}
