package com.dispatchpro.driver;
import android.content.Context;
import java.util.Map;
import org.json.JSONObject;

/** Synchronous, network-free rendering within Firebase's callback lifetime. */
public final class NativeCommunicationPush {
 private NativeCommunicationPush() {}
 public static void display(Context c, Map<String,String> data) {
  long received = System.currentTimeMillis(), started = android.os.SystemClock.elapsedRealtime();
  c.getSharedPreferences("communication-metrics",0).edit().putLong("pushReceivedAt",received).apply();
  long serverNow = received + c.getSharedPreferences("communication-metrics",0).getLong("serverOffsetMs",0);
  if (!PushDisplayPolicy.visible(data, serverNow)) return;
  String type = data.get("type"), id = data.get("eventId");
  if ("ARRIVED".equals(type)) CustomerArrivalNotifications.show(c,id,data.get("rideId"),PushDisplayPolicy.name(data.get("peerName")));
  else if ("CALL_END".equals(type)) CommunicationNotifications.finishCall(c,id,PushDisplayPolicy.number(data.get("revision")));
  else if ("CALL".equals(type)) try {
   CommunicationNotifications.showIncoming(c,new JSONObject().put("id",id).put("rideId",data.get("rideId")).put("peerName",PushDisplayPolicy.name(data.get("peerName"))).put("state","ringing").put("caller",false).put("revision",PushDisplayPolicy.number(data.get("revision"))),PushDisplayPolicy.number(data.get("expiresAt"))-serverNow);
  } catch (Exception ignored) {}
  c.getSharedPreferences("communication-metrics",0).edit().putLong("pushDisplayMs",android.os.SystemClock.elapsedRealtime()-started).apply();
 }
}
