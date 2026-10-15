package com.dispatchpro.driver;
import android.content.*;
import android.hardware.input.InputManager;
import android.media.session.*;
import android.media.AudioManager;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.os.*;
import android.view.*;
import org.json.*;

/** Standard HID in the Activity; compatible down/up media buttons via MediaSession. */
final class DriverExternalKeys implements InputManager.InputDeviceListener {
 final MainActivity host;final SharedPreferences store;final Handler handler=new Handler(Looper.getMainLooper());final MediaSession media;
 String mode="";JSONObject candidate;boolean released,held;int device;long downTime;
 final Runnable expire=()->release();
 final AudioDeviceCallback audioDevices=new AudioDeviceCallback(){@Override public void onAudioDevicesRemoved(AudioDeviceInfo[] removed){if(removed.length>0)release();}};
 DriverExternalKeys(MainActivity host){this.host=host;ExternalPttOwner.listener=()->{release();active(host.externalReady());changed();};store=host.getSharedPreferences("driver-external-ptt",0);host.getSystemService(InputManager.class).registerInputDeviceListener(this,handler);host.getSystemService(AudioManager.class).registerAudioDeviceCallback(audioDevices,handler);media=new MediaSession(host,"NM Driver external PTT");media.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS);media.setCallback(new MediaSession.Callback(){@Override public boolean onMediaButtonEvent(Intent intent){KeyEvent e=intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT);return e!=null&&key(e,"MediaSession");}},handler);}
 static boolean allowed(int key){return key>0&&key!=3&&key!=4&&key!=5&&key!=6&&key!=24&&key!=25&&key!=164&&key!=26&&key!=82&&key!=187&&key!=223&&key!=224&&key!=219;}
 static boolean mediaKey(int key){return key==79||key==85||key==87||key==88||key==89||key==90||key==126||key==127||key==86;}
 void active(boolean value){value=value&&ExternalPttOwner.owns(host);media.setPlaybackState(new PlaybackState.Builder().setState(value?PlaybackState.STATE_PLAYING:PlaybackState.STATE_STOPPED,0,0).setActions(PlaybackState.ACTION_PLAY|PlaybackState.ACTION_PAUSE).build());media.setActive(value);if(!value)release();}
 JSONObject info()throws JSONException{return new JSONObject().put("owner",ExternalPttOwner.current(host)).put("keyCode",store.getInt("keyCode",0)).put("keyName",store.getString("keyName","")).put("device",store.getString("device","")).put("channel",store.getString("channel","public")).put("mode",mode).put("candidate",candidate==null?JSONObject.NULL:candidate).put("released",released).put("pressed",held);}
 void configure(JSONObject data)throws JSONException{release();String action=data.optString("action");if(data.has("owner"))ExternalPttOwner.select(host,data.getString("owner"));if(action.equals("learn"))ExternalPttOwner.select(host,ExternalPttOwner.application(host));if(action.equals("save")&&(candidate==null||!released||candidate.optLong("holdMs")<150))throw new JSONException("اضغط الزر مطولًا ثم حرره قبل حفظه");mode="";
  if(action.equals("learn")){mode="learn";candidate=null;released=false;}
  else if(action.equals("test"))mode="test";
  else if(action.equals("clear"))store.edit().clear().apply();
  else if(action.equals("save"))store.edit().putInt("keyCode",candidate.getInt("keyCode")).putString("keyName",candidate.getString("keyName")).putString("device",candidate.optString("device")).putString("descriptor",candidate.optString("descriptor")).apply();
  if(data.has("channel")){String channel=data.getString("channel");if(!channel.equals("public")&&!channel.equals("private"))throw new JSONException("Invalid channel");store.edit().putString("channel",channel).apply();}changed();
 }
 boolean key(KeyEvent e,String route){if(!ExternalPttOwner.owns(host))return false;int code=e.getKeyCode();if(!allowed(code)||(e.getAction()!=KeyEvent.ACTION_DOWN&&e.getAction()!=KeyEvent.ACTION_UP))return false;InputDevice input=e.getDevice();if(input!=null&&input.isVirtual()&&!mediaKey(code))return false;
  if(mode.equals("learn")){try{if(e.getAction()==KeyEvent.ACTION_DOWN&&e.getRepeatCount()==0){candidate=new JSONObject().put("keyCode",code).put("keyName",KeyEvent.keyCodeToString(code)).put("device",input==null?"وسائط النظام":input.getName()).put("descriptor",input==null?"":input.getDescriptor()).put("deviceId",e.getDeviceId()).put("downTime",e.getDownTime()).put("source",e.getSource()).put("route",route);released=false;}else if(e.getAction()==KeyEvent.ACTION_UP&&candidate!=null&&candidate.optInt("keyCode")==code&&candidate.optInt("deviceId")==e.getDeviceId()&&candidate.optLong("downTime")==e.getDownTime()){released=true;candidate.put("holdMs",e.getEventTime()-e.getDownTime());}changed();}catch(JSONException ignored){}return true;}
  String descriptor=store.getString("descriptor","");if(code!=store.getInt("keyCode",0)||!descriptor.isEmpty()&&!(input!=null&&descriptor.equals(input.getDescriptor())||input==null&&mediaKey(code)))return false;
  if(mode.equals("test")){released=e.getAction()==KeyEvent.ACTION_UP;changed();return true;}
  if(e.getAction()==KeyEvent.ACTION_UP){if(held&&e.getDownTime()==downTime&&e.getDeviceId()==device)release();return true;}
  if(e.getRepeatCount()!=0||held)return true;if(!host.externalReady())return false;held=true;device=e.getDeviceId();downTime=e.getDownTime();event(true);handler.postDelayed(expire,30000);return true;
 }
 void event(boolean down){try{host.externalEvent("external-ptt",new JSONObject().put("down",down).put("channel",store.getString("channel","public")));}catch(JSONException ignored){}}
 void changed(){try{host.externalEvent("external-key",info());}catch(JSONException ignored){}}
 void release(){handler.removeCallbacks(expire);if(held){held=false;event(false);} }
 @Override public void onInputDeviceRemoved(int id){if(held&&device==id)release();}
 @Override public void onInputDeviceAdded(int id){} @Override public void onInputDeviceChanged(int id){}
 void close(){ExternalPttOwner.listener=null;release();host.getSystemService(InputManager.class).unregisterInputDeviceListener(this);host.getSystemService(AudioManager.class).unregisterAudioDeviceCallback(audioDevices);media.release();handler.removeCallbacksAndMessages(null);}
}
