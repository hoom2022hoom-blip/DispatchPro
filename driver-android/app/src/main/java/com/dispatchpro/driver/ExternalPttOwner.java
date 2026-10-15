package com.dispatchpro.driver;

import android.content.*;

/** User-selected owner shared only with apps signed by the same certificate. */
public final class ExternalPttOwner extends BroadcastReceiver {
 static final String PERMISSION=BuildConfig.DRIVER_QA?"com.dispatchpro.driver.qa.permission.EXTERNAL_PTT_OWNER":"com.dispatchpro.permission.EXTERNAL_PTT_OWNER";
 static final String ACTION="com.dispatchpro.EXTERNAL_PTT_OWNER";
 static String current(Context c){return c.getSharedPreferences("external-ptt-owner",0).getString("owner","");}
 static String application(Context c){return c.getPackageName().equals("com.dispatchpro.radio")?"radio":"driver";}
 static boolean owns(Context c){return current(c).equals(application(c));}
 static boolean valid(String owner){return owner.equals("driver")||owner.equals("radio")||owner.isEmpty();}
 static void select(Context c,String owner){
  if(!valid(owner))throw new IllegalArgumentException("Invalid PTT owner");
  update(c,owner);
  for(String target:BuildConfig.DRIVER_QA?new String[]{c.getPackageName()}:new String[]{"com.dispatchpro.driver","com.dispatchpro.radio"})
   c.sendBroadcast(new Intent(ACTION).setComponent(new ComponentName(target,ExternalPttOwner.class.getName())).addFlags(Intent.FLAG_INCLUDE_STOPPED_PACKAGES).putExtra("owner",owner),PERMISSION);
 }
 private static void update(Context c,String owner){
  c.getSharedPreferences("external-ptt-owner",0).edit().putString("owner",owner).commit();
  // Both callbacks run on the UI thread. Ownership changes release a held key.
  if(listener!=null)listener.run();
 }
 static Runnable listener;
 @Override public void onReceive(Context c,Intent i){String owner=i.getStringExtra("owner");if(ACTION.equals(i.getAction())&&owner!=null&&valid(owner))update(c,owner);}
}
