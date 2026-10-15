package com.dispatchpro.driver;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import java.util.LinkedHashSet;
import java.util.Set;

/** Shared persistent dedupe for bound FCM and authenticated backend arrival snapshots. */
public final class CustomerArrivalNotifications {
    private static final String CHANNEL = "customer_arrival_v1";
    private CustomerArrivalNotifications() {}
    private static Uri sound(Context context) { return Uri.parse("android.resource://" + context.getPackageName() + "/" + R.raw.customer_arrival); }
    public static void configure(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL, "وصول السائق", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("تنبيه وصول السائق إلى موقع الانطلاق");
        channel.setSound(sound(context), new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build());
        channel.enableVibration(true);channel.setVibrationPattern(new long[]{0,350,180,350});
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }
    public static synchronized void show(Context context, String eventId) {
        show(context,eventId,"","");
    }
    public static synchronized void show(Context context, String eventId, String rideId) {
        show(context,eventId,rideId,"");
    }
    public static synchronized void show(Context context, String eventId, String rideId, String driverName) {
        if(eventId==null)return;
        if (!eventId.matches("[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}")) return;
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager manager=context.getSystemService(NotificationManager.class);
        if (!manager.areNotificationsEnabled()) return;
        configure(context);
        if (Build.VERSION.SDK_INT>=26 && manager.getNotificationChannel(CHANNEL).getImportance()==NotificationManager.IMPORTANCE_NONE) return;
        android.content.SharedPreferences store=context.getSharedPreferences("customer-arrival",Context.MODE_PRIVATE);
        if(rideId!=null&&rideId.matches("[a-fA-F0-9-]{36}"))store.edit().putString("ride:"+eventId,rideId).commit();
        if(driverName!=null&&!driverName.isEmpty())store.edit().putString("name:"+eventId,PushDisplayPolicy.name(driverName)).commit();
        if(store.getStringSet("acknowledged",new LinkedHashSet<>()).contains(eventId))return;
        Set<String> seen=new LinkedHashSet<>(store.getStringSet("seen",new LinkedHashSet<>()));
        if (!seen.add(eventId)) return;while(seen.size()>256)seen.remove(seen.iterator().next());
        // Persist before display: reconnection/reopening must never ring this event twice.
        if (!store.edit().putStringSet("seen",seen).commit()) return;
        try { display(context,eventId,false); } catch (RuntimeException denied) { seen.remove(eventId);store.edit().putStringSet("seen",seen).commit(); }
    }
    public static synchronized void acknowledge(Context context,String eventId){
        if(eventId==null||!eventId.matches("[a-fA-F0-9-]{36}"))return;
        android.content.SharedPreferences store=context.getSharedPreferences("customer-arrival",Context.MODE_PRIVATE);
        Set<String> acknowledged=new LinkedHashSet<>(store.getStringSet("acknowledged",new LinkedHashSet<>()));acknowledged.add(eventId);while(acknowledged.size()>256)acknowledged.remove(acknowledged.iterator().next());store.edit().putStringSet("acknowledged",acknowledged).commit();
        if(eventId.equals(store.getString("pending","")))store.edit().remove("pending").commit();
        context.getSystemService(NotificationManager.class).cancel(eventId,0);
    }
    public static synchronized void remind(Context context,String eventId){
        if(!eventId.equals(context.getSharedPreferences("customer-arrival",Context.MODE_PRIVATE).getString("pending","")))return;
        if(Build.VERSION.SDK_INT>=33&&context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return;
        if(!context.getSystemService(NotificationManager.class).areNotificationsEnabled())return;
        display(context,eventId,true);
    }
    private static void display(Context context,String eventId,boolean reminder){
        NotificationManager manager=context.getSystemService(NotificationManager.class);
        String ride=context.getSharedPreferences("customer-arrival",0).getString("ride:"+eventId,"");
        Intent open=new Intent(context,CustomerActivity.class).setAction("com.dispatchpro.COMMUNICATION").setData(Uri.parse("dispatchpro://arrival/"+eventId)).putExtra("rideId",ride).putExtra("communicationAction","ride").addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent intent=PendingIntent.getActivity(context,0,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder=Build.VERSION.SDK_INT>=26?new Notification.Builder(context,CHANNEL):new Notification.Builder(context);
        String name=context.getSharedPreferences("customer-arrival",0).getString("name:"+eventId,"السائق");
        builder.setSmallIcon(R.drawable.ic_driver).setContentTitle("السائق وصل إلى موقعك")
            .setContentText(name+" بانتظارك في موقع الانطلاق").setContentIntent(intent).setAutoCancel(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE).setCategory(Notification.CATEGORY_EVENT).setOnlyAlertOnce(!reminder);
        if (Build.VERSION.SDK_INT<26) builder.setPriority(Notification.PRIORITY_HIGH).setSound(sound(context)).setVibrate(new long[]{0,350,180,350});
        manager.notify(eventId,0,builder.build());
    }
}
