package com.dispatchpro.driver;
import android.app.*;
import android.content.Context;
import android.media.*;
import android.os.*;
import java.util.*;

/** Local QA-only arbitration. Never changes global volume, DND or Bluetooth settings. */
final class QaSounds {
 static String quietChannel(Context c,String id){if(Build.VERSION.SDK_INT>=26){NotificationChannel channel=new NotificationChannel(id,"تنبيهات QA دون صوت",NotificationManager.IMPORTANCE_LOW);channel.setSound(null,null);channel.enableVibration(false);c.getSystemService(NotificationManager.class).createNotificationChannel(channel);}return id;}
 private static final Handler handler=new Handler(Looper.getMainLooper());
 private static Ringtone tone;private static ToneGenerator ringback;private static Runnable ringTimer;
 private static long lastError;
 private static AudioFocusRequest focus;private static AudioManager focusManager;
 private static void releaseFocus(){if(focusManager!=null){try{if(Build.VERSION.SDK_INT>=26&&focus!=null)focusManager.abandonAudioFocusRequest(focus);else focusManager.abandonAudioFocus(null);}catch(RuntimeException ignored){}}focus=null;focusManager=null;}
 private static boolean shortFocus(Context c,String kind){if(kind.startsWith("ptt-"))return true;AudioManager manager=c.getSystemService(AudioManager.class);int grant;if(Build.VERSION.SDK_INT>=26){focus=new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build()).setOnAudioFocusChangeListener(change->{if(change<0)stop(c);}).build();grant=manager.requestAudioFocus(focus);}else grant=manager.requestAudioFocus(change->{if(change<0)stop(c);},AudioManager.STREAM_NOTIFICATION,AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);focusManager=manager;if(grant!=AudioManager.AUDIOFOCUS_REQUEST_GRANTED){releaseFocus();return false;}return true;}
 static boolean enabled(Context c){
  if(!BuildConfig.DRIVER_QA)return false;
  AudioManager a=c.getSystemService(AudioManager.class);NotificationManager n=c.getSystemService(NotificationManager.class);
  var p=c.getSharedPreferences("driver-alerts",0);
  var channel=Build.VERSION.SDK_INT>=26?n.getNotificationChannel(DriverNotifications.channel(c)):null;
  return p.getBoolean("sound",true)&&p.getBoolean("enabled",true)&&n.areNotificationsEnabled()&&a.getRingerMode()==AudioManager.RINGER_MODE_NORMAL&&n.getCurrentInterruptionFilter()==NotificationManager.INTERRUPTION_FILTER_ALL&&(channel==null||channel.getSound()!=null&&channel.getImportance()!=NotificationManager.IMPORTANCE_NONE);
 }
 static boolean callBusy(Context c){if(CallAudioService.requested)return true;for(var n:c.getSystemService(NotificationManager.class).getActiveNotifications())if(n.getTag()!=null&&n.getTag().startsWith("call:"))return true;return false;}
 static boolean speechBusy(Context c){return callBusy(c)||c.getSharedPreferences("qa-audio",0).getBoolean("voiceActive",false);}
 static boolean chatVisible(Context c,String id){var p=c.getSharedPreferences("qa-audio",0);return p.getBoolean("foreground",false)&&id.equals(p.getString("chat",""));}
 static synchronized void play(Context c,String kind,String key){
  if(!enabled(c)||callBusy(c)||speechBusy(c)&&!kind.startsWith("ptt-"))return;
  int resource,duration;
  switch(kind){case "accepted":resource=R.raw.qa_accept;duration=130;break;case "ptt-start":case "ptt-receive":resource=R.raw.ptt_alert;duration=170;break;case "ptt-end":resource=R.raw.qa_ptt_end;duration=90;break;case "error":case "busy":resource=R.raw.qa_error;duration=120;break;default:return;}
  if(kind.equals("error")||kind.equals("busy")){long now=SystemClock.elapsedRealtime();if(lastError>0&&now-lastError<15000)return;lastError=now;}
  if(!key.matches("[A-Za-z0-9-]{1,80}"))return;
  var prefs=c.getSharedPreferences("qa-audio",0);Set<String> seen=new LinkedHashSet<>(prefs.getStringSet("seen",new HashSet<>()));if(!seen.add(kind+":"+key))return;while(seen.size()>512)seen.remove(seen.iterator().next());prefs.edit().putStringSet("seen",seen).commit();
  stop(c);
  try{if(!shortFocus(c,kind))return;Ringtone next=RingtoneManager.getRingtone(c,CommunicationNotifications.sound(c,resource));if(next==null){releaseFocus();return;}next.setAudioAttributes(new AudioAttributes.Builder().setUsage(kind.startsWith("ptt-")?AudioAttributes.USAGE_VOICE_COMMUNICATION:AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());if(Build.VERSION.SDK_INT>=28)next.setVolume(.25f);tone=next;next.play();handler.postDelayed(()->{try{next.stop();}catch(RuntimeException ignored){}if(tone==next){tone=null;releaseFocus();}},duration);android.util.Log.i("QaSounds","event="+kind);}catch(RuntimeException failure){releaseFocus();android.util.Log.w("QaSounds","Short tone unavailable");}
 }
 static synchronized void stop(Context c){if(tone!=null){try{tone.stop();}catch(RuntimeException ignored){}tone=null;}releaseFocus();}
 static synchronized void ringback(Context c,boolean active){
  if(ringTimer!=null)handler.removeCallbacks(ringTimer);ringTimer=null;if(ringback!=null){try{ringback.release();}catch(RuntimeException ignored){}ringback=null;}
  if(!active||!enabled(c))return;
  try{ringback=new ToneGenerator(AudioManager.STREAM_VOICE_CALL,15);ringTimer=new Runnable(){public void run(){if(ringback==null)return;if(!enabled(c)){ringback(c,false);return;}try{ringback.startTone(ToneGenerator.TONE_SUP_RINGTONE,200);handler.postDelayed(this,2500);}catch(RuntimeException unavailable){try{ringback.release();}catch(RuntimeException ignored){}ringback=null;ringTimer=null;}}};ringTimer.run();}catch(RuntimeException denied){ringback=null;ringTimer=null;}
 }
}
