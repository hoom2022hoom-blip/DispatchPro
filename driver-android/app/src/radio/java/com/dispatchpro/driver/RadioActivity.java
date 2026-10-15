package com.dispatchpro.driver;
import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.*;
import android.view.*;
import android.widget.*;

/** A view onto the existing service engine; Activity recreation keeps the session. */
public final class RadioActivity extends Activity {
 RadioService radio;LinearLayout root;boolean resumed,bound;
 final ServiceConnection connection=new ServiceConnection(){public void onServiceConnected(ComponentName n,IBinder b){radio=((RadioService.LocalBinder)b).service();if(resumed)radio.attached(RadioActivity.this);}public void onServiceDisconnected(ComponentName n){radio=null;}};
 @Override public void onCreate(Bundle b){super.onCreate(b);getWindow().setStatusBarColor(0xff081528);getWindow().setNavigationBarColor(0xff081528);root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setBackgroundColor(0xff081528);root.setOnApplyWindowInsetsListener((v,i)->{v.setPadding(i.getSystemWindowInsetLeft(),i.getSystemWindowInsetTop(),i.getSystemWindowInsetRight(),i.getSystemWindowInsetBottom());return i;});setContentView(root);bound=bindService(new Intent(this,RadioService.class),connection,BIND_AUTO_CREATE);}
 @Override public void onResume(){super.onResume();resumed=true;if(radio!=null)radio.attached(this);}
 @Override public void onPause(){resumed=false;if(radio!=null){radio.changed();radio.keys.release("انتقال الواجهة إلى الخلفية أثناء الضغط");radio.event("foreground",false);}super.onPause();}
 @Override public void onStop(){if(radio!=null)radio.detached(this);super.onStop();}
 @Override public void onDestroy(){if(radio!=null)radio.detached(this);if(bound)unbindService(connection);super.onDestroy();}
 @Override public boolean dispatchKeyEvent(KeyEvent e){return radio!=null&&radio.keys.key(e,"Activity")||super.dispatchKeyEvent(e);}
 void permissions(boolean automatic){if(!resumed)return;java.util.ArrayList<String> names=new java.util.ArrayList<>();java.util.ArrayList<String> required=new java.util.ArrayList<>(java.util.Arrays.asList(Manifest.permission.RECORD_AUDIO,Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION));if(Build.VERSION.SDK_INT>=33)required.add(Manifest.permission.POST_NOTIFICATIONS);var prefs=getSharedPreferences("radio-permissions",0);for(String name:required){if(checkSelfPermission(name)==PackageManager.PERMISSION_GRANTED)continue;boolean asked=prefs.getBoolean(name,false);if(automatic&&asked)continue;if(!automatic&&asked&&!shouldShowRequestPermissionRationale(name)){startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,android.net.Uri.parse("package:"+getPackageName())));return;}names.add(name);}if(!names.isEmpty()){var edit=prefs.edit();for(String name:names)edit.putBoolean(name,true);edit.apply();requestPermissions(names.toArray(new String[0]),103);}else if(radio!=null)radio.changed();}
 @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] grants){super.onRequestPermissionsResult(code,permissions,grants);if(radio!=null)radio.changed();}
}
