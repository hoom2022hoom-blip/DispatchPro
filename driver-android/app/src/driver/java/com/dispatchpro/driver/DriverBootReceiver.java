package com.dispatchpro.driver;
import android.content.*;
import android.app.*;
import android.os.Build;
/** No background location permission: ask the driver to resume from the visible app. */
public final class DriverBootReceiver extends BroadcastReceiver {
 @Override public void onReceive(Context context,Intent intent){
  if(!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())||!context.getSharedPreferences("driver-duty",0).getBoolean("online",false)||!DriverNotifications.permitted(context))return;
  NotificationManager manager=context.getSystemService(NotificationManager.class);String channel="driver_connection";
  if(Build.VERSION.SDK_INT>=26)manager.createNotificationChannel(new NotificationChannel(channel,"خدمة تكسي نابلس",NotificationManager.IMPORTANCE_LOW));
  PendingIntent open=PendingIntent.getActivity(context,8101,new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
  Notification.Builder notification=Build.VERSION.SDK_INT>=26?new Notification.Builder(context,channel):new Notification.Builder(context);
  manager.notify(8101,notification.setSmallIcon(R.drawable.ic_driver).setContentTitle("سائق تكسي نابلس والمهندس").setContentText("افتح التطبيق لاستعادة وضع العمل بعد إعادة تشغيل الهاتف").setContentIntent(open).setAutoCancel(true).build());
 }
}
