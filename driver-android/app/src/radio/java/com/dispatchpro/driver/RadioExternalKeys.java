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

/** Learns actual down/up events. No default button, no system-key interception. */
final class RadioExternalKeys implements InputManager.InputDeviceListener {
 final RadioService service;final SharedPreferences store;final RadioPolicy.Hold hold=new RadioPolicy.Hold();
 final Handler handler=new Handler(Looper.getMainLooper());final MediaSession media;
 String mode="",route="";JSONObject candidate;long downAt,heldEventDownTime;boolean released;int heldCode;
 final Runnable expire=()->release("مهلة أمان 30 ثانية");
 final AudioDeviceCallback audioDevices=new AudioDeviceCallback(){@Override public void onAudioDevicesRemoved(AudioDeviceInfo[] devices){if(devices.length>0){release("فُصل جهاز الصوت");service.event("radio-stop",true);}}};
 RadioExternalKeys(RadioService service){this.service=service;ExternalPttOwner.listener=()->{release("تغير التطبيق المسؤول");active(service.operational);notifyState("");};store=service.getSharedPreferences("radio-external",0);
  service.getSystemService(InputManager.class).registerInputDeviceListener(this,handler);
  service.getSystemService(AudioManager.class).registerAudioDeviceCallback(audioDevices,handler);
  media=new MediaSession(service,"TNM External PTT");media.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS|MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
  media.setCallback(new MediaSession.Callback(){@Override public boolean onMediaButtonEvent(Intent intent){KeyEvent e=intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT);return e!=null&&key(e,"MediaSession");}},handler);
 }
 void active(boolean value){value=value&&ExternalPttOwner.owns(service);media.setPlaybackState(new PlaybackState.Builder().setState(value?PlaybackState.STATE_PLAYING:PlaybackState.STATE_STOPPED,0,0).setActions(PlaybackState.ACTION_PLAY|PlaybackState.ACTION_PAUSE|PlaybackState.ACTION_PLAY_PAUSE).build());media.setActive(value);if(!value)release("الخدمة غير تشغيلية");}
 JSONObject info()throws JSONException{
  JSONArray devices=new JSONArray();for(int id:InputDevice.getDeviceIds()){InputDevice d=InputDevice.getDevice(id);if(d!=null&&!d.isVirtual())devices.put(new JSONObject().put("id",id).put("name",d.getName()).put("source",d.getSources()));}
  return new JSONObject().put("owner",ExternalPttOwner.current(service)).put("keyCode",store.getInt("keyCode",0)).put("keyName",store.getString("keyName","")).put("device",store.getString("deviceName","")).put("channel",store.getString("channel","public")).put("mode",mode).put("candidate",candidate==null?JSONObject.NULL:candidate).put("released",released).put("pressed",hold.pressed()).put("route",route).put("devices",devices).put("accessibility",RadioKeyAccess.connected);
 }
 void configure(JSONObject data)throws JSONException{
  release("تغيير الإعداد");String action=data.optString("action");if(data.has("owner"))ExternalPttOwner.select(service,data.getString("owner"));if(action.equals("learn"))ExternalPttOwner.select(service,ExternalPttOwner.application(service));if(action.equals("save")&&(candidate==null||!released||candidate.optLong("holdMs")<150))throw new JSONException("اضغط الزر مطولًا ثم حرره قبل حفظه؛ الزر الذي يرسل نقرة فقط غير مناسب");mode="";
  if(action.equals("learn")){mode="learn";candidate=null;released=false;handler.postDelayed(()->{if(mode.equals("learn")&&candidate==null){mode="";notifyState("لم يصل حدث زر؛ قد يحتاج الزر إلى تكامل الشركة المصنعة أو جهاز إدخال متوافق");}},30000);}
  else if(action.equals("test"))mode="test";
  else if(action.equals("clear"))store.edit().clear().apply();
  else if(action.equals("save")){if(candidate==null||!released||candidate.optLong("holdMs")<150)throw new JSONException("اضغط الزر مطولًا ثم حرره قبل حفظه؛ الزر الذي يرسل نقرة فقط غير مناسب");store.edit().putInt("keyCode",candidate.getInt("keyCode")).putString("keyName",candidate.getString("keyName")).putString("deviceName",candidate.optString("device")).putString("descriptor",candidate.optString("descriptor")).apply();}
  if(data.has("channel")){String channel=data.getString("channel");if(!channel.equals("public")&&!channel.equals("private"))throw new JSONException("Invalid channel");store.edit().putString("channel",channel).apply();}
  notifyState("");
 }
 boolean matches(KeyEvent event){if(event.getKeyCode()!=store.getInt("keyCode",0))return false;String descriptor=store.getString("descriptor","");InputDevice d=event.getDevice();return descriptor.isEmpty()||d==null&&RadioPolicy.mediaKey(event.getKeyCode())||d!=null&&descriptor.equals(d.getDescriptor());}
 boolean key(KeyEvent event,String source){
  if(!ExternalPttOwner.owns(service))return false;int code=event.getKeyCode();if(!RadioPolicy.allowedKey(code)||event.getAction()!=KeyEvent.ACTION_DOWN&&event.getAction()!=KeyEvent.ACTION_UP)return false;
  InputDevice device=event.getDevice();if(device!=null&&device.isVirtual()&&!RadioPolicy.mediaKey(code))return false;
  if(mode.equals("learn")){
   try{if(event.getAction()==KeyEvent.ACTION_DOWN&&event.getRepeatCount()==0){candidate=new JSONObject().put("keyCode",code).put("keyName",KeyEvent.keyCodeToString(code)).put("device",device==null?"وسائط النظام":device.getName()).put("descriptor",device==null?"":device.getDescriptor()).put("deviceId",event.getDeviceId()).put("eventDownTime",event.getDownTime()).put("source",event.getSource()).put("route",source);downAt=SystemClock.elapsedRealtime();released=false;}
    else if(event.getAction()==KeyEvent.ACTION_UP&&candidate!=null&&candidate.optInt("keyCode")==code&&candidate.optInt("deviceId")==event.getDeviceId()&&candidate.optLong("eventDownTime")==event.getDownTime()){released=true;candidate.put("holdMs",SystemClock.elapsedRealtime()-downAt);}
    notifyState("");
   }catch(JSONException ignored){}return true;
  }
  if(!matches(event))return false;
  route=source;
  if(mode.equals("test")){if(event.getAction()==KeyEvent.ACTION_DOWN&&event.getRepeatCount()==0)downAt=SystemClock.elapsedRealtime();released=event.getAction()==KeyEvent.ACTION_UP;notifyState(released?"تم رصد تحرير الزر":"تم رصد الضغط — الاختبار لا يرسل صوتًا");return true;}
  if(event.getAction()==KeyEvent.ACTION_UP){if(hold.matches(event.getDeviceId())&&event.getDownTime()==heldEventDownTime)release("تحرير الزر");return true;}
  if(!service.operational||!service.microphoneReady)return false;
  if(hold.press(event.getDeviceId(),event.getRepeatCount())){heldCode=code;heldEventDownTime=event.getDownTime();service.event("external-ptt",ptt(true));handler.postDelayed(expire,30000);notifyState("");}
  return true;
 }
 private JSONObject ptt(boolean down){try{return new JSONObject().put("down",down).put("channel",store.getString("channel","public"));}catch(JSONException e){return new JSONObject();}}
 void release(String reason){handler.removeCallbacks(expire);if(hold.release()){service.event("external-ptt",ptt(false));notifyState(reason);}}
 void notifyState(String message){try{JSONObject value=info().put("message",message);service.event("external-key",value);}catch(JSONException ignored){}}
 @Override public void onInputDeviceAdded(int id){notifyState("");}
 @Override public void onInputDeviceChanged(int id){release("تغير جهاز الإدخال");notifyState("");}
 @Override public void onInputDeviceRemoved(int id){if(hold.removed(id)){handler.removeCallbacks(expire);service.event("external-ptt",ptt(false));}notifyState("فُصل جهاز الإدخال");}
 void close(){ExternalPttOwner.listener=null;release("توقف الخدمة");handler.removeCallbacksAndMessages(null);media.release();service.getSystemService(InputManager.class).unregisterInputDeviceListener(this);service.getSystemService(AudioManager.class).unregisterAudioDeviceCallback(audioDevices);}
}
