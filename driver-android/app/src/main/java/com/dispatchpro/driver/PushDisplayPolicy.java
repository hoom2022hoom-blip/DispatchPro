package com.dispatchpro.driver;
import java.util.Map;

/** Additional display data is accepted only after PushEnvelopePolicy binds the account. */
public final class PushDisplayPolicy {
 private PushDisplayPolicy() {}
 public static boolean guid(String value) { return value != null && value.matches("[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}"); }
 public static long number(String value) { try { return Long.parseLong(value); } catch (Exception ignored) { return 0; } }
 public static boolean missedEligible(boolean active, boolean terminal, boolean declined, boolean confirmedExpired) {
  return active && !declined && (confirmedExpired || !terminal);
 }
 public static boolean visible(Map<String,String> data, long now) {
  if (!"1".equals(data.get("displayVersion")) || !guid(data.get("rideId")) || !guid(data.get("eventId"))) return false;
  String type = data.get("type");
  if ("CALL_END".equals(type)) return number(data.get("revision")) > 1;
  if (!"CALL".equals(type) && !"ARRIVED".equals(type)) return false;
  long created = number(data.get("createdAt")), expires = number(data.get("expiresAt"));
  return created > 0 && created <= now + 120000 && now - created <= 600000 && expires > now && expires <= now + 120000;
 }
 public static String name(String value) {
  if (value == null) return "طرف الرحلة";
  value = value.replaceAll("[\\p{Cntrl}\\u202A-\\u202E\\u2066-\\u2069]", "").trim();
  return value.isEmpty() ? "طرف الرحلة" : value.substring(0, Math.min(80, value.length()));
 }
}
