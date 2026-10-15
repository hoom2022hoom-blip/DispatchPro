package com.dispatchpro.driver;

import android.os.SystemClock;
import org.json.JSONObject;

/** Display state expires independently of JavaScript/background timers. */
final class VoiceNotice {
 private String name="",channel="";private boolean connected;private long expires;
 long update(JSONObject value){
  name=value.optString("name").replaceAll("[\\p{Cntrl}]","");if(name.length()>100)name=name.substring(0,100);
  channel=value.optString("channel");connected=value.optBoolean("connected");
  long remaining=Math.max(0,Math.min(6000,value.optLong("expiresInMs")));
  expires=SystemClock.elapsedRealtime()+remaining;return remaining;
 }
 String text(String idle){
  if(!connected)return "جارٍ إعادة الاتصال بالمخشير";
  if(name.isEmpty()||SystemClock.elapsedRealtime()>=expires)return idle;
  return (channel.equals("private")?"خاص":"عام")+" · المتحدث: "+name;
 }
}
