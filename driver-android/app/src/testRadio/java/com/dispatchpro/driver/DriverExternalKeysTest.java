package com.dispatchpro.driver;
import android.os.SystemClock;
import android.view.KeyEvent;
import org.json.JSONObject;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;
@RunWith(RobolectricTestRunner.class) @Config(sdk=34)
public class DriverExternalKeysTest {
 MainActivity host;DriverExternalKeys keys;
 @Before public void setup(){host=Robolectric.buildActivity(MainActivity.class).get();host.getSharedPreferences("driver-external-ptt",0).edit().clear().commit();keys=new DriverExternalKeys(host);}
 @After public void close(){keys.close();}
 KeyEvent key(int action,int repeat,long down){return new KeyEvent(down,SystemClock.uptimeMillis(),action,KeyEvent.KEYCODE_HEADSETHOOK,repeat);}
 void assign()throws Exception{keys.configure(new JSONObject().put("action","learn"));long down=SystemClock.uptimeMillis();keys.key(key(KeyEvent.ACTION_DOWN,0,down),"Activity");SystemClock.sleep(200);keys.key(key(KeyEvent.ACTION_UP,0,down),"Activity");keys.configure(new JSONObject().put("action","save"));}
 @Test public void capturesPairPersistsChannelAndDoesNotTransmitInLearningOrTest()throws Exception{assertEquals(0,keys.info().getInt("keyCode"));assign();assertFalse(keys.held);keys.configure(new JSONObject().put("action","channel").put("channel","private"));DriverExternalKeys restored=new DriverExternalKeys(host);try{assertEquals(KeyEvent.KEYCODE_HEADSETHOOK,restored.info().getInt("keyCode"));assertEquals("private",restored.info().getString("channel"));}finally{restored.close();}keys.configure(new JSONObject().put("action","test"));keys.key(key(KeyEvent.ACTION_DOWN,0,SystemClock.uptimeMillis()),"MediaSession");assertFalse(keys.held);keys.configure(new JSONObject().put("action","clear"));assertEquals(0,keys.info().getInt("keyCode"));}
 @Test public void staleUpAndWrongDeviceCannotReleaseCurrentPressAndDisconnectReleases()throws Exception{assign();keys.held=true;keys.device=-1;keys.downTime=SystemClock.uptimeMillis()+10;keys.key(key(KeyEvent.ACTION_UP,0,keys.downTime-1),"MediaSession");assertTrue(keys.held);keys.key(key(KeyEvent.ACTION_UP,0,keys.downTime),"MediaSession");assertFalse(keys.held);keys.held=true;keys.onInputDeviceRemoved(2);assertTrue(keys.held);keys.onInputDeviceRemoved(-1);assertFalse(keys.held);keys.held=true;keys.expire.run();assertFalse(keys.held);}
 @Test public void rejectsProtectedKeysAndClickOnlyAndUnreadyRuntime()throws Exception{keys.configure(new JSONObject().put("action","learn"));assertFalse(keys.key(new KeyEvent(KeyEvent.ACTION_DOWN,KeyEvent.KEYCODE_POWER),"Activity"));long down=SystemClock.uptimeMillis();keys.key(key(KeyEvent.ACTION_DOWN,0,down),"Activity");keys.key(key(KeyEvent.ACTION_UP,0,down),"Activity");try{keys.configure(new JSONObject().put("action","save"));fail("short click saved");}catch(org.json.JSONException expected){}assign();assertFalse(keys.key(key(KeyEvent.ACTION_DOWN,0,SystemClock.uptimeMillis()),"Activity"));assertFalse(keys.held);}
}
