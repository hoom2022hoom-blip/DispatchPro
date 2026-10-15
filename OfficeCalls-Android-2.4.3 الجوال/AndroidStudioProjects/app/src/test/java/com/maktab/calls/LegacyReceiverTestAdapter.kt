package com.maktab.calls

import android.content.Context
import org.json.JSONObject
/** Explicit test double for the HTTPS boundary. The old loopback TCP fixtures still test Receiver ACK.
 * It is not a phone/TLS test. Production uses platform HttpsURLConnection and paired credentials. */
internal object LegacyReceiverTestAdapter {
    fun install(context: Context) {
        NetworkSender.clock={1000L}
        context.getSharedPreferences("officecalls3_credentials",Context.MODE_PRIVATE).edit().putString("office","11111111-1111-1111-1111-111111111111").commit()
        ReliableDeliveryQueue(context)
        CallStore.get(context).writableDatabase.delete("https_delivery",null,null)
        NetworkSender.transport={path,_,body ->
            require(path=="/events" && body!=null)
            val store=CallStore.get(context)
            val original=store.pending().single {it.first==body.getString("eventId")}
            val prefs=context.getSharedPreferences(NetworkSender.PREFS_NAME,Context.MODE_PRIVATE)
            require(prefs.getString(NetworkSender.KEY_HOST,"").orEmpty().isNotBlank()) {"RECEIVER_NOT_CONFIGURED_IN_TEST"}
            CallTcpTransport.send(prefs.getString(NetworkSender.KEY_HOST,"").orEmpty(),prefs.getInt(NetworkSender.KEY_PORT,5050),original.second,original.first)
            JSONObject().put("eventId",original.first).put("serverAcknowledged",true).put("dispatchPro","DELIVERED").put("gridCms","RECEIVER_ACK")
        }
    }
    fun reset(){NetworkSender.transport=OfficeHttpsTransport::request;NetworkSender.clock=System::currentTimeMillis}
    fun advanceRetry(context: Context){CallStore.get(context).writableDatabase.execSQL("UPDATE https_delivery SET next_attempt=0")}
}
