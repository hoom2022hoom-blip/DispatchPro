package com.dispatchpro.driver;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.Build;

/** Shared by authenticated native synchronization and the visible driver UI. */
public final class DriverNotifications {
    public static final String CHANNEL = "driver_rides_v7";
    private static final android.os.Handler expiry=new android.os.Handler(android.os.Looper.getMainLooper());
    private static final java.util.Map<String,Runnable> deadlines=new java.util.HashMap<>();
    private DriverNotifications() {}
    static String channel(Context context){android.content.SharedPreferences p=context.getSharedPreferences("driver-alerts",0);return CHANNEL+"_"+p.getInt("tone",1)+"_"+p.getBoolean("sound",true)+"_"+p.getBoolean("vibration",true);}
    private static int tone(Context context){int n=context.getSharedPreferences("driver-alerts",0).getInt("tone",1);return n==2?R.raw.driver_request_2:n==3?R.raw.driver_request_3:n==4?R.raw.driver_request_4:R.raw.driver_request_1;}
    private static android.net.Uri sound(Context context){return android.net.Uri.parse("android.resource://"+context.getPackageName()+"/raw/"+context.getResources().getResourceEntryName(tone(context)));}
    public static void configure(Context context) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(channel(context), "طلبات السائق", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("طلبات جديدة؛ تحكم بالصوت والاهتزاز من إعدادات الهاتف");
            channel.setSound(context.getSharedPreferences("driver-alerts",0).getBoolean("sound",true)?sound(context):null,new android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION_COMMUNICATION_REQUEST).build());
            channel.enableVibration(context.getSharedPreferences("driver-alerts",0).getBoolean("vibration",true));channel.setVibrationPattern(new long[]{0,400,180,400});if(BuildConfig.DRIVER_QA)channel.enableVibration(context.getSharedPreferences("driver-alerts",0).getBoolean("vibration",true));
            channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            NotificationChannel old=context.getSystemService(NotificationManager.class).getNotificationChannel(channel(context).replace("v7","v6"));
            if(old!=null){channel.setImportance(old.getImportance());if(old.getSound()==null)channel.setSound(null,null);channel.enableVibration(old.shouldVibrate());}
            context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }
    public static boolean permitted(Context context) {
        return (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
                && context.getSystemService(NotificationManager.class).areNotificationsEnabled() && context.getSharedPreferences("driver-alerts",0).getBoolean("enabled",true);
    }
    public static void show(Context context, String title, String body) {show(context,title,body,"");}
    public static synchronized void close(Context context,String tag){if(!tag.isEmpty()){context.getSystemService(NotificationManager.class).cancel(tag,0);Runnable timer=deadlines.remove(tag);if(timer!=null)expiry.removeCallbacks(timer);}}
    static synchronized void closeOffers(Context context){for(String tag:new java.util.ArrayList<>(deadlines.keySet()))close(context,tag);for(android.service.notification.StatusBarNotification notification:context.getSystemService(NotificationManager.class).getActiveNotifications())if(notification.getTag()!=null&&notification.getTag().startsWith("driver-offer-"))close(context,notification.getTag());}
    static long timestamp(String value,long fallback){try{if(android.os.Build.VERSION.SDK_INT>=26)return java.time.Instant.parse(value).toEpochMilli();return new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSX",java.util.Locale.ROOT).parse(value.replaceFirst("(\\.\\d{3})\\d+","$1")).getTime();}catch(Exception invalid){return fallback;}}
    public static synchronized void offer(Context context,String rideId,String eventId,String offerKey,long remaining){
        offer(context,rideId,eventId,offerKey,remaining,"افتح الطلب للاطلاع عليه وقبوله.");
    }
    public static synchronized void offer(Context context,String rideId,String eventId,String offerKey,long remaining,String details){
        if(!rideId.matches("[a-fA-F0-9-]{36}")||remaining==0||remaining< -1||!permitted(context))return;
        android.content.SharedPreferences store=context.getSharedPreferences("driver-alerts",0);
        java.util.Set<String> offers=new java.util.LinkedHashSet<>(store.getStringSet("offers",new java.util.LinkedHashSet<>()));
        if(!offers.add(offerKey))return;while(offers.size()>256)offers.remove(offers.iterator().next());
        if(!store.edit().putStringSet("offers",offers).commit())return;
        String tag="driver-offer-"+rideId;
        show(context,"طلب سيارة جديد",details,tag,eventId,remaining);
        if(remaining>0){Runnable cancel=()->close(context,tag);Runnable previous=deadlines.put(tag,cancel);if(previous!=null)expiry.removeCallbacks(previous);expiry.postDelayed(cancel,remaining);}
    }
    static void syncOffers(Context context,org.json.JSONObject data,long serverTime)throws org.json.JSONException {
        org.json.JSONArray rides=data.getJSONArray("rides"),notices=data.optJSONArray("notices");java.util.Set<String> current=new java.util.HashSet<>();
        for(int i=0;i<rides.length();i++){org.json.JSONObject ride=rides.getJSONObject(i);if(!"Assigned".equals(ride.optString("status")))continue;
            String id=ride.getString("id"),end=ride.isNull("offerExpiresAt")?"":ride.optString("offerExpiresAt","");long remaining=DriverOfferPolicy.notificationLifetime(ride.optString("status"),!end.isEmpty(),timestamp(end,0),serverTime);if(remaining==0)continue;current.add("driver-offer-"+id);String event="";
            if(notices!=null)for(int n=0;n<notices.length();n++){org.json.JSONObject notice=notices.getJSONObject(n);if(id.equals(notice.optString("entityId"))&&notice.optString("action").endsWith(".Assigned"))event=notice.optString("id");}
            String details=ride.optString("pickup","طلب سيارة جديد");if(!ride.optString("destination").isEmpty())details+=" ← "+ride.optString("destination");offer(context,id,event,id+":"+end,remaining,details.substring(0,Math.min(details.length(),180)));
        }
        synchronized(DriverNotifications.class){for(String tag:new java.util.ArrayList<>(deadlines.keySet()))if(!current.contains(tag))close(context,tag);for(android.service.notification.StatusBarNotification notification:context.getSystemService(NotificationManager.class).getActiveNotifications())if(notification.getTag()!=null&&notification.getTag().startsWith("driver-offer-")&&!current.contains(notification.getTag()))close(context,notification.getTag());}
    }
    public static void show(Context context, String title, String body,String tag) {show(context,title,body,tag,"");}
    public static synchronized void show(Context context, String title, String body,String tag,String eventId) {
        show(context,title,body,tag,eventId,0);
    }
    private static synchronized void show(Context context, String title, String body,String tag,String eventId,long remaining) {
        if (!permitted(context)) return;configure(context);
        if(eventId.matches("[a-fA-F0-9-]{36}")){android.content.SharedPreferences store=context.getSharedPreferences("driver-alerts",0);java.util.Set<String> seen=new java.util.LinkedHashSet<>(store.getStringSet("events",new java.util.LinkedHashSet<>()));if(!seen.add(eventId))return;while(seen.size()>256)seen.remove(seen.iterator().next());if(!store.edit().putStringSet("events",seen).commit())return;}
        Intent open = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        boolean request=tag.startsWith("driver-offer-");
        if(request)open.setAction("com.dispatchpro.driver.OPEN_OFFER").putExtra("rideId",tag.substring("driver-offer-".length())).setData(android.net.Uri.parse("dispatchpro://offer/"+tag.substring("driver-offer-".length())));
        PendingIntent intent = PendingIntent.getActivity(context, request?tag.hashCode():0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String delivery=BuildConfig.DRIVER_QA&&request&&QaSounds.speechBusy(context)?QaSounds.quietChannel(context,"qa_order_quiet_v1"):channel(context);
        if(BuildConfig.DRIVER_QA&&!request&&Build.VERSION.SDK_INT>=26){delivery="qa_driver_updates_silent_v1";NotificationChannel quiet=new NotificationChannel(delivery,"تحديثات الرحلة دون صوت",NotificationManager.IMPORTANCE_LOW);quiet.setSound(null,null);quiet.enableVibration(false);context.getSystemService(NotificationManager.class).createNotificationChannel(quiet);}
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(context, delivery) : new Notification.Builder(context);
        builder.setSmallIcon(R.drawable.ic_driver).setContentTitle(title).setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body)).setContentIntent(intent).setAutoCancel(!request)
            .setVisibility(Notification.VISIBILITY_PRIVATE).setCategory(Notification.CATEGORY_EVENT);
        if(Build.VERSION.SDK_INT>=26&&remaining>0)builder.setTimeoutAfter(remaining);
        if (Build.VERSION.SDK_INT < 26) {builder.setPriority(Notification.PRIORITY_HIGH);if(context.getSharedPreferences("driver-alerts",0).getBoolean("sound",true))builder.setSound(sound(context));if(context.getSharedPreferences("driver-alerts",0).getBoolean("vibration",true))builder.setVibrate(new long[]{0,400,180,400});}
        if(BuildConfig.DRIVER_QA&&(!request||QaSounds.speechBusy(context))){if(Build.VERSION.SDK_INT<26)builder.setSound(null).setVibrate(null);}
        context.getSystemService(NotificationManager.class).notify(tag.isEmpty()?"driver-event":tag, tag.isEmpty()?(title+body).hashCode():0, builder.build());
    }
}
