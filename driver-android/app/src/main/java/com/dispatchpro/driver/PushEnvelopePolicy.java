package com.dispatchpro.driver;
import java.util.Map;
/** Push carries opaque wake hints; local binding and server resync own identity/state. */
public final class PushEnvelopePolicy {
 private PushEnvelopePolicy(){}
 public static boolean accepts(Map<String,String> data,boolean bound,String installation,String recipient,boolean driver){
  if(!bound||installation.isEmpty()||recipient.isEmpty()||!installation.equals(data.get("installationId"))||!recipient.equals(data.get("recipient")))return false;
  String event=data.get("eventId");if(event==null||!event.matches("[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}"))return false;
  String type=data.get("type");return "CHAT".equals(type)||"CALL".equals(type)||"CALL_END".equals(type)||(driver?"DRIVER_REQUEST".equals(type):"ARRIVED".equals(type)||"ARRIVAL_ACK".equals(type)||"RIDE_STATUS".equals(type));
 }
}
