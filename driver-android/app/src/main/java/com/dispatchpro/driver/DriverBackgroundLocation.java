package com.dispatchpro.driver;
import android.Manifest;
import android.content.*;
import android.content.pm.PackageManager;
import android.location.*;
import android.os.*;
import org.json.JSONObject;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
/** Real native fixes only while online duty is in background; no WebView timer dependency. */
final class DriverBackgroundLocation implements LocationListener{
 private final Context context;private final LocationManager locations;private final ExecutorService uploads=Executors.newSingleThreadExecutor();
 private volatile boolean enabled,busy;private long lastUpload,interval;
 private DriverLocationClock clock=new DriverLocationClock();private String clockOrigin="";
 DriverBackgroundLocation(Context context){this.context=context;locations=context.getSystemService(LocationManager.class);}
 void start(){if(enabled||!context.getSharedPreferences("driver-duty",0).getBoolean("gpsEnabled",true)||context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)!=PackageManager.PERMISSION_GRANTED)return;enabled=true;interval=DriverGpsDutyPolicy.interval(context.getSharedPreferences("driver-duty",0).getBoolean("tripActive",true));try{if(context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED&&locations.isProviderEnabled(LocationManager.GPS_PROVIDER))locations.requestLocationUpdates(LocationManager.GPS_PROVIDER,interval,0,this,Looper.getMainLooper());if(locations.isProviderEnabled(LocationManager.NETWORK_PROVIDER))locations.requestLocationUpdates(LocationManager.NETWORK_PROVIDER,interval,0,this,Looper.getMainLooper());}catch(SecurityException ignored){stop();}}
 void dutyChanged(){new Handler(Looper.getMainLooper()).post(()->{if(enabled&&interval!=DriverGpsDutyPolicy.interval(context.getSharedPreferences("driver-duty",0).getBoolean("tripActive",true))){stop();start();}});}
 void stop(){enabled=false;try{locations.removeUpdates(this);}catch(Exception ignored){}}
 void close(){stop();uploads.shutdownNow();}
 @Override public void onLocationChanged(Location fix){long age=(SystemClock.elapsedRealtimeNanos()-fix.getElapsedRealtimeNanos())/1000000;long now=SystemClock.elapsedRealtime();if(!enabled||busy||fix.isFromMockProvider()||!Double.isFinite(fix.getLatitude())||!Double.isFinite(fix.getLongitude())||age<0||age>60000||!fix.hasAccuracy()||!Float.isFinite(fix.getAccuracy())||fix.getAccuracy()<=0||fix.getAccuracy()>200||Math.abs(fix.getLatitude())>90||Math.abs(fix.getLongitude())>180||now-lastUpload<10000)return;lastUpload=now;busy=true;Location actual=new Location(fix);uploads.execute(()->{try{upload(actual);}catch(Exception ignored){if(BuildConfig.FLAVOR.equals("radio"))context.getSharedPreferences("driver-health",0).edit().putBoolean("gpsUploadFailed",true).apply();}finally{busy=false;}});}
 private void upload(Location fix)throws Exception{
  if(!enabled)return;
  String origin=DriverConfig.origin(context);if(!origin.equals(clockOrigin)){clock=new DriverLocationClock();clockOrigin=origin;}
  String saved=SecureDriverSession.load(context,origin);if(saved.isEmpty())return;JSONObject session=new JSONObject(saved);
  long fixElapsed=fix.getElapsedRealtimeNanos()/1000000,sentElapsed=SystemClock.elapsedRealtime();
  long captured=clock.capturedAt(fix.getTime(),fixElapsed,sentElapsed);if(captured<=0)return;
  JSONObject body=new JSONObject().put("latitude",fix.getLatitude()).put("longitude",fix.getLongitude()).put("accuracy",fix.getAccuracy()).put("capturedAt",utc(captured));
  if(fix.hasBearing())body.put("heading",fix.getBearing());if(fix.hasSpeed())body.put("speed",fix.getSpeed());
  String path=BuildConfig.FLAVOR.equals("radio")?"radio/location":"driver/location";
  DriverNativeApi.Result result=DriverNativeApi.authenticated(context,"PUT",path,body);
  long receivedElapsed=SystemClock.elapsedRealtime();
  if(result.status==400&&enabled&&origin.equals(DriverConfig.origin(context))){
   String current=SecureDriverSession.load(context,origin);
   if(!current.isEmpty()&&sameAccount(session,new JSONObject(current))&&clock.observeRejection(result.body.optString("error"),DriverNotifications.timestamp(result.body.optString("serverTime"),0),sentElapsed,receivedElapsed,fixElapsed)){
    captured=clock.capturedAt(fix.getTime(),fixElapsed,SystemClock.elapsedRealtime());
    if(captured>0){body.put("capturedAt",utc(captured));result=DriverNativeApi.authenticated(context,"PUT",path,body);}
   }
  }
  // Diagnostics compare gpsAt with the device clock, independently of server time.
  if(BuildConfig.FLAVOR.equals("radio")){
   String current=SecureDriverSession.load(context,origin);if(!enabled||!origin.equals(DriverConfig.origin(context))||current.isEmpty()||!sameAccount(session,new JSONObject(current)))return;
   context.getSharedPreferences("driver-health",0).edit().putBoolean("gpsUploadFailed",result.status!=200).apply();
  }
  if(result.status==200&&result.body.optBoolean("stored",false))context.getSharedPreferences("driver-health",0).edit().putLong("gpsAt",System.currentTimeMillis()-(SystemClock.elapsedRealtime()-fixElapsed)).putFloat("accuracy",fix.getAccuracy()).putFloat("heading",fix.hasBearing()?fix.getBearing():Float.NaN).putFloat("speed",fix.hasSpeed()?fix.getSpeed():Float.NaN).apply();
 }
 private static boolean sameAccount(JSONObject before,JSONObject after)throws org.json.JSONException{return before.optString("tenant").equals(after.optString("tenant"))&&before.getJSONObject("profile").optString("id").equals(after.getJSONObject("profile").optString("id"));}
 private static String utc(long time){java.text.SimpleDateFormat format=new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",java.util.Locale.ROOT);format.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));return format.format(new java.util.Date(time));}
 private int send(String url,String method,JSONObject body,String bearer,JSONObject result)throws Exception{HttpURLConnection http=(HttpURLConnection)new URL(url).openConnection();try{http.setInstanceFollowRedirects(false);http.setConnectTimeout(5000);http.setReadTimeout(5000);http.setRequestMethod(method);http.setDoOutput(true);http.setRequestProperty("Content-Type","application/json");if(!bearer.isEmpty())http.setRequestProperty("Authorization","Bearer "+bearer);try(OutputStream output=http.getOutputStream()){output.write(body.toString().getBytes(StandardCharsets.UTF_8));}int status=http.getResponseCode();if(result!=null&&status==200)try(InputStream input=http.getInputStream()){ByteArrayOutputStream data=new ByteArrayOutputStream();byte[] block=new byte[1024];int count;while((count=input.read(block))!=-1){if(data.size()+count>16384)return 503;data.write(block,0,count);}JSONObject value=new JSONObject(data.toString("UTF-8"));result.put("accessToken",value.getString("accessToken")).put("refreshToken",value.getString("refreshToken"));}return status;}finally{http.disconnect();}}
 @Override public void onProviderEnabled(String provider){}@Override public void onProviderDisabled(String provider){}@Override public void onStatusChanged(String provider,int status,Bundle extras){}
}
