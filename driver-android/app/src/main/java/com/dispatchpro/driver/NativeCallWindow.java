package com.dispatchpro.driver;
import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.view.WindowManager;
final class NativeCallWindow {
 static void apply(Activity activity, Intent intent) {
  boolean call = "com.dispatchpro.COMMUNICATION".equals(intent.getAction()) && PushDisplayPolicy.guid(intent.getStringExtra("callId"));
  if (Build.VERSION.SDK_INT>=27) { activity.setShowWhenLocked(call); activity.setTurnScreenOn(call); }
  else if(call)activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED|WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
  else activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED|WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
 }
}
