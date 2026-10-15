package com.dispatchpro.driver;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.*;
import android.location.LocationManager;
import android.media.*;
import android.net.wifi.WifiManager;
import android.os.*;
import org.json.*;

/** The radio engine belongs to this service, never to an Activity. */
public final class RadioService extends Service {
 static RadioService instance;
 final Handler handler=new Handler(Looper.getMainLooper());
 final class LocalBinder extends Binder {RadioService service(){return RadioService.this;}}
 final LocalBinder binder=new LocalBinder();
 RadioEngine engine;RadioExternalKeys keys;RadioActivity activity;
 DriverBackgroundLocation location;
 boolean authenticated,requested,foregroundStarted,locationRunning,restoreReceive,locationType;volatile boolean operational,microphoneReady;
 String failure="",lastStatus="";
 final VoiceNotice voiceNotice=new VoiceNotice();
 final Runnable expireSpeaker=()->{if(foregroundStarted)getSystemService(NotificationManager.class).notify(103,notification());};
 void speaker(JSONObject value){handler.removeCallbacks(expireSpeaker);long lease=voiceNotice.update(value);if(foregroundStarted)getSystemService(NotificationManager.class).notify(103,notification());if(lease>0)handler.postDelayed(expireSpeaker,lease+1);}
 PowerManager.WakeLock cpu;WifiManager.WifiLock wifi;
 // Chromium owns focus for WebRTC and its notification tones. A second focus
 // owner in this service was permanently preempted by our own WebView.
 AudioManager audio;AudioManager.OnModeChangedListener modeListener;boolean soundAvailable;
 boolean receiveReady,voiceActive,routeActive,previousSpeaker;int previousMode;AudioDeviceInfo previousCommunicationDevice;
 final Runnable tick=new Runnable(){public void run(){changed();if(operational&&cpu!=null&&!cpu.isHeld())cpu.acquire(60000);handler.postDelayed(this,5000);}};
 final BroadcastReceiver locationChange=new BroadcastReceiver(){public void onReceive(Context c,Intent i){changed();}};
 @Override public void onCreate(){super.onCreate();instance=this;audio=getSystemService(AudioManager.class);
  if(Build.VERSION.SDK_INT>=31){modeListener=mode->changed();audio.addOnModeChangedListener(getMainExecutor(),modeListener);}
  requested=getSharedPreferences("radio-runtime",0).getBoolean("requested",false);
  location=new DriverBackgroundLocation(this);keys=new RadioExternalKeys(this);engine=new RadioEngine(this);
  IntentFilter filter=new IntentFilter(LocationManager.MODE_CHANGED_ACTION);filter.addAction(LocationManager.PROVIDERS_CHANGED_ACTION);
  if(Build.VERSION.SDK_INT>=33)registerReceiver(locationChange,filter,Context.RECEIVER_NOT_EXPORTED);else registerReceiver(locationChange,filter);
  handler.post(tick);
 }
 @Override public IBinder onBind(Intent i){return binder;}
 @Override public int onStartCommand(Intent i,int flags,int id){if(requested&&(i==null||"com.dispatchpro.radio.RESTORE_RECEIVE".equals(i.getAction()))){restoreReceive=true;startReceivingForeground();}changed();return requested?START_STICKY:START_NOT_STICKY;}
 // Restore reception without activating microphone hardware from background.
 void startReceivingForeground(){try{channel();if(Build.VERSION.SDK_INT>=29)startForeground(103,notification(),ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);else startForeground(103,notification());foregroundStarted=true;}catch(RuntimeException denied){failure="افتح التطبيق لاستعادة خدمة المخشير";}}
 void channel(){NotificationManager nm=getSystemService(NotificationManager.class);if(Build.VERSION.SDK_INT>=26)nm.createNotificationChannel(new NotificationChannel("tnm-radio","مخشير TNM",NotificationManager.IMPORTANCE_LOW));}
 boolean precise(){return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED;}
 boolean locationEnabled(){LocationManager lm=getSystemService(LocationManager.class);return Build.VERSION.SDK_INT>=28?lm.isLocationEnabled():lm.isProviderEnabled(LocationManager.GPS_PROVIDER)||lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);}
 boolean visible(){return activity!=null&&activity.resumed;}
 void duty(boolean value){requested=value;getSharedPreferences("radio-runtime",0).edit().putBoolean("requested",value).apply();changed();}
 void authenticated(boolean value){authenticated=value;if(!value){getSharedPreferences("driver-health",0).edit().remove("gpsAt").remove("gpsUploadFailed").apply();duty(false);}else changed();}
 void changed(){
  if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED)microphoneReady=false;
  boolean allowed=requested&&RadioPolicy.operational(authenticated,locationEnabled(),precise(),getSharedPreferences("driver-duty",0).getBoolean("gpsEnabled",true));
  if(allowed&&!foregroundStarted&&(visible()||restoreReceive)){
   try{
    channel();
    boolean mic=visible()&&checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED;
    int types=ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK;
    locationType=visible()&&precise()&&locationEnabled()&&getSharedPreferences("driver-duty",0).getBoolean("gpsEnabled",true);if(locationType)types|=ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION;
    if(mic&&Build.VERSION.SDK_INT>=30)types|=ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
    if(Build.VERSION.SDK_INT>=29)startForeground(103,notification(),types);else startForeground(103,notification());
    foregroundStarted=true;microphoneReady=mic;failure="";startService(new Intent(this,RadioService.class));
   }catch(RuntimeException denied){failure="تعذر بدء خدمة المخشير؛ افتح الأذونات وأعد المحاولة";microphoneReady=false;}
  }else if(allowed&&foregroundStarted&&visible()&&(!microphoneReady&&checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED||!locationType&&precise()&&locationEnabled()&&getSharedPreferences("driver-duty",0).getBoolean("gpsEnabled",true))){
   try{boolean mic=checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED;int types=ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK|(mic&&Build.VERSION.SDK_INT>=30?ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE:0);locationType=precise()&&locationEnabled()&&getSharedPreferences("driver-duty",0).getBoolean("gpsEnabled",true);if(locationType)types|=ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION;if(Build.VERSION.SDK_INT>=29)startForeground(103,notification(),types);microphoneReady=mic;}catch(RuntimeException denied){failure="تعذر تهيئة أذونات الخدمة";}
  }
  boolean next=allowed&&foregroundStarted;
  if(next&&!operational){operational=true;keys.active(true);getSharedPreferences("driver-duty",0).edit().putBoolean("online",true).putBoolean("tripActive",false).apply();engine.keepReceiving();}
  boolean gps=operational&&locationType&&locationEnabled()&&precise()&&getSharedPreferences("driver-duty",0).getBoolean("gpsEnabled",true);
  if(gps&&!locationRunning&&(visible()||checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION)==PackageManager.PERMISSION_GRANTED)){location.start();locationRunning=true;}
  else if(!gps&&locationRunning){location.stop();locationRunning=false;}
  if(!next&&operational){operational=false;keys.active(false);location.stop();locationRunning=false;releaseResources();event("radio-stop",true);}
  if(!requested&&foregroundStarted){foregroundStarted=false;microphoneReady=false;restoreReceive=false;stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();}
  updateSoundAvailability();
  route(operational&&soundAvailable&&(receiveReady||voiceActive));
  if(operational){if(visible())releaseLocks();else if(cpu==null)locks();}
  try{JSONObject s=status();String raw=s.toString();if(!raw.equals(lastStatus)){lastStatus=raw;if(foregroundStarted)getSystemService(NotificationManager.class).notify(103,notification());event("background",operational);event("radio-status",s);}}catch(JSONException ignored){}
 }
 JSONObject status()throws JSONException{
  android.content.SharedPreferences health=getSharedPreferences("driver-health",0);
  return new JSONObject().put("operational",operational).put("locationEnabled",locationEnabled()).put("precise",precise()).put("microphoneReady",microphoneReady)
   .put("soundAvailable",soundAvailable).put("trackingColor",RadioPolicy.tracking(operational&&locationEnabled()&&precise()&&getSharedPreferences("driver-duty",0).getBoolean("gpsEnabled",true),health.getBoolean("gpsUploadFailed",false),System.currentTimeMillis(),health.getLong("gpsAt",0))).put("gpsAt",health.getLong("gpsAt",0)).put("failure",failure).put("external",keys.info());
 }
 void event(String name,Object value){if(engine!=null)engine.event(name,value);}
 void attached(RadioActivity a){activity=a;engine.attach(a);changed();}
 void detached(RadioActivity a){if(activity!=a)return;engine.detach();activity=null;changed();}
 void locks(){cpu=getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"TNM:radio");cpu.acquire(60000);WifiManager manager=(WifiManager)getApplicationContext().getSystemService(WIFI_SERVICE);if(manager!=null){wifi=manager.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF,"TNM:radio");wifi.acquire();}}
 void updateSoundAvailability(){
  // WebView handles playback focus. Keep native telephony/mute interruptions,
  // without confusing a playback-focus change with microphone contention.
  int mode=audio.getMode();boolean available=operational&&!audio.isMicrophoneMute()&&mode!=AudioManager.MODE_IN_CALL&&mode!=AudioManager.MODE_RINGTONE;
  if(available==soundAvailable)return;soundAvailable=available;
  android.util.Log.i("TNMMedia","stage=radioNativeAudioAvailable ms="+(available?1:0));
  if(!available){if(engine!=null)engine.capture.discard(engine.capture.attempt);route(false);keys.release("الصوت غير متاح مؤقتًا");}
  event("radio-focus",available);
 }
 static boolean externalAudio(AudioDeviceInfo d){return d!=null&&(d.getType()==AudioDeviceInfo.TYPE_BLUETOOTH_SCO||d.getType()==AudioDeviceInfo.TYPE_BLE_HEADSET||d.getType()==AudioDeviceInfo.TYPE_WIRED_HEADSET||d.getType()==AudioDeviceInfo.TYPE_USB_HEADSET);}
 void voiceActive(boolean active){voiceActive=active;route(operational&&soundAvailable&&(receiveReady||voiceActive));}
 void receiveReady(boolean ready){receiveReady=ready;route(operational&&soundAvailable&&(receiveReady||voiceActive));}
 void route(boolean active){
  if(active==routeActive)return;
  if(active){
   previousMode=audio.getMode();previousSpeaker=audio.isSpeakerphoneOn();
   if(Build.VERSION.SDK_INT>=31)previousCommunicationDevice=audio.getCommunicationDevice();
   routeActive=true;audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
   if(Build.VERSION.SDK_INT>=31){
    if(!externalAudio(audio.getCommunicationDevice())){
     AudioDeviceInfo speaker=null;
     for(AudioDeviceInfo d:audio.getAvailableCommunicationDevices()){
      if(externalAudio(d)&&audio.setCommunicationDevice(d))return;
      if(d.getType()==AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)speaker=d;
     }
     if(speaker!=null)audio.setCommunicationDevice(speaker);
    }
   }else if(!audio.isBluetoothScoOn()&&!audio.isWiredHeadsetOn())audio.setSpeakerphoneOn(true);
  }else{
   routeActive=false;
   if(Build.VERSION.SDK_INT>=31){if(previousCommunicationDevice==null||!audio.setCommunicationDevice(previousCommunicationDevice))audio.clearCommunicationDevice();previousCommunicationDevice=null;}
   else audio.setSpeakerphoneOn(previousSpeaker);
   if(audio.getMode()==AudioManager.MODE_IN_COMMUNICATION)audio.setMode(previousMode);
  }
 }
 void releaseLocks(){if(cpu!=null&&cpu.isHeld())cpu.release();cpu=null;if(wifi!=null&&wifi.isHeld())wifi.release();wifi=null;}
 void releaseResources(){if(engine!=null)engine.capture.discard(engine.capture.attempt);receiveReady=false;voiceActive=false;route(false);releaseLocks();soundAvailable=false;getSharedPreferences("driver-duty",0).edit().putBoolean("online",false).apply();}
 Notification notification(){Intent launch=new Intent(this,RadioActivity.class);PendingIntent pi=PendingIntent.getActivity(this,103,launch,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);Notification.Builder b=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,"tnm-radio"):new Notification.Builder(this);return b.setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentTitle("مخشير TNM").setContentText(voiceNotice.text(operational?(locationRunning?"المخشير يعمل · تتبع الموقع نشط":"المخشير يعمل · الموقع غير متاح"):"جارٍ استعادة اتصال المخشير")).setContentIntent(pi).setOngoing(true).setOnlyAlertOnce(true).setVisibility(Notification.VISIBILITY_PUBLIC).setCategory(Notification.CATEGORY_SERVICE).build();}
 @Override public void onTaskRemoved(Intent rootIntent){if(operational){keys.release("أغلقت الواجهة أثناء الضغط");engine.keepReceiving();engine.event("foreground",false);}super.onTaskRemoved(rootIntent);}
 @Override public void onDestroy(){handler.removeCallbacksAndMessages(null);if(Build.VERSION.SDK_INT>=31&&modeListener!=null)audio.removeOnModeChangedListener(modeListener);unregisterReceiver(locationChange);keys.close();location.close();releaseResources();engine.close();operational=false;microphoneReady=false;instance=null;super.onDestroy();}
}
