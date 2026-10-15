package com.dispatchpro.driver;
import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.os.*;
import org.json.JSONObject;
final class DriverDiagnostics {
 static JSONObject read(Context context)throws org.json.JSONException {
  DriverNotifications.configure(context);
  NotificationManager notifications=context.getSystemService(NotificationManager.class);
  NotificationChannel channel=Build.VERSION.SDK_INT>=26?notifications.getNotificationChannel(DriverNotifications.channel(context)):null;
  AudioManager audio=context.getSystemService(AudioManager.class);
  boolean channelReady=Build.VERSION.SDK_INT<26||channel==null||channel.getImportance()>=NotificationManager.IMPORTANCE_HIGH;
  boolean sound=(Build.VERSION.SDK_INT<26||channel==null||channel.getSound()!=null)&&audio.getRingerMode()==AudioManager.RINGER_MODE_NORMAL&&audio.getStreamVolume(AudioManager.STREAM_NOTIFICATION)>0&&(Build.VERSION.SDK_INT<23||notifications.getCurrentInterruptionFilter()==NotificationManager.INTERRUPTION_FILTER_ALL);
  boolean location=context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED;
  boolean gps=context.getSystemService(android.location.LocationManager.class).isProviderEnabled(android.location.LocationManager.GPS_PROVIDER)||context.getSystemService(android.location.LocationManager.class).isProviderEnabled(android.location.LocationManager.NETWORK_PROVIDER);
  boolean firebase=true;try{for(String field:new String[]{"APP_ID","API_KEY","SENDER_ID","PROJECT_ID"})firebase&=!((String)BuildConfig.class.getField("DRIVER_FIREBASE_"+field).get(null)).isEmpty();}catch(Exception ignored){firebase=false;}
  long last=context.getSharedPreferences("driver-health",0).getLong("gpsAt",0);
  return new JSONObject().put("notifications",DriverNotifications.permitted(context)).put("channel",channelReady).put("sound",sound&&context.getSharedPreferences("driver-alerts",0).getBoolean("sound",true))
   .put("locationPermission",location).put("gpsEnabled",gps).put("gpsAt",last).put("preciseLocation",context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED)
   .put("backgroundLocation",Build.VERSION.SDK_INT<29?location:context.checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION)==PackageManager.PERMISSION_GRANTED).put("locationForegroundService",location&&DriverForegroundService.running).put("realtime",System.currentTimeMillis()-context.getSharedPreferences("driver-health",0).getLong("realtimeAt",0)<35000).put("service",DriverForegroundService.running)
   .put("batteryRestricted",Build.VERSION.SDK_INT>=28&&context.getSystemService(ActivityManager.class).isBackgroundRestricted())
   .put("batteryOptimized",!context.getSystemService(PowerManager.class).isIgnoringBatteryOptimizations(context.getPackageName()))
   .put("fcmConfigured",firebase).put("fcmRegistered",firebase&&context.getSharedPreferences("driver-push",0).getBoolean("bound",false))
   .put("runtimeKind",context.getSharedPreferences("driver-health",0).getString("runtimeKind","")).put("runtimeStage",context.getSharedPreferences("driver-health",0).getString("runtimeStage","")).put("runtimeAt",context.getSharedPreferences("driver-health",0).getLong("runtimeAt",0))
   .put("runtimeTrace",new org.json.JSONArray(context.getSharedPreferences("driver-health",0).getString("runtimeTrace","[]")))
   .put("communicationMetrics",new JSONObject(context.getSharedPreferences("communication-metrics",0).getAll())).put("fullScreenCalls",Build.VERSION.SDK_INT<34||notifications.canUseFullScreenIntent()).put("microphone",context.checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED);
 }
 static void settings(Context context,String section){
  Intent intent;
  if("channel".equals(section)&&Build.VERSION.SDK_INT>=26)intent=new Intent(android.provider.Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE,context.getPackageName()).putExtra(android.provider.Settings.EXTRA_CHANNEL_ID,DriverNotifications.channel(context));
  else if("notifications".equals(section)&&Build.VERSION.SDK_INT>=26)intent=new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE,context.getPackageName());
  else if("location".equals(section))intent=new Intent(android.provider.Settings.ACTION_LOCATION_SOURCE_SETTINGS);
  else intent=new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,android.net.Uri.parse("package:"+context.getPackageName()));
  intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);context.startActivity(intent);
 }
}
