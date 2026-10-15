package com.dispatchpro.driver;

import android.os.SystemClock;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class) @Config(sdk=34)
public class VoiceNoticeDiagnosticsTest {
 @Test public void speakerAndChannelExpireWithoutJavascriptAndConnectionLossClearsName()throws Exception{
  VoiceNotice notice=new VoiceNotice();JSONObject value=new JSONObject().put("connected",true).put("name","أحمد").put("channel","private").put("expiresInMs",6000);
  notice.update(value);assertEquals("خاص · المتحدث: أحمد",notice.text("متصل"));
  SystemClock.sleep(6001);assertEquals("متصل",notice.text("متصل"));
  notice.update(value.put("channel","public"));assertEquals("عام · المتحدث: أحمد",notice.text("متصل"));
  notice.update(value.put("connected",false));assertEquals("جارٍ إعادة الاتصال بالمخشير",notice.text("متصل"));
 }
 @Test public void tracesAreBoundedAndExcludeNamesTokensAndAudio()throws Exception{
  var context=RuntimeEnvironment.getApplication();context.getSharedPreferences("communication-metrics",0).edit().clear().commit();
  for(int i=0;i<180;i++)VoiceDiagnostics.record(context,new JSONObject().put("name","pttFloorGrantMs").put("ms",i).put("atMs",i).put("sessionId","session-1").put("attemptId","attempt-1").put("floorId","floor-1").put("token","secret").put("nameOfSpeaker","private-name").put("audio","audio-content"));
  JSONArray trace=new JSONArray(context.getSharedPreferences("communication-metrics",0).getString("trace","[]"));assertEquals(160,trace.length());assertEquals(20,trace.getJSONObject(0).getInt("ms"));
  assertEquals("attempt-1",trace.getJSONObject(159).getString("attemptId"));assertFalse(trace.toString().contains("secret"));assertFalse(trace.toString().contains("private-name"));assertFalse(trace.toString().contains("audio-content"));
 }
}
