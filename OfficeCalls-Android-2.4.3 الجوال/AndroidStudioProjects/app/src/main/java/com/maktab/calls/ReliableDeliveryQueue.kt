package com.maktab.calls

import android.content.Context
import org.json.JSONObject

/** Server ACK and each destination's status are distinct and survive process recreation. */
internal class ReliableDeliveryQueue(context: Context,private val clock: () -> Long = System::currentTimeMillis) {
    private val store = CallStore.get(context)
    init {
        store.writableDatabase.execSQL("CREATE TABLE IF NOT EXISTS https_delivery(id TEXT PRIMARY KEY, timestamp INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'QUEUED', retries INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '', dispatch TEXT NOT NULL DEFAULT 'PENDING', grid TEXT NOT NULL DEFAULT 'PENDING')")
    }
    @Synchronized fun due(id: String, timestamp: Long, now: Long = clock()): Boolean {
        store.writableDatabase.execSQL("INSERT OR IGNORE INTO https_delivery(id,timestamp) VALUES(?,?)", arrayOf<Any>(id, timestamp))
        return store.readableDatabase.rawQuery("SELECT next_attempt FROM https_delivery WHERE id=?", arrayOf(id)).use { it.moveToFirst() && it.getLong(0) <= now }
    }
    @Synchronized fun failure(id: String, error: String) {
        val count = store.readableDatabase.rawQuery("SELECT retries FROM https_delivery WHERE id=?", arrayOf(id)).use { if(it.moveToFirst()) it.getInt(0)+1 else 1 }
        // Live delivery expires after five minutes. An hour-long transport backoff
        // guarantees expiry even when connectivity returns while the call is fresh.
        val delay = (1_000L * (1L shl count.coerceAtMost(5))).coerceAtMost(30_000L)
        store.writableDatabase.execSQL("UPDATE https_delivery SET retries=?,next_attempt=?,error=? WHERE id=?", arrayOf<Any>(count,clock()+delay,error.take(200),id))
        store.setState("last_error", "$error; eventId=$id")
        store.log(status="DELIVERY_FAILED",detail="eventId=$id; $error")
        store.log(status="RETRY_SCHEDULED",detail="eventId=$id; delayMs=$delay; retry=$count")
    }
    @Synchronized fun acknowledged(id: String, response: JSONObject) {
        require(response.optString("eventId") == id && response.optBoolean("serverAcknowledged")) { "INVALID_SERVER_ACK" }
        store.writableDatabase.execSQL("UPDATE https_delivery SET status='SERVER_ACK',next_attempt=0,error='',dispatch=?,grid=? WHERE id=?", arrayOf(response.getString("dispatchPro"),response.getString("gridCms"),id))
        store.log(status="SERVER_ACK",detail="eventId=$id; destination delivery is independent")
        update(id,response)
    }
    @Synchronized fun update(id: String, response: JSONObject) {
        require(response.optString("eventId") == id)
        val dispatch=response.getString("dispatchPro");val grid=response.getString("gridCms")
        store.writableDatabase.execSQL("UPDATE https_delivery SET dispatch=?,grid=? WHERE id=?",arrayOf(dispatch,grid,id))
        store.setState("dispatch_delivery",dispatch);store.setState("grid_delivery",grid)
        if(dispatch=="EXPIRED" || grid=="EXPIRED") {
            store.setState("last_error","DELIVERY_WINDOW_EXCEEDED; eventId=$id; dispatch=$dispatch; grid=$grid")
            store.log(status="DELIVERY_EXPIRED",detail="eventId=$id; live display window exceeded; dispatch=$dispatch; grid=$grid")
        }
        if(dispatch=="DELIVERED") store.log(status="DISPATCHPRO_DELIVERED",detail="eventId=$id")
        if(grid=="RECEIVER_ACK" || grid=="UDP_SENT") store.log(status="GRIDCMS_DELIVERED",detail="eventId=$id; level=$grid; visibleConfirmed=${response.optBoolean("gridVisibleConfirmed")}")
    }
    fun awaiting(): List<String> = store.readableDatabase.rawQuery("SELECT id FROM https_delivery WHERE status='SERVER_ACK' AND timestamp>? AND (dispatch='PENDING' OR grid='PENDING') ORDER BY timestamp DESC LIMIT 50",arrayOf((clock()-24L*60*60*1000).toString())).use {
        buildList { while(it.moveToNext()) add(it.getString(0)) }
    }
    fun expire(id: String, pkg: String, phone: String) {
        store.writableDatabase.execSQL("UPDATE https_delivery SET status='EXPIRED',dispatch='EXPIRED',grid='EXPIRED' WHERE id=?",arrayOf(id))
        store.expire(id)
        store.log(pkg,phone,"DELIVERY_FAILED","eventId=$id; reason=RETENTION_24H_EXCEEDED; never displayed as a current call")
    }
    fun prune() {
        // Only this app's delivery history; outbox rows are kept until ACK/explicit expiry.
        store.writableDatabase.execSQL("DELETE FROM https_delivery WHERE timestamp<? AND status!='QUEUED'",arrayOf(System.currentTimeMillis()-30L*24*60*60*1000))
    }
}
