package com.dispatchpro.driver;
import android.app.job.*;
import android.content.*;
/** Three bounded, inexact reminders. Never exact alarms or continuous background audio. */
public final class CustomerArrivalReminderJob extends JobService{
 private static final int ID=2308;
 public static void schedule(Context context,String event){synchronized(CustomerArrivalNotifications.class){context.getSharedPreferences("customer-arrival",0).edit().putString("pending",event).putInt("reminders",0).putLong("until",System.currentTimeMillis()+600000).commit();next(context);}}
 private static void next(Context context){context.getSystemService(JobScheduler.class).schedule(new JobInfo.Builder(ID,new ComponentName(context,CustomerArrivalReminderJob.class)).setMinimumLatency(60000).build());}
 @Override public boolean onStartJob(JobParameters params){synchronized(CustomerArrivalNotifications.class){android.content.SharedPreferences store=getSharedPreferences("customer-arrival",0);String event=store.getString("pending","");int count=store.getInt("reminders",0);if(event.isEmpty()||count>=3||store.getLong("until",0)<System.currentTimeMillis())return false;store.edit().putInt("reminders",count+1).commit();CustomerArrivalNotifications.remind(this,event);if(count+1<3)next(this);return false;}}
 @Override public boolean onStopJob(JobParameters params){return false;}
}
