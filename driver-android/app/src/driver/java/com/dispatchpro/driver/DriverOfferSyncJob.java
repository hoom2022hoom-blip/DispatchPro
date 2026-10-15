package com.dispatchpro.driver;
import android.app.job.*;
import android.content.*;
import android.os.Build;
/** FCM wakes synchronization; only the authenticated backend snapshot can ring. */
public final class DriverOfferSyncJob extends JobService {
 private static final int ID=2310;
 private final java.util.concurrent.ConcurrentMap<JobParameters,java.util.concurrent.ExecutorService> workers=new java.util.concurrent.ConcurrentHashMap<>();
 public static void schedule(Context context){
  JobInfo.Builder job=new JobInfo.Builder(ID,new ComponentName(context,DriverOfferSyncJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY);
  if(Build.VERSION.SDK_INT>=31)job.setExpedited(true);
  JobScheduler scheduler=context.getSystemService(JobScheduler.class);
  if(scheduler.schedule(job.build())==JobScheduler.RESULT_FAILURE){scheduler.schedule(new JobInfo.Builder(ID,new ComponentName(context,DriverOfferSyncJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setBackoffCriteria(30000,JobInfo.BACKOFF_POLICY_EXPONENTIAL).build());}
 }
 @Override public boolean onStartJob(JobParameters params){
  android.content.SharedPreferences binding=getSharedPreferences("driver-push",0);
  if(!binding.getBoolean("bound",false))return false;
  String recipient=binding.getString("recipient","");
  java.util.concurrent.ExecutorService worker=java.util.concurrent.Executors.newSingleThreadExecutor();workers.put(params,worker);
  worker.execute(()->{boolean retry=false;try{
   if(SecureDriverSession.load(this,DriverConfig.origin(this)).isEmpty())return;
   DriverNativeApi.Result result=DriverNativeApi.authenticated(this,"GET","driver/updates?cursor=",null);
   // Logout/account replacement or a stopped job must invalidate an in-flight snapshot.
   if(Thread.currentThread().isInterrupted()||!binding.getBoolean("bound",false)||!recipient.equals(binding.getString("recipient",""))||SecureDriverSession.load(this,DriverConfig.origin(this)).isEmpty())return;
   if(result.status==200)DriverNotifications.syncOffers(this,result.body.getJSONObject("data"),DriverNotifications.timestamp(result.body.optString("serverTime"),System.currentTimeMillis()));
   else retry=result.status>=500;
  }catch(Exception failure){retry=true;}finally{if(workers.remove(params,worker))jobFinished(params,retry);worker.shutdown();}});
  return true;
 }
 @Override public boolean onStopJob(JobParameters params){java.util.concurrent.ExecutorService worker=workers.remove(params);if(worker!=null)worker.shutdownNow();return true;}
}
