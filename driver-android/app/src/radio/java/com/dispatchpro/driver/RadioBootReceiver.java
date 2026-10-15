package com.dispatchpro.driver;
import android.app.*;
import android.content.*;
/** Restricted boot launches are replaced by an explicit reconnect notification. */
public final class RadioBootReceiver extends BroadcastReceiver {
 @Override public void onReceive(Context c,Intent i){if(!c.getSharedPreferences("radio-runtime",0).getBoolean("requested",false))return;
  if(android.os.Build.VERSION.SDK_INT<35&&Intent.ACTION_BOOT_COMPLETED.equals(i.getAction()))try{Intent receive=new Intent(c,RadioService.class).setAction("com.dispatchpro.radio.RESTORE_RECEIVE");if(android.os.Build.VERSION.SDK_INT>=26)c.startForegroundService(receive);else c.startService(receive);return;}catch(RuntimeException restricted){ /* Fall through to explicit user restoration. */ }
  if(!DriverNotifications.permitted(c))return;NotificationManager nm=c.getSystemService(NotificationManager.class);
  if(android.os.Build.VERSION.SDK_INT>=26)nm.createNotificationChannel(new NotificationChannel("tnm-reconnect","استعادة المخشير",NotificationManager.IMPORTANCE_DEFAULT));
  PendingIntent pi=PendingIntent.getActivity(c,104,new Intent(c,RadioActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  Notification.Builder b=android.os.Build.VERSION.SDK_INT>=26?new Notification.Builder(c,"tnm-reconnect"):new Notification.Builder(c);
  nm.notify(104,b.setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentTitle("مخشير TNM").setContentText("اضغط لاستعادة اتصال المخشير بحسابك المحفوظ").setContentIntent(pi).setAutoCancel(true).build());
 }
}
