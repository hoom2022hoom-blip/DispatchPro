package com.dispatchpro.driver;

import android.content.Context;
import org.json.*;

/** Bounded local timing evidence. No audio, credentials, names or API bodies. */
final class VoiceDiagnostics {
 static synchronized void record(Context context,JSONObject input){
  String name=input.optString("name");if(!name.matches("[A-Za-z]{1,50}"))return;
  android.content.SharedPreferences preferences=context.getSharedPreferences("communication-metrics",0);
  android.content.SharedPreferences.Editor edit=preferences.edit().putLong(name,Math.max(0,input.optLong("ms"))).putLong("sampledAt",System.currentTimeMillis());
  try{
   JSONArray old=new JSONArray(preferences.getString("trace","[]")),trace=new JSONArray();
   for(int i=Math.max(0,old.length()-159);i<old.length();i++)trace.put(old.get(i));
   JSONObject point=new JSONObject().put("stage",name).put("ms",Math.max(0,input.optLong("ms"))).put("atMs",Math.max(0,input.optLong("atMs")));
   for(String key:new String[]{"sessionId","attemptId","floorId"}){String value=input.optString(key);if(value.matches("[A-Za-z0-9-]{1,64}"))point.put(key,value);}
   trace.put(point);edit.putString("trace",trace.toString());
  }catch(JSONException ignored){}
  edit.apply();
 }
}
