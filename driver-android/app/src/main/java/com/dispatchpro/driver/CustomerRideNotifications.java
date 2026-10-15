package com.dispatchpro.driver;
import android.app.*;
import android.content.*;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import org.json.*;
import java.util.*;

/** Displays only authenticated snapshots, with durable event dedupe. */
public final class CustomerRideNotifications {
 private static final String CHANNEL="customer_ride_status_v1";
 public static void configure(Context c){if(Build.VERSION.SDK_INT<26)return;NotificationChannel n=new NotificationChannel(CHANNEL,"حالة الرحلة",NotificationManager.IMPORTANCE_HIGH);n.setSound(CommunicationNotifications.sound(c,R.raw.ride_status),new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build());n.enableVibration(true);n.setVibrationPattern(new long[]{0,180});n.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);c.getSystemService(NotificationManager.class).createNotificationChannel(n);}
 public static synchronized void sync(Context c,JSONArray events)throws JSONException{
  if(CommunicationNotifications.driver(c)||events==null)return;configure(c);
  for(int i=events.length()-1;i>=0;i--){JSONObject e=events.getJSONObject(i);String id=e.optString("id"),ride=e.optString("rideId"),status=e.optString("status");if(!id.matches("[a-fA-F0-9-]{36}")||!ride.matches("[a-fA-F0-9-]{36}"))continue;
   if("Arrived".equals(status)){if(e.optBoolean("arrivalAcknowledged"))CustomerArrivalNotifications.acknowledge(c,id);else CustomerArrivalNotifications.show(c,id,ride,e.optString("driverName"));continue;}
   String text;switch(status){case "Assigned":text="جارٍ تأكيد السائق لرحلتك";break;case "Accepted":text="تم تأكيد السائق لرحلتك";break;case "DriverArriving":text="السائق في الطريق إليك";break;case "InProgress":text="بدأت رحلتك";break;case "Completed":text="اكتملت رحلتك";break;case "Cancelled":text="تم إلغاء الرحلة";break;case "NoDriverAvailable":text="لا توجد سيارة متاحة حاليًا";break;default:continue;}
   if(!CommunicationNotifications.permitted(c))continue;android.content.SharedPreferences p=c.getSharedPreferences("customer-ride-events",0);Set<String> seen=new LinkedHashSet<>(p.getStringSet("seen",new LinkedHashSet<>()));if(!seen.add(id))continue;while(seen.size()>256)seen.remove(seen.iterator().next());if(!p.edit().putStringSet("seen",seen).commit())continue;
   Intent open=new Intent(c,CustomerActivity.class).setAction("com.dispatchpro.COMMUNICATION").setData(Uri.parse("dispatchpro://ride/"+ride)).putExtra("rideId",ride).putExtra("communicationAction","ride").addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
   PendingIntent target=PendingIntent.getActivity(c,0,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
   Notification.Builder n=(Build.VERSION.SDK_INT>=26?new Notification.Builder(c,CHANNEL):new Notification.Builder(c)).setSmallIcon(R.drawable.ic_driver).setContentTitle("تكسي نابلس والمهندس").setContentText(text).setContentIntent(target).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).setCategory(Notification.CATEGORY_EVENT).setPriority(Notification.PRIORITY_HIGH);
   if(Build.VERSION.SDK_INT<26)n.setSound(CommunicationNotifications.sound(c,R.raw.ride_status)).setVibrate(new long[]{0,180});c.getSystemService(NotificationManager.class).notify("ride:"+ride,3,n.build());
  }
 }
}
