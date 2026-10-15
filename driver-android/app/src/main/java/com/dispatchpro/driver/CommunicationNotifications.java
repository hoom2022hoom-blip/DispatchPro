package com.dispatchpro.driver;
import android.app.*;
import android.content.*;
import android.media.*;
import android.net.Uri;
import android.os.*;
import org.json.*;
import java.util.*;

/** Shared event dedupe for native long-poll, FCM wakeups and foreground UI. */
public final class CommunicationNotifications {
 public static final String CHAT="ride_chat_v2",CALL="ride_calls_v1",PTT="ride_ptt_v1";
 static boolean driver(Context c){return "com.dispatchpro.driver".equals(c.getPackageName())||BuildConfig.DRIVER_QA&&"com.dispatchpro.driver.qa".equals(c.getPackageName());}
 static boolean permitted(Context c){return (!BuildConfig.DRIVER_QA||c.getSharedPreferences("driver-alerts",0).getBoolean("enabled",true))&&(Build.VERSION.SDK_INT<33||c.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)==android.content.pm.PackageManager.PERMISSION_GRANTED)&&c.getSystemService(NotificationManager.class).areNotificationsEnabled();}
 static Class<?> activity(Context c){return driver(c)?MainActivity.class:CustomerActivity.class;}
 static String device(Context c){android.content.SharedPreferences p=c.getSharedPreferences("communication-device",0);String value=p.getString("id","");if(value.isEmpty()){value=UUID.randomUUID().toString();p.edit().putString("id",value).commit();}return value;}
 static void activate(Context c){c.getSharedPreferences("communication-auth",0).edit().putBoolean("active",true).commit();}
 static void clear(Context c){android.content.SharedPreferences p=c.getSharedPreferences("communication-auth",0);p.edit().putBoolean("active",false).putLong("generation",p.getLong("generation",0)+1).commit();MobileNativeApi.clear();for(android.service.notification.StatusBarNotification n:c.getSystemService(NotificationManager.class).getActiveNotifications())if(n.getTag()!=null&&(n.getTag().startsWith("chat:")||n.getTag().startsWith("call:")||n.getTag().startsWith("ride:")||n.getId()==0&&!driver(c)))c.getSystemService(NotificationManager.class).cancel(n.getTag(),n.getId());}
 static Uri sound(Context c,int id){return Uri.parse("android.resource://"+c.getPackageName()+"/raw/"+c.getResources().getResourceEntryName(id));}
 public static void configure(Context c){if(Build.VERSION.SDK_INT<26)return;NotificationManager manager=c.getSystemService(NotificationManager.class);channel(manager,CHAT,"رسائل الرحلة",sound(c,R.raw.chat_message),AudioAttributes.USAGE_NOTIFICATION_COMMUNICATION_INSTANT,new long[]{0,220,100,220});channel(manager,CALL,"مكالمات الرحلة",sound(c,R.raw.incoming_call),AudioAttributes.USAGE_NOTIFICATION_RINGTONE,new long[]{0,600,300,600});channel(manager,PTT,"المخشيرة PTT",sound(c,R.raw.ptt_alert),AudioAttributes.USAGE_NOTIFICATION,new long[]{0,150});}
 private static void channel(NotificationManager m,String id,String title,Uri sound,int usage,long[] vibration){if(Build.VERSION.SDK_INT<26)return;NotificationChannel c=new NotificationChannel(id,title,NotificationManager.IMPORTANCE_HIGH);c.setSound(sound,new AudioAttributes.Builder().setUsage(usage).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());c.enableVibration(true);c.setVibrationPattern(vibration);c.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);m.createNotificationChannel(c);}
 private static boolean first(Context c,String id){android.content.SharedPreferences p=c.getSharedPreferences("communication-events",0);Set<String> seen=new LinkedHashSet<>(p.getStringSet("seen",new LinkedHashSet<>()));if(!seen.add(id))return false;while(seen.size()>512)seen.remove(seen.iterator().next());return p.edit().putStringSet("seen",seen).commit();}
 static PendingIntent open(Context c,String ride,String call,String action){Intent i=new Intent(c,activity(c)).setAction("com.dispatchpro.COMMUNICATION").setData(Uri.parse("dispatchpro://communication/"+(call.isEmpty()?ride:call)+"/"+action)).putExtra("rideId",ride).putExtra("callId",call).putExtra("communicationAction",action).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);return PendingIntent.getActivity(c,0,i,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
 private static Notification.Builder builder(Context c,String channel){return (Build.VERSION.SDK_INT>=26?new Notification.Builder(c,channel):new Notification.Builder(c)).setSmallIcon(R.drawable.ic_driver).setVisibility(Notification.VISIBILITY_PRIVATE).setPriority(Notification.PRIORITY_HIGH);}
 static String preferenceChannel(Context c,String id){if(!BuildConfig.DRIVER_QA||Build.VERSION.SDK_INT<26)return id;var prefs=c.getSharedPreferences("driver-alerts",0);boolean audible=prefs.getBoolean("sound",true),vibration=prefs.getBoolean("vibration",true);if(audible&&vibration)return id;configure(c);NotificationManager manager=c.getSystemService(NotificationManager.class);NotificationChannel old=manager.getNotificationChannel(id);String key=id+"_qa_"+audible+"_"+vibration;NotificationChannel chosen=new NotificationChannel(key,old.getName(),old.getImportance());chosen.setSound(audible?old.getSound():null,old.getAudioAttributes());chosen.setVibrationPattern(old.getVibrationPattern());chosen.enableVibration(vibration&&old.shouldVibrate());chosen.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);manager.createNotificationChannel(chosen);return key;}
 private static void legacyPreferences(Context c,Notification.Builder b){if(!BuildConfig.DRIVER_QA||Build.VERSION.SDK_INT>=26)return;var prefs=c.getSharedPreferences("driver-alerts",0);if(!prefs.getBoolean("sound",true))b.setSound(null);if(!prefs.getBoolean("vibration",true))b.setVibrate(null);}
 public static synchronized void sync(Context c,JSONObject data,long server)throws JSONException{
  if(!c.getSharedPreferences("communication-auth",0).getBoolean("active",false))return;
  c.getSharedPreferences("communication-metrics",0).edit().putLong("serverOffsetMs",server-System.currentTimeMillis()).apply();
  configure(c);NotificationManager manager=c.getSystemService(NotificationManager.class);JSONArray chat=data.optJSONArray("chat"),calls=data.optJSONArray("calls");Set<String> incoming=new HashSet<>();
  CustomerRideNotifications.sync(c,data.optJSONArray("rideEvents"));
  if(chat!=null)for(int i=0;i<chat.length();i++){JSONObject m=chat.getJSONObject(i);String id=m.optString("id"),ride=m.optString("rideId");if(BuildConfig.DRIVER_QA&&m.optBoolean("mine"))continue;if(!permitted(c)||!id.matches("[a-fA-F0-9-]{36}")||!ride.matches("[a-fA-F0-9-]{36}")||!first(c,"chat:"+id))continue;
   if(BuildConfig.DRIVER_QA&&QaSounds.chatVisible(c,ride)){manager.cancel("chat:"+ride,1);continue;}
   int count=data.optJSONObject("unread")==null?1:data.getJSONObject("unread").optInt(ride,1);Notification.Builder b=builder(c,BuildConfig.DRIVER_QA&&QaSounds.speechBusy(c)?QaSounds.quietChannel(c,"qa_chat_quiet_v1"):preferenceChannel(c,CHAT)).setContentTitle(m.optString("senderName","رسالة جديدة")).setContentText(m.optString("text")).setStyle(new Notification.BigTextStyle().bigText(m.optString("text"))).setContentIntent(open(c,ride,"","chat")).setCategory(Notification.CATEGORY_MESSAGE).setNumber(count).setAutoCancel(true);if(Build.VERSION.SDK_INT<26)b.setSound(sound(c,R.raw.chat_message)).setVibrate(new long[]{0,220,100,220});if(BuildConfig.DRIVER_QA&&QaSounds.speechBusy(c)){if(Build.VERSION.SDK_INT<26)b.setSound(null).setVibrate(null);}legacyPreferences(c,b);manager.notify("chat:"+ride,1,b.build());}
  if(calls!=null)for(int i=0;i<calls.length();i++){
   JSONObject s=calls.getJSONObject(i);String id=s.optString("id");
   long remaining=DriverNotifications.timestamp(s.optString("expiresAt"),0)-server;
   if(!"ringing".equals(s.optString("state"))||s.optBoolean("caller")||remaining<=0){
    if(!s.optBoolean("caller")&&"expired".equals(s.optString("state"))&&s.isNull("answeredAt"))missed(c,s,true);
    finishCall(c,id,s.optLong("revision",2));continue;
   }
   incoming.add("call:"+id);showIncoming(c,s,remaining);
  }
  for(android.service.notification.StatusBarNotification n:manager.getActiveNotifications())if(n.getTag()!=null&&n.getTag().startsWith("call:")&&!incoming.contains(n.getTag()))manager.cancel(n.getTag(),2);
  c.getSharedPreferences("driver-health",0).edit().putLong("realtimeAt",System.currentTimeMillis()).apply();
 }
 public static synchronized void showIncoming(Context c,JSONObject s,long remaining){
  String id=s.optString("id"),ride=s.optString("rideId");
  if(!c.getSharedPreferences("communication-auth",0).getBoolean("active",false))return;
  if(!PushDisplayPolicy.guid(id)||!PushDisplayPolicy.guid(ride)||remaining<=0)return;
  android.content.SharedPreferences state=c.getSharedPreferences("native-call-state",0);
  if(state.getBoolean("done:"+id,false))return;
  configure(c);NotificationManager manager=c.getSystemService(NotificationManager.class);
  if(!permitted(c)||Build.VERSION.SDK_INT>=26&&manager.getNotificationChannel(CALL).getImportance()==NotificationManager.IMPORTANCE_NONE)return;
  if(!first(c,"call:"+id))return;
  state.edit().putString("ride:"+id,ride).putString("peer:"+id,PushDisplayPolicy.name(s.optString("peerName"))).putLong("expires:"+id,System.currentTimeMillis()+remaining).commit();
  PendingIntent answer=open(c,ride,id,"answer");
  Intent reject=new Intent(c,CallActionReceiver.class).setAction("reject").setData(Uri.parse("dispatchpro://reject/"+id)).putExtra("callId",id);
  PendingIntent decline=PendingIntent.getBroadcast(c,0,reject,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  String name=PushDisplayPolicy.name(s.optString("peerName"));
  Notification.Builder b=builder(c,preferenceChannel(c,CALL)).setContentTitle("مكالمة واردة · "+name).setContentText("تكسي نابلس والمهندس · رد أو رفض")
   .setContentIntent(open(c,ride,id,"open")).setCategory(Notification.CATEGORY_CALL).setOngoing(true);
  if(Build.VERSION.SDK_INT>=26)b.setTimeoutAfter(remaining);
  if(Build.VERSION.SDK_INT>=31)b.setStyle(Notification.CallStyle.forIncomingCall(new Person.Builder().setName(name).setImportant(true).build(),decline,answer));
  else b.addAction(new Notification.Action.Builder(null,"رد",answer).build()).addAction(new Notification.Action.Builder(null,"رفض",decline).build());
  if(Build.VERSION.SDK_INT<26)b.setSound(sound(c,R.raw.incoming_call)).setVibrate(new long[]{0,600,300,600});
  // Android owns launching from this PendingIntent. Never startActivity from FCM.
  if(c.checkSelfPermission(android.Manifest.permission.USE_FULL_SCREEN_INTENT)==android.content.pm.PackageManager.PERMISSION_GRANTED&&(Build.VERSION.SDK_INT<34||manager.canUseFullScreenIntent()))b.setFullScreenIntent(open(c,ride,id,"open"),true);
  legacyPreferences(c,b);Notification notification=b.build();notification.flags|=Notification.FLAG_INSISTENT;
  if(BuildConfig.DRIVER_QA){QaSounds.stop(c);DriverNotifications.closeOffers(c);}
  manager.notify("call:"+id,2,notification);
  c.getSharedPreferences("communication-metrics",0).edit().putLong("callNotificationAt",System.currentTimeMillis()).apply();
  Intent expire=new Intent(c,CallActionReceiver.class).setAction("expire").setData(Uri.parse("dispatchpro://expire/"+id)).putExtra("callId",id).putExtra("rideId",ride).putExtra("peerName",name);
  PendingIntent timeout=PendingIntent.getBroadcast(c,0,expire,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  c.getSystemService(AlarmManager.class).setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,SystemClock.elapsedRealtime()+remaining,timeout);
 }
 public static synchronized void finishCall(Context c,String id,long revision){
  if(!PushDisplayPolicy.guid(id))return;
  c.getSharedPreferences("native-call-state",0).edit().putBoolean("done:"+id,true).putLong("revision:"+id,revision).commit();
  cancelCall(c,id);
 }
 static synchronized void missed(Context c,JSONObject s){missed(c,s,false);}
 static synchronized void missed(Context c,JSONObject s,boolean confirmedExpired){
  String id=s.optString("id"),ride=s.optString("rideId");
  android.content.SharedPreferences state=c.getSharedPreferences("native-call-state",0);
  // CALL_END may beat the expiry alarm. An authenticated expired snapshot
  // still deserves one missed notification, unless the user declined locally.
  if(!PushDisplayPolicy.missedEligible(c.getSharedPreferences("communication-auth",0).getBoolean("active",false),state.getBoolean("done:"+id,false),state.getBoolean("declined:"+id,false),confirmedExpired)||!PushDisplayPolicy.guid(id)||!PushDisplayPolicy.guid(ride)||!permitted(c)||!first(c,"missed:"+id))return;
  configure(c);
  Notification.Builder n=builder(c,BuildConfig.DRIVER_QA?QaSounds.quietChannel(c,"qa_missed_quiet_v1"):CHAT).setContentTitle("مكالمة فائتة").setContentText(PushDisplayPolicy.name(s.optString("peerName")))
   .setContentIntent(open(c,ride,"","ride")).setCategory(Notification.CATEGORY_MISSED_CALL).setAutoCancel(true).setOnlyAlertOnce(true);
  c.getSystemService(NotificationManager.class).notify("missed:"+id,4,n.build());
 }
 static void cancelCall(Context c,String id){if(id!=null){
  
  c.getSystemService(NotificationManager.class).cancel("call:"+id,2);
  Intent expire=new Intent(c,CallActionReceiver.class).setAction("expire").setData(Uri.parse("dispatchpro://expire/"+id));
  PendingIntent timeout=PendingIntent.getBroadcast(c,0,expire,PendingIntent.FLAG_NO_CREATE|PendingIntent.FLAG_IMMUTABLE);
  if(timeout!=null){c.getSystemService(AlarmManager.class).cancel(timeout);timeout.cancel();}
 }}
 static String soundChannel(Context c,int index){configure(c);DriverNotifications.configure(c);CustomerArrivalNotifications.configure(c);return index==0?DriverNotifications.channel(c):index==1?preferenceChannel(c,CHAT):index==2?preferenceChannel(c,CALL):index==3?preferenceChannel(c,PTT):"customer_arrival_v1";}
 static void test(Context c,int index){int id=index==0?R.raw.driver_request_1:index==1?R.raw.chat_message:index==2?R.raw.incoming_call:index==3?R.raw.ptt_alert:R.raw.customer_arrival;Uri uri=sound(c,id);if(Build.VERSION.SDK_INT>=26){NotificationChannel channel=c.getSystemService(NotificationManager.class).getNotificationChannel(soundChannel(c,index));if(channel!=null)uri=channel.getSound();}if(uri==null){android.widget.Toast.makeText(c,"صوت هذه القناة معطل في إعدادات الهاتف",android.widget.Toast.LENGTH_LONG).show();return;}Ringtone tone=RingtoneManager.getRingtone(c,uri);if(tone==null)return;tone.setAudioAttributes(new AudioAttributes.Builder().setUsage(index==2?AudioAttributes.USAGE_NOTIFICATION_RINGTONE:AudioAttributes.USAGE_NOTIFICATION).build());tone.play();new Handler(Looper.getMainLooper()).postDelayed(tone::stop,4000);}
}
