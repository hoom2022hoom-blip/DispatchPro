package com.maktab.calls

import android.content.Context
import android.content.ContextWrapper
import android.database.DatabaseErrorHandler
import android.database.sqlite.SQLiteDatabase
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RuntimeEnvironment
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class) @Config(sdk=[34])
class Upgrade310AndroidTest {
    @Test fun schemaFiveUpgradePreservesOldQueueIdentityAndSettings() = checkUpgrade(5)
    @Test fun reference252SchemaFourUpgradePreservesQueueAndOfficeSettings() = checkUpgrade(4)
    private fun checkUpgrade(oldSchema: Int) {
        val app=RuntimeEnvironment.getApplication()
        val context=object:ContextWrapper(app) {
            override fun getApplicationContext(): Context=this
            override fun getDatabasePath(name: String)=app.getDatabasePath("upgrade310_$name")
            override fun openOrCreateDatabase(name: String,mode: Int,factory: SQLiteDatabase.CursorFactory?): SQLiteDatabase = app.openOrCreateDatabase("upgrade310_$name",mode,factory)
            override fun openOrCreateDatabase(name: String,mode: Int,factory: SQLiteDatabase.CursorFactory?,handler: DatabaseErrorHandler?): SQLiteDatabase=app.openOrCreateDatabase("upgrade310_$name",mode,factory,handler)
        }
        app.deleteDatabase("upgrade310_office_call_events.db")
        val old=context.openOrCreateDatabase("office_call_events.db",0,null)
        old.execSQL("CREATE TABLE sessions(id TEXT PRIMARY KEY, package TEXT, number TEXT, touched INTEGER, queued INTEGER NOT NULL DEFAULT 0, caller_name TEXT NOT NULL DEFAULT '', identities TEXT NOT NULL DEFAULT '[]', first_seen INTEGER NOT NULL DEFAULT 0, phase TEXT NOT NULL DEFAULT 'ENRICHING', sent INTEGER NOT NULL DEFAULT 0, acknowledged INTEGER NOT NULL DEFAULT 0)")
        old.execSQL("CREATE TABLE aliases(key TEXT PRIMARY KEY, session TEXT, summary INTEGER NOT NULL DEFAULT 0)")
        old.execSQL("CREATE TABLE outbox(id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
        old.execSQL("CREATE TABLE diagnostics(id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER, package TEXT, number TEXT, status TEXT, detail TEXT)")
        old.execSQL("CREATE TABLE state(key TEXT PRIMARY KEY, value TEXT)")
        old.execSQL("CREATE TABLE delivery(id TEXT PRIMARY KEY, sent INTEGER NOT NULL DEFAULT 0)")
        if(oldSchema>=5) old.execSQL("CREATE TABLE call_metadata(id TEXT PRIMARY KEY, original_phone TEXT NOT NULL DEFAULT '', extraction_source TEXT NOT NULL DEFAULT '', call_state TEXT NOT NULL DEFAULT 'RINGING')")
        val id="old-event";val body=JSONObject().put("eventId",id).put("number","0591234567").put("package","com.whatsapp").put("timestamp",1000).toString()
        old.execSQL("INSERT INTO outbox VALUES(?,?)",arrayOf(id,body));old.execSQL("INSERT INTO state VALUES('preserved','yes')");old.version=oldSchema;old.close()
        val settings=app.getSharedPreferences(NetworkSender.PREFS_NAME,0)
        settings.edit().putString(NetworkSender.KEY_HOST,"192.168.1.8").putInt(NetworkSender.KEY_PORT,5050).commit()
        CallStore(context).use {upgraded->
            assertEquals(6,upgraded.writableDatabase.version);assertEquals(listOf(id to body),upgraded.pending());assertEquals("yes",upgraded.state("preserved"))
            assertEquals(0,upgraded.confirmedCount());upgraded.deviceBoot();assertEquals(listOf(id to body),upgraded.pending())
            assertEquals("192.168.1.8",settings.getString(NetworkSender.KEY_HOST,""));assertEquals(5050,settings.getInt(NetworkSender.KEY_PORT,0))
        }
        app.deleteDatabase("upgrade310_office_call_events.db")
    }
}
