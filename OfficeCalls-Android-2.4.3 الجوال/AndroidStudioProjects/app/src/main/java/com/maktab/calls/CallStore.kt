package com.maktab.calls

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject
import java.util.UUID

/** Durable queue and call identities; ACK deletes only the outbox row, never the active identity. */
internal class CallStore(context: Context) : SQLiteOpenHelper(context, "office_call_events.db", null, 6) {
    private val app = context.applicationContext
    companion object {
        @Volatile private var instance: CallStore? = null
        fun get(context: Context): CallStore {
            val appContext = context.applicationContext
            return instance?.takeIf { it.app === appContext } ?: synchronized(this) {
                instance?.takeIf { it.app === appContext } ?: CallStore(appContext).also { instance = it }
            }
        }
    }
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE sessions(id TEXT PRIMARY KEY, package TEXT, number TEXT, touched INTEGER, queued INTEGER NOT NULL DEFAULT 0, caller_name TEXT NOT NULL DEFAULT '', identities TEXT NOT NULL DEFAULT '[]', first_seen INTEGER NOT NULL DEFAULT 0, phase TEXT NOT NULL DEFAULT 'ENRICHING', sent INTEGER NOT NULL DEFAULT 0, acknowledged INTEGER NOT NULL DEFAULT 0, notification_group TEXT NOT NULL DEFAULT '')")
        db.execSQL("CREATE TABLE aliases(key TEXT PRIMARY KEY, session TEXT, summary INTEGER NOT NULL DEFAULT 0)")
        db.execSQL("CREATE TABLE outbox(id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
        db.execSQL("CREATE TABLE diagnostics(id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER, package TEXT, number TEXT, status TEXT, detail TEXT)")
        db.execSQL("CREATE TABLE state(key TEXT PRIMARY KEY, value TEXT)")
        db.execSQL("CREATE TABLE delivery(id TEXT PRIMARY KEY, sent INTEGER NOT NULL DEFAULT 0)")
        db.execSQL("CREATE TABLE call_metadata(id TEXT PRIMARY KEY, original_phone TEXT NOT NULL DEFAULT '', extraction_source TEXT NOT NULL DEFAULT '', call_state TEXT NOT NULL DEFAULT 'RINGING')")
        db.execSQL("CREATE TABLE call_history(id TEXT PRIMARY KEY, payload TEXT NOT NULL, acknowledged INTEGER NOT NULL DEFAULT 0)")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) db.execSQL("ALTER TABLE aliases ADD COLUMN summary INTEGER NOT NULL DEFAULT 0")
        if (oldVersion < 3) {
            // All v2 sessions were created together with their queue event (including already ACKed events).
            db.execSQL("ALTER TABLE sessions ADD COLUMN queued INTEGER NOT NULL DEFAULT 1")
            db.execSQL("CREATE TABLE delivery(id TEXT PRIMARY KEY, sent INTEGER NOT NULL DEFAULT 0)")
        }
        if (oldVersion < 4 && newVersion >= 4) {
            db.execSQL("ALTER TABLE sessions ADD COLUMN caller_name TEXT NOT NULL DEFAULT ''")
            db.execSQL("ALTER TABLE sessions ADD COLUMN identities TEXT NOT NULL DEFAULT '[]'")
            db.execSQL("ALTER TABLE sessions ADD COLUMN first_seen INTEGER NOT NULL DEFAULT 0")
            db.execSQL("ALTER TABLE sessions ADD COLUMN phase TEXT NOT NULL DEFAULT 'ENRICHING'")
            db.execSQL("ALTER TABLE sessions ADD COLUMN sent INTEGER NOT NULL DEFAULT 0")
            db.execSQL("ALTER TABLE sessions ADD COLUMN acknowledged INTEGER NOT NULL DEFAULT 0")
            db.execSQL("UPDATE sessions SET first_seen=touched, phase=CASE WHEN queued=1 THEN 'QUEUED' ELSE 'ENRICHING' END")
            db.execSQL("UPDATE sessions SET sent=1,phase='SENT' WHERE id IN (SELECT id FROM delivery WHERE sent=1)")
            db.execSQL("UPDATE sessions SET sent=1,acknowledged=1,phase='ACK' WHERE queued=1 AND id NOT IN (SELECT id FROM outbox)")
        }
        if(oldVersion<5 && newVersion>=5) db.execSQL("CREATE TABLE call_metadata(id TEXT PRIMARY KEY, original_phone TEXT NOT NULL DEFAULT '', extraction_source TEXT NOT NULL DEFAULT '', call_state TEXT NOT NULL DEFAULT 'RINGING')")
        if(oldVersion<6) {
            db.execSQL("CREATE TABLE call_history(id TEXT PRIMARY KEY, payload TEXT NOT NULL, acknowledged INTEGER NOT NULL DEFAULT 0)")
            db.execSQL("INSERT INTO call_history(id,payload) SELECT id,payload FROM outbox")
            db.execSQL("ALTER TABLE sessions ADD COLUMN notification_group TEXT NOT NULL DEFAULT ''")
        }
    }

    /** Persist identity as soon as ringing starts, even before a number becomes readable. */
    @Synchronized fun observe(pkg: String, key: String, now: Long, groupSummary: Boolean = false,
        numberHint: String = "", create: Boolean = true, callerName: String = "", strictAliases: Boolean=false, notificationGroup: String="", eventTime: Long=now): String? {
        val db = writableDatabase
        db.beginTransaction()
        try {
            // Inactivity is a fallback for missed lifecycle callbacks, never a number cooldown.
            val stale = db.rawQuery("SELECT id FROM sessions WHERE touched<?", arrayOf((now - 5*60*1000L).toString())).use {
                buildList { while (it.moveToNext()) add(it.getString(0)) }
            }
            stale.forEach { db.execSQL("DELETE FROM aliases WHERE session=?", arrayOf(it)) }
            finishOrphans("SESSION_INACTIVITY_TIMEOUT")
            var id = db.rawQuery("SELECT s.id FROM sessions s JOIN aliases a ON a.session=s.id WHERE a.key=? AND s.package=?", arrayOf(key, pkg)).use {
                if (it.moveToFirst()) it.getString(0) else null
            }
            if (id == null) {
                val compatible = db.rawQuery("SELECT id,caller_name FROM sessions WHERE package=? AND (?='' OR number='' OR number=?) AND (?='0' OR (notification_group=? AND ?!='' AND (?='1' OR NOT EXISTS(SELECT 1 FROM aliases WHERE session=sessions.id AND summary=0))))", arrayOf(pkg, numberHint, numberHint,if(strictAliases) "1" else "0",notificationGroup,notificationGroup,if(groupSummary) "1" else "0")).use {
                    buildList { while (it.moveToNext()) {
                        val previous=it.getString(1)
                        if(callerName.isBlank() || previous.isBlank() || ContactIndex.matchingKey(callerName)==ContactIndex.matchingKey(previous)) add(it.getString(0))
                    } }
                }
                id = compatible.singleOrNull()
            }
            if (id == null && create) {
                id = UUID.randomUUID().toString()
                db.execSQL("INSERT INTO sessions(id,package,number,touched,queued) VALUES(?,?,?,?,0)", arrayOf<Any?>(id, pkg, "", now))
                db.execSQL("UPDATE sessions SET first_seen=?,caller_name=? WHERE id=?", arrayOf<Any?>(eventTime,callerName.take(160),id))
                db.execSQL("UPDATE sessions SET notification_group=? WHERE id=?",arrayOf(notificationGroup,id))
                log(pkg,status="SESSION_CREATED",detail="sessionId=$id; eventId=$id")
                log(pkg,status="CALL_DETECTED",detail="sessionId=$id; package=$pkg; notificationKey=${key.take(140)}")
                log(pkg, status = "CALL_SESSION_STARTED", detail = "eventId=$id")
                // Use this transaction's helper, not the global helper (also supports independent
                // database handles during restart/tests without a nested SQLite writer).
                setState("trace_call_session_created",System.currentTimeMillis().toString())
                log(pkg,status="CALL_SESSION_CREATED",detail="eventId=$id; process=${BackgroundRuntime.processId}; activityForeground=${BackgroundRuntime.foreground}")
            }
            if (id != null) {
                db.execSQL("UPDATE sessions SET touched=? WHERE id=?", arrayOf<Any?>(now, id))
                db.execSQL("INSERT OR REPLACE INTO aliases VALUES(?,?,?)", arrayOf<Any?>(key, id, if (groupSummary) 1 else 0))
                if(strictAliases) checkpoint(id) // The detected call and outbox commit together.
            }
            db.setTransactionSuccessful()
            return id
        } finally { db.endTransaction() }
    }

    data class CallSession(val sessionId: String, val packageName: String, val callerName: String,
        val candidateIdentities: List<String>, val phone: String, val firstSeen: Long, val lastSeen: Long,
        val sent: Boolean, val acknowledged: Boolean, val state: String,
        val originalPhone: String="", val extractionSource: String="", val callState: String="RINGING", val notificationKeys: List<String> = emptyList())
    @Synchronized fun session(id: String): CallSession? = readableDatabase.rawQuery(
        "SELECT package,caller_name,identities,number,first_seen,touched,sent,acknowledged,phase FROM sessions WHERE id=?",arrayOf(id)).use {
        if(!it.moveToFirst()) null else {
            val names=org.json.JSONArray(it.getString(2))
            val metadata=readableDatabase.rawQuery("SELECT original_phone,extraction_source,call_state FROM call_metadata WHERE id=?",arrayOf(id)).use {m->if(m.moveToFirst())listOf(m.getString(0),m.getString(1),m.getString(2)) else listOf("","","RINGING")}
            val keys=readableDatabase.rawQuery("SELECT key FROM aliases WHERE session=?",arrayOf(id)).use {a->buildList {while(a.moveToNext())add(a.getString(0))}}
            CallSession(id,it.getString(0),it.getString(1),List(names.length()) {i->names.getString(i)},it.getString(3),it.getLong(4),it.getLong(5),it.getInt(6)!=0,it.getInt(7)!=0,it.getString(8),metadata[0],metadata[1],metadata[2],keys)
        }
    }
    @Synchronized fun metadata(id: String, original: String, source: String, callState: String) {
        val safeOriginal=original.takeIf {PhoneNormalizer.normalize(it).isNotBlank()}.orEmpty().take(160)
        writableDatabase.execSQL("INSERT OR REPLACE INTO call_metadata VALUES(?,?,?,?)",arrayOf(id,safeOriginal,source.take(100),callState))
    }
    @Synchronized fun enrich(id: String, names: List<String>, now: Long) {
        val session=session(id) ?: return
        val identities=(session.candidateIdentities+names).filter(String::isNotBlank).distinctBy(ContactIndex::matchingKey).map {it.take(160)}.take(8)
        val caller=names.firstOrNull { it.isNotBlank() }?.take(160) ?: session.callerName.ifBlank {identities.firstOrNull().orEmpty()}
        writableDatabase.execSQL("UPDATE sessions SET caller_name=?,identities=?,touched=? WHERE id=?",arrayOf<Any?>(caller,org.json.JSONArray(identities).toString(),now,id))
        updateLastCall(id,PhoneNormalizer.normalize(session.phone),caller,session.packageName,session.firstSeen)
        log(session.packageName,status="SESSION_ENRICHED",detail="sessionId=$id; eventId=$id; candidateIdentities=${identities.size}; state=${session.state}; sent=${session.sent}; acknowledged=${session.acknowledged}")
    }

    @Synchronized fun capture(pkg: String, key: String, number: String, now: Long, groupSummary: Boolean = false): Boolean {
        require(CallPhoneNumber.normalize(number) == number && number.isNotBlank())
        val db = writableDatabase
        db.beginTransaction()
        try {
            val id = observe(pkg, key, now, groupSummary, number)!!
            val session = db.rawQuery("SELECT number,queued FROM sessions WHERE id=?", arrayOf(id)).use { it.moveToFirst(); it.getString(0) to it.getInt(1) }
            if (session.first.isNotBlank() && session.first != number) {
                log(pkg, status = "EXTRACTION_FAILED", detail = "reason=SESSION_IDENTITY_CONFLICT; eventId=$id")
                db.setTransactionSuccessful()
                return false
            }
            if (session.second != 0 && session.first.isBlank()) {
                val changed=publish(id,number)
                db.setTransactionSuccessful()
                return changed
            }
            val duplicate = session.second != 0
            if (!duplicate) {
                db.execSQL("UPDATE sessions SET number=?,queued=1,touched=? WHERE id=?", arrayOf<Any?>(number, now, id))
                db.execSQL("UPDATE sessions SET phase='QUEUED' WHERE id=?",arrayOf(id))
                val payload = JSONObject().apply {
                    put("eventId", id); put("type", "incoming_call"); putPhone(this, number)
                    put("displayName", ""); put("package", pkg); put("timestamp", session(id)!!.firstSeen)
                    put("officeId", DevicePairingManager.office(app).ifBlank {state("queue_owner_office")})
                    put("device", "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}")
                    put("revision",1);put("deviceId",LocalReceiverTransport.deviceId(app))
                    put("originalPhone",session(id)?.originalPhone.orEmpty());put("resolutionSource",session(id)?.extractionSource.orEmpty())
                    put("confidence","HIGH");put("failureReason","")
                }
                db.execSQL("INSERT INTO outbox VALUES(?,?)", arrayOf(id, payload.toString()))
                db.execSQL("INSERT OR REPLACE INTO call_history VALUES(?,?,0)",arrayOf(id,payload.toString()))
                db.execSQL("INSERT OR REPLACE INTO state VALUES('last_call',?)", arrayOf(PhoneNormalizer.normalize(number)))
                setState("last_call_time",session(id)!!.firstSeen.toString())
            }
            log(pkg, number, if (duplicate) "DUPLICATE_IGNORED" else "QUEUED", "eventId=$id; sessionId=$id; ${if(duplicate) "scope=TCP_SEND_ONLY; extraction=ALREADY_ENRICHED" else "state=QUEUED"}")
            db.setTransactionSuccessful()
            return !duplicate
        } finally { db.endTransaction() }
    }
    /** Revisioned outbox supports missing-number events and enrichment AFTER the first ACK. */
    @Synchronized fun checkpoint(id: String) {
        val exists=readableDatabase.rawQuery("SELECT 1 FROM call_history WHERE id=?",arrayOf(id)).use {it.moveToFirst()}
        if(!exists) publish(id,reason="RESOLUTION_PENDING")
    }
    @Synchronized fun publish(id: String, phone: String="", source: String="", reason: String=""): Boolean {
        val db=writableDatabase;db.beginTransaction()
        try {
            val s=session(id) ?: return false
            val old=db.rawQuery("SELECT payload FROM call_history WHERE id=?",arrayOf(id)).use {if(it.moveToFirst()) JSONObject(it.getString(0)) else null}
            val number=phone.ifBlank {s.phone}
            if(old!=null && old.optString("number").isNotBlank()) return false
            if(old!=null && number.isBlank() && old.optString("failureReason")==reason && old.optString("displayName")==s.callerName) return false
            val revision=(old?.optInt("revision",0) ?: 0)+1
            val body=JSONObject().apply {
                put("eventId",id);put("deviceId",LocalReceiverTransport.deviceId(app));put("revision",revision);put("type","incoming_call")
                putPhone(this,number);put("displayName",s.callerName);put("package",s.packageName);put("timestamp",s.firstSeen)
                put("device","${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}")
                put("originalPhone",s.originalPhone);put("resolutionSource",source.ifBlank {s.extractionSource})
                put("confidence",if(number.isBlank()) "NONE" else "HIGH");put("failureReason",if(number.isBlank()) reason else "")
                put("officeId",DevicePairingManager.office(app).ifBlank {state("queue_owner_office")})
            }.toString()
            db.execSQL("INSERT OR REPLACE INTO outbox VALUES(?,?)",arrayOf(id,body))
            db.execSQL("INSERT OR REPLACE INTO call_history VALUES(?,?,0)",arrayOf(id,body))
            db.execSQL("UPDATE sessions SET queued=1,number=?,phase='QUEUED',acknowledged=0 WHERE id=?",arrayOf(number,id))
            updateLastCall(id,PhoneNormalizer.normalize(number),s.callerName,s.packageName,s.firstSeen)
            log(s.packageName,status="QUEUED",detail="eventId=$id; revision=$revision; resolved=${number.isNotBlank()}")
            db.setTransactionSuccessful();return true
        } finally {db.endTransaction()}
    }
    @Synchronized fun confirmedCount(): Int = readableDatabase.rawQuery("SELECT count(*) FROM call_history WHERE acknowledged=1",null).use {it.moveToFirst();it.getInt(0)}
    private fun updateLastCall(id: String, phone: String, name: String, pkg: String, time: Long) {
        if (time < (state("last_call_time").toLongOrNull() ?: 0L)) return
        setState("last_call_id",id);setState("last_call",phone);setState("last_call_name",name)
        setState("last_call_source",pkg);setState("last_call_time",time.toString())
    }
    /** Revisit only unresolved pending identities; never guess, rewrite time, or change event ID. */
    @Synchronized fun resolvePendingContacts() {
        if (!ContactIndex.permissionGranted(app)) return
        for ((id, snapshot) in pending()) {
            val payload=JSONObject(snapshot)
            if (payload.optString("number").isNotBlank() || payload.optString("displayName").isBlank()) continue
            val result=ContactIndex.lookupResult(app,payload.getString("displayName"))
            if (result.status != ContactIndex.Status.CONTACT_RESOLVED || result.phone.isBlank()) continue
            val body=JSONObject(snapshot).also { putPhone(it,result.phone) }
                .put("revision",payload.optInt("revision",1)+1).put("resolutionSource","PHONE_FROM_CONTACTS")
                .put("confidence","HIGH").put("failureReason","").toString()
            val db=writableDatabase;db.beginTransaction()
            try {
                val values=android.content.ContentValues().apply {put("payload",body)}
                if (db.update("outbox",values,"id=? AND payload=?",arrayOf(id,snapshot))==1) {
                    db.execSQL("INSERT OR REPLACE INTO call_history VALUES(?,?,0)",arrayOf(id,body))
                    db.execSQL("UPDATE sessions SET number=?,acknowledged=0,phase='QUEUED' WHERE id=?",arrayOf(result.phone,id))
                    updateLastCall(id,PhoneNormalizer.normalize(result.phone),payload.optString("displayName"),payload.getString("package"),payload.getLong("timestamp"))
                    log(payload.getString("package"),result.phone,"PENDING_CONTACT_RESOLVED","eventId=$id; matching=UNIQUE_SAFE_CONTACT; originalTimeRetained=true")
                }
                db.setTransactionSuccessful()
            } finally {db.endTransaction()}
        }
    }
    private fun putPhone(body: JSONObject, identity: String) {
        val phone=PhoneNormalizer.parse(identity)
        body.put("number",phone?.display.orEmpty()).put("caller",phone?.display.orEmpty())
            .put("phoneIdentity",phone?.identity.orEmpty()).put("phoneE164",phone?.e164.orEmpty())
            .put("phoneFormatReason",phone?.reason.orEmpty())
    }
    @Synchronized fun history(): List<JSONObject> = readableDatabase.rawQuery("SELECT payload,acknowledged FROM call_history",null).use {
        buildList {while(it.moveToNext())add(JSONObject(it.getString(0)).put("acknowledged",it.getInt(1)==1))}
            .sortedByDescending {it.optLong("timestamp")}.take(200)
    }
    @Synchronized fun pruneHistory() {
        val days=app.getSharedPreferences(NetworkSender.PREFS_NAME,0).getInt("history_days",30).coerceIn(1,365)
        val cutoff=System.currentTimeMillis()-days*86400000L
        val expired=readableDatabase.rawQuery("SELECT id,payload FROM call_history WHERE acknowledged=1 AND id NOT IN (SELECT id FROM sessions) AND id NOT IN (SELECT id FROM outbox)",null).use {cursor->
            buildList {while(cursor.moveToNext())if(runCatching {JSONObject(cursor.getString(1)).optLong("timestamp")<cutoff}.getOrDefault(false))add(cursor.getString(0))}
        }
        expired.forEach {writableDatabase.delete("call_history","id=?",arrayOf(it))}
    }
    @Synchronized fun removed(key: String) {
        val db = writableDatabase
        db.beginTransaction()
        try {
        val row = db.rawQuery("SELECT session,summary FROM aliases WHERE key=?", arrayOf(key)).use { if (it.moveToFirst()) it.getString(0) to it.getInt(1) else null }
        db.execSQL("DELETE FROM aliases WHERE key=?", arrayOf(key))
        // A lingering group summary must not swallow the next real call after its child is removed.
        if (row != null && row.second == 0) {
            db.execSQL("DELETE FROM aliases WHERE session=? AND NOT EXISTS (SELECT 1 FROM aliases WHERE session=? AND summary=0)", arrayOf(row.first, row.first))
        }
        finishOrphans("NOTIFICATION_REMOVED")
        db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
    @Synchronized fun ended(key: String, pkg: String = "") {
        val db = writableDatabase
        db.beginTransaction()
        try {
        observe(pkg, key, System.currentTimeMillis(), create = false)
        db.execSQL("DELETE FROM aliases WHERE session IN (SELECT session FROM aliases WHERE key=?)", arrayOf(key))
        finishOrphans("TERMINAL_CALL_NOTIFICATION")
        db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
    private fun finishOrphans(reason: String) {
        val closed = writableDatabase.rawQuery("SELECT id,package FROM sessions WHERE id NOT IN (SELECT session FROM aliases)", null).use {
            buildList { while (it.moveToNext()) add(it.getString(0) to it.getString(1)) }
        }
        closed.forEach { (id, pkg) ->
            if (session(id)?.phone.isNullOrBlank()) log(pkg,status="PHONE_NOT_EXPOSED",detail="sessionId=$id; reason=NO_NUMBER_BEFORE_SESSION_END; endReason=$reason")
            log(pkg,status="SESSION_ENDED",detail="sessionId=$id; eventId=$id; reason=$reason")
            log(pkg, status = "CALL_FINISHED", detail = "eventId=$id; reason=$reason")
        }
        writableDatabase.execSQL("DELETE FROM sessions WHERE id NOT IN (SELECT session FROM aliases)")
        writableDatabase.execSQL("DELETE FROM call_metadata WHERE id NOT IN (SELECT id FROM sessions)")
    }
    /** Reboot ends physical calls; preserve unacknowledged events but retire stale call identities. */
    @Synchronized fun deviceBoot() {
        val db=writableDatabase
        db.beginTransaction()
        try {
            db.execSQL("DELETE FROM aliases")
            finishOrphans("DEVICE_REBOOT")
            db.execSQL("INSERT OR REPLACE INTO state VALUES('last_probe_status','')")
            log(status="BOOT_STATE_RESTORED",detail="pendingEvents=${pending().size}; outbox retained; old call identities closed")
            db.setTransactionSuccessful()
        } finally {db.endTransaction()}
    }
    @Synchronized fun reconcile(keys: Set<String>) {
        val stale = readableDatabase.rawQuery("SELECT key FROM aliases", null).use { cursor ->
            buildList { while (cursor.moveToNext()) if (cursor.getString(0) !in keys) add(cursor.getString(0)) }
        }
        stale.forEach(::removed)
    }
    @Synchronized fun pending(): List<Pair<String, String>> = readableDatabase.rawQuery("SELECT id,payload FROM outbox ORDER BY rowid", null).use {
        buildList { while (it.moveToNext()) add(it.getString(0) to it.getString(1)) }
    }
    @Synchronized fun expire(id: String) {
        val db=writableDatabase
        db.beginTransaction()
        try {
            db.execSQL("DELETE FROM outbox WHERE id=?",arrayOf(id))
            db.execSQL("UPDATE sessions SET phase='EXPIRED' WHERE id=?",arrayOf(id))
            db.setTransactionSuccessful()
        } finally {db.endTransaction()}
    }
    @Synchronized fun ack(id: String, pkg: String, number: String, target: String = "", expectedPayload: String? = null) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            if (db.delete("outbox", if(expectedPayload==null) "id=?" else "id=? AND payload=?", if(expectedPayload==null) arrayOf(id) else arrayOf(id,expectedPayload)) == 0) { db.setTransactionSuccessful(); return }
            db.execSQL("UPDATE call_history SET acknowledged=1 WHERE id=?",arrayOf(id))
            db.delete("delivery", "id=?", arrayOf(id))
            db.execSQL("UPDATE sessions SET acknowledged=1,phase='ACK' WHERE id=?",arrayOf(id))
            db.execSQL("INSERT OR REPLACE INTO state VALUES('last_ack',?)", arrayOf("${System.currentTimeMillis()} | $id"))
            db.execSQL("INSERT OR REPLACE INTO state VALUES('last_ack_target',?)", arrayOf(target))
            setState("last_ack_number",number);setState("last_ack_time",System.currentTimeMillis().toString())
            log(pkg, number, "ACK", "eventId=$id")
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
    @Synchronized fun sending(id: String, pkg: String, number: String) {
        val db = writableDatabase
        val sent = db.rawQuery("SELECT sent FROM delivery WHERE id=?", arrayOf(id)).use { it.moveToFirst() && it.getInt(0) == 1 }
        db.execSQL("INSERT OR REPLACE INTO delivery VALUES(?,1)", arrayOf(id))
        db.execSQL("UPDATE sessions SET sent=1,phase='SENT' WHERE id=?",arrayOf(id))
        setState("last_send_number",number);setState("last_send_time",System.currentTimeMillis().toString());setState("last_send_event",id)
        log(pkg, number, if (sent) "RETRY_ATTEMPT" else "SENT", "eventId=$id; awaiting ACK")
    }
    @Synchronized fun log(pkg: String = "", number: String = "", status: String, detail: String = "") {
        writableDatabase.execSQL("INSERT INTO diagnostics(time,package,number,status,detail) VALUES(?,?,?,?,?)",
            arrayOf<Any>(System.currentTimeMillis(), pkg, if(number.isBlank()) "" else "***${number.takeLast(3)}", status, maskedDetail(detail)))
        writableDatabase.execSQL("DELETE FROM diagnostics WHERE id NOT IN (SELECT id FROM diagnostics ORDER BY id DESC LIMIT 200)")
        app.sendBroadcast(android.content.Intent("com.maktab.calls.DIAGNOSTICS_CHANGED").setPackage(app.packageName))
    }
    @Synchronized fun logs(): List<String> = readableDatabase.rawQuery("SELECT time,package,number,status,detail FROM diagnostics ORDER BY id DESC LIMIT 200", null).use {
        buildList { while (it.moveToNext()) add("${CallTime.format(it.getLong(0),true)} Asia/Hebron | ${if (it.getString(1) == "com.whatsapp.w4b") "WhatsApp Business" else if (it.getString(1) == "com.whatsapp") "WhatsApp" else "OfficeCalls"}\n${it.getString(2)} ${it.getString(3)}\n${it.getString(4)}") }
    }
    @Synchronized fun clearLog() { writableDatabase.delete("diagnostics", null, null) }
    private fun maskedDetail(detail: String): String {
        val protected=mutableListOf<String>()
        val text=detail.take(2400).replace(Regex("[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}")) {protected.add(it.value);"EVENTREF_${protected.lastIndex}_END"}
            .replace(Regex("(?i)(?:rawCallerName|normalizedCallerName|rawWhatsAppName|normalizedWhatsAppName)=\"[^\"]*\""),"callerName=REDACTED")
            .replace(Regex("(?<![A-Za-z])[+\\p{Nd}][\\p{Nd} ()\\p{Pd}\\p{Zs}\\p{Cf}]{4,}[\\p{Nd}]"),"REDACTED")
        return protected.foldIndexed(text) {index,result,id->result.replace("EVENTREF_${index}_END",id)}
    }
    @Synchronized fun state(key: String): String = readableDatabase.rawQuery("SELECT value FROM state WHERE key=?", arrayOf(key)).use { if (it.moveToFirst()) it.getString(0) else "" }
    @Synchronized fun setState(key: String, value: String) {
        writableDatabase.execSQL("INSERT OR REPLACE INTO state VALUES(?,?)",arrayOf(key,value))
    }
    @Synchronized fun removeState(key: String) { writableDatabase.delete("state", "key=?", arrayOf(key)) }
}
