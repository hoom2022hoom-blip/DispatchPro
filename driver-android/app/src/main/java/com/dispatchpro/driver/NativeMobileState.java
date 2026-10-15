package com.dispatchpro.driver;
import android.content.Context;
import java.util.concurrent.*;
/** Separate native event long-poll; callbacks resync chat/unread/calls after reconnect. */
final class NativeMobileState {
 private final Context context;private final ScheduledExecutorService worker=Executors.newSingleThreadScheduledExecutor();private volatile boolean enabled;private long generation;private String cursor="";private int retry=1000;private ScheduledFuture<?> pending;
 NativeMobileState(Context context){this.context=context;}
 synchronized void start(){if(enabled)return;enabled=true;cursor="";long run=++generation;pending=worker.schedule(()->sync(run),0,TimeUnit.MILLISECONDS);}
 synchronized void stop(){enabled=false;++generation;if(pending!=null)pending.cancel(false);}
 synchronized void networkChanged(){if(!enabled)return;cursor="";DriverNativeApi.networkChanged();long run=++generation;if(pending!=null)pending.cancel(false);pending=worker.schedule(()->sync(run),0,TimeUnit.MILLISECONDS);}
 private void sync(long run){long delay=250;try{if(!enabled||run!=generation)return;long identity=context.getSharedPreferences("communication-auth",0).getLong("generation",0);DriverNativeApi.Result response=DriverNativeApi.authenticated(context,"GET","driver/mobile/updates?deviceId="+CommunicationNotifications.device(context)+"&cursor="+cursor,null);if(!enabled||run!=generation||identity!=context.getSharedPreferences("communication-auth",0).getLong("generation",0))return;if(response.status!=200)throw new java.io.IOException("Sync unavailable");cursor=response.body.getString("cursor");CommunicationNotifications.sync(context,response.body.getJSONObject("data"),DriverNotifications.timestamp(response.body.optString("serverTime"),System.currentTimeMillis()));retry=1000;}catch(Exception ignored){delay=retry+ThreadLocalRandom.current().nextInt(500);retry=Math.min(retry*2,30000);}synchronized(this){if(enabled&&run==generation)pending=worker.schedule(()->sync(run),delay,TimeUnit.MILLISECONDS);}}
 void close(){stop();worker.shutdownNow();}
}
