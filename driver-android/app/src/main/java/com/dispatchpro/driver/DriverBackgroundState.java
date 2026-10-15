package com.dispatchpro.driver;
import android.content.Context;
import java.util.concurrent.*;
import org.json.*;

/** Existing server long-poll, on a native worker; FCM remains the Doze wake path. */
final class DriverBackgroundState {
 private final Context context;
 private final ScheduledExecutorService worker=Executors.newSingleThreadScheduledExecutor();
 private volatile boolean enabled;
 private ScheduledFuture<?> pending;
 private volatile String cursor="";
 private int retry=2000;
 private volatile long generation;
 DriverBackgroundState(Context context){this.context=context;}
 synchronized void start(){if(enabled)return;enabled=true;cursor="";retry=2000;long run=++generation;pending=worker.schedule(()->sync(run),0,TimeUnit.MILLISECONDS);}
 synchronized void stop(){enabled=false;generation++;if(pending!=null)pending.cancel(false);}
 synchronized void networkChanged(){if(!enabled)return;cursor="";DriverNativeApi.networkChanged();if(pending!=null)pending.cancel(false);long run=++generation;pending=worker.schedule(()->sync(run),0,TimeUnit.MILLISECONDS);}
 private void sync(long run){
  long delay=1000;
  try{if(!enabled||run!=generation)return;DriverNativeApi.Result response=DriverNativeApi.authenticated(context,"GET",BuildConfig.FLAVOR.equals("radio")?"radio/me":"driver/updates?cursor="+java.net.URLEncoder.encode(cursor,"UTF-8"),null);
   if(!enabled||run!=generation)return;if(response.status==401||response.status==403){context.getSharedPreferences("driver-duty",0).edit().putBoolean("online",false).apply();DriverForegroundService.end(context);return;}if(response.status!=200)throw new java.io.IOException("State unavailable");
   if(BuildConfig.FLAVOR.equals("radio")){context.getSharedPreferences("driver-duty",0).edit().putBoolean("gpsEnabled",response.body.optBoolean("gpsEnabled",true)).apply();DriverForegroundService.gpsAccessChanged();context.getSharedPreferences("driver-health",0).edit().putLong("backendAt",System.currentTimeMillis()).apply();retry=2000;delay=20000;return;}
   JSONObject data=response.body.getJSONObject("data");cursor=response.body.optString("cursor");
   context.getSharedPreferences("driver-duty",0).edit().putBoolean("gpsEnabled",data.getJSONObject("driver").optBoolean("gpsEnabled",true)).apply();DriverForegroundService.gpsAccessChanged();
   boolean activeTrip=false;JSONArray rides=data.getJSONArray("rides");for(int i=0;i<rides.length();i++){String ride=rides.getJSONObject(i).optString("status");activeTrip|="Accepted".equals(ride)||"DriverArriving".equals(ride)||"Arrived".equals(ride)||"InProgress".equals(ride);}context.getSharedPreferences("driver-duty",0).edit().putBoolean("tripActive",activeTrip).apply();DriverForegroundService.gpsDutyChanged();
   String status=data.getJSONObject("driver").getString("status");
   if("Offline".equals(status)&&data.getJSONArray("rides").length()==0||"Suspended".equals(status)){context.getSharedPreferences("driver-duty",0).edit().putBoolean("online",false).apply();DriverForegroundService.end(context);return;}
   long server=DriverNotifications.timestamp(response.body.optString("serverTime"),System.currentTimeMillis());
   DriverNotifications.syncOffers(context,data,server);
   context.getSharedPreferences("driver-health",0).edit().putLong("backendAt",System.currentTimeMillis()).putLong("realtimeAt",System.currentTimeMillis()).apply();retry=2000;
  }catch(Exception ignored){delay=retry+ThreadLocalRandom.current().nextInt(500);retry=Math.min(30000,retry*2);}
  finally { synchronized(this){if(enabled&&run==generation)pending=worker.schedule(()->sync(run),delay,TimeUnit.MILLISECONDS);} }
 }
 void close(){stop();worker.shutdownNow();}
}
