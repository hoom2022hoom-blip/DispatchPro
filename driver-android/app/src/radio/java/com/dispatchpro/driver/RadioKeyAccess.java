package com.dispatchpro.driver;
import android.accessibilityservice.AccessibilityService;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityEvent;

/** Opt-in official key filter; no screen contents, text, gestures or event logging. */
public final class RadioKeyAccess extends AccessibilityService {
 static boolean connected;
 @Override protected void onServiceConnected(){connected=true;RadioService s=RadioService.instance;if(s!=null)s.changed();}
 @Override protected boolean onKeyEvent(KeyEvent event){RadioService s=RadioService.instance;return s!=null&&s.keys!=null&&s.keys.key(event,"AccessibilityService");}
 @Override public void onAccessibilityEvent(AccessibilityEvent event){}
 @Override public void onInterrupt(){RadioService s=RadioService.instance;if(s!=null&&s.keys!=null)s.keys.release("انقطعت خدمة الأزرار");}
 @Override public void onDestroy(){connected=false;onInterrupt();super.onDestroy();}
}
