package com.dispatchpro.driver;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.*;

/** Keeps the existing authenticated WebView engine alive; no second voice session. */
public final class DriverForegroundService extends Service {
    private static MainActivity engine;
    private static DriverForegroundService instance;
    private DriverBackgroundLocation location;
    private DriverBackgroundState state;
    private NativeMobileState mobile;
    private PowerManager.WakeLock radioCpu;
    private android.net.wifi.WifiManager.WifiLock radioWifi;
    private final Handler radioHandler=new Handler(Looper.getMainLooper());
    private final VoiceNotice voiceNotice=new VoiceNotice();
    private Notification connectionNotification;private String connectionText="المخشير جاهز للاستماع";
    private final Runnable updateSpeaker=()->{if(connectionNotification!=null)getSystemService(NotificationManager.class).notify(8100,Notification.Builder.recoverBuilder(this,connectionNotification).setContentText(voiceNotice.text(connectionText)).setOnlyAlertOnce(true).setVisibility(Notification.VISIBILITY_PUBLIC).build());};
    static void speaker(org.json.JSONObject value){DriverForegroundService service=instance;if(service==null)return;service.radioHandler.post(()->{service.radioHandler.removeCallbacks(service.updateSpeaker);long lease=service.voiceNotice.update(value);service.updateSpeaker.run();if(lease>0)service.radioHandler.postDelayed(service.updateSpeaker,lease+1);});}
    private final Runnable renewRadio=()->radioLocks(true);
    private void radioLocks(boolean active){
        if(!BuildConfig.FLAVOR.equals("radio")&&!microphone&&!playback&&!receiving&&!(!active&&(radioCpu!=null||radioWifi!=null)))return;
        radioHandler.removeCallbacks(renewRadio);
        try{
            if(active){
                if(radioCpu==null){radioCpu=getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"DispatchPro:RadioReceive");radioCpu.setReferenceCounted(false);}
                radioCpu.acquire(10*60*1000L);
                if(radioWifi==null){android.net.wifi.WifiManager wifi=(android.net.wifi.WifiManager)getApplicationContext().getSystemService(WIFI_SERVICE);radioWifi=wifi.createWifiLock(android.net.wifi.WifiManager.WIFI_MODE_FULL_HIGH_PERF,"DispatchPro:RadioReceive");radioWifi.setReferenceCounted(false);}
                if(!radioWifi.isHeld())radioWifi.acquire();
                radioHandler.postDelayed(renewRadio,5*60*1000L);
            }else{if(radioCpu!=null&&radioCpu.isHeld())radioCpu.release();if(radioWifi!=null&&radioWifi.isHeld())radioWifi.release();}
        }catch(RuntimeException denied){getSharedPreferences("driver-health",0).edit().putString("radioLockError",denied.getClass().getSimpleName()).apply();}
    }
    private android.net.ConnectivityManager.NetworkCallback callback;
    public static void networkChanged(){if(instance!=null&&instance.state!=null){instance.state.networkChanged();instance.mobile.networkChanged();}}
    static void gpsDutyChanged(){if(instance!=null)instance.location.dutyChanged();}
    static void gpsAccessChanged(){if(instance!=null){if(instance.getSharedPreferences("driver-duty",0).getBoolean("gpsEnabled",true))instance.location.start();else instance.location.stop();}}
    static void receivingBackground(boolean active){if(instance!=null)instance.radioLocks(active);}
    public static void background(boolean active){if(instance!=null){instance.radioLocks(active);if(active){instance.location.start();instance.state.start();if(!BuildConfig.FLAVOR.equals("radio"))instance.mobile.start();}else{instance.location.stop();instance.state.stop();instance.mobile.stop();}}}
    @Override public void onCreate(){super.onCreate();instance=this;location=new DriverBackgroundLocation(this);state=new DriverBackgroundState(this);mobile=new NativeMobileState(this);
        callback=new android.net.ConnectivityManager.NetworkCallback(){@Override public void onAvailable(android.net.Network network){networkChanged();}@Override public void onLost(android.net.Network network){networkChanged();}};
        getSystemService(android.net.ConnectivityManager.class).registerDefaultNetworkCallback(callback);
    }
    public static boolean running;
    private static boolean microphone;
    static boolean microphoneReady(){return running&&microphone;}
    private static boolean playback,receiving;
    static boolean receivingReady(){return receiving;}
    public static void receiving(MainActivity host,boolean active){receiving=active;if(!active&&!microphone&&!playback&&instance!=null)instance.radioLocks(false);if(running||active)begin(host);}
    public static void playback(MainActivity host,boolean active){playback=active;if(running||active)begin(host);}
    public static void beginMicrophone(MainActivity host){microphone=true;begin(host);}
    public static void releaseMicrophone(MainActivity host){microphone=false;if(running)begin(host);}
    public static void begin(MainActivity host) {
        if(!microphone&&!playback&&!receiving&&host.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)!=PackageManager.PERMISSION_GRANTED)return;
        if(engine!=null&&engine!=host)engine.closeEngine();
        engine=host;
        Intent intent=new Intent(host,DriverForegroundService.class);
        try{if(Build.VERSION.SDK_INT>=26)host.startForegroundService(intent);else host.startService(intent);}catch(RuntimeException denied){host.serviceChanged(false);host.getSharedPreferences("driver-health",0).edit().putString("serviceError",denied.getClass().getSimpleName()).apply();}
    }
    public static void end(Context context) { context.stopService(new Intent(context,DriverForegroundService.class)); }
    @Override public int onStartCommand(Intent intent,int flags,int id) {
        // The current voice engine lives in the retained WebView. A process restart
        // cannot honestly claim to be receiving until the user opens that engine.
        if(BuildConfig.FLAVOR.equals("radio")&&engine==null){getSharedPreferences("driver-health",0).edit().putString("radioRecovery","Open application after process restart").apply();stopSelf();return START_NOT_STICKY;}
        if(intent==null&&!getSharedPreferences("driver-duty",MODE_PRIVATE).getBoolean("online",false)){stopSelf();return START_NOT_STICKY;}
        String channel="driver_connection";
        if(Build.VERSION.SDK_INT>=26)getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel(channel,"خدمة تكسي نابلس",NotificationManager.IMPORTANCE_LOW));
        Intent open=new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent target=PendingIntent.getActivity(this,1,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,channel):new Notification.Builder(this);
        boolean duty=getSharedPreferences("driver-duty",MODE_PRIVATE).getBoolean("online",false);
        Notification notification=builder.setSmallIcon(R.drawable.ic_driver).setContentTitle(BuildConfig.FLAVOR.equals("radio")?"NM RADIO · تكسي نابلس والمهندس":"NM DRIVER · تكسي نابلس والمهندس").setContentText(duty?(BuildConfig.FLAVOR.equals("radio")?"المخشير والموقع يعملان بالخلفية":"وضع العمل بالخلفية فعال · مشاركة الموقع واستقبال الطلبات"):"المخشيرة جاهزة للاستماع").setContentIntent(target).setOngoing(true).setOnlyAlertOnce(true).build();
        connectionText=String.valueOf(notification.extras.getCharSequence(Notification.EXTRA_TEXT));connectionNotification=notification;
        notification=Notification.Builder.recoverBuilder(this,notification).setContentText(voiceNotice.text(connectionText)).setVisibility(Notification.VISIBILITY_PUBLIC).build();
        int types=playback||receiving?ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK:0;
        if(duty&&getSharedPreferences("driver-duty",0).getBoolean("gpsEnabled",true)&&checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED)types|=ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION;
        if(microphone&&checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED)types|=ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
        if(types==0){stopSelf();return START_NOT_STICKY;}
        try{if(Build.VERSION.SDK_INT>=29)startForeground(8100,notification,types);else startForeground(8100,notification);}catch(RuntimeException denied){getSharedPreferences("driver-health",0).edit().putString("serviceError",denied.getClass().getSimpleName()).apply();stopSelf();return START_NOT_STICKY;}
        if(engine!=null)engine.serviceChanged(true);
        running=true;if(engine!=null&&engine.backgroundVoice())radioLocks(true);if((engine==null&&getSharedPreferences("driver-duty",MODE_PRIVATE).getBoolean("online",false))||(engine!=null&&engine.backgroundDuty())){radioLocks(true);location.start();state.start();if(!BuildConfig.FLAVOR.equals("radio"))mobile.start();}return getSharedPreferences("driver-duty",MODE_PRIVATE).getBoolean("online",false)?START_STICKY:START_NOT_STICKY;
    }
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public void onDestroy(){radioHandler.removeCallbacks(updateSpeaker);radioLocks(false);running=false;if(engine!=null)engine.serviceChanged(false);microphone=false;playback=false;receiving=false;instance=null;if(callback!=null)try{getSystemService(android.net.ConnectivityManager.class).unregisterNetworkCallback(callback);}catch(Exception ignored){}if(location!=null)location.close();if(state!=null)state.close();if(mobile!=null)mobile.close();DriverNotifications.closeOffers(this);if(engine!=null){engine.closeEngineIfDestroyed();engine=null;}super.onDestroy();}
}
