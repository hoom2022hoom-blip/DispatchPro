package com.dispatchpro.driver;
import android.content.*;
import android.webkit.*;
import org.json.JSONObject;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
public final class DriverPushBridge implements CustomerPushHook{
 private final Context context;private WebMessagePort port;
 public DriverPushBridge(Context context){this.context=context;android.content.SharedPreferences store=context.getSharedPreferences("driver-push",0);if(!store.contains("installation"))store.edit().putString("installation",java.util.UUID.randomUUID().toString()).commit();}
 public void ready(WebMessagePort value){port=value;refresh();}
 public void refresh(){if(FirebaseApp.getApps(context).isEmpty())return;FirebaseMessaging.getInstance().getToken().addOnSuccessListener(token->{try{JSONObject data=new JSONObject().put("token",token).put("installationId",context.getSharedPreferences("driver-push",0).getString("installation",""));if(port!=null)port.postMessage(new WebMessage(new JSONObject().put("event","push-device").put("value",data).toString()));}catch(Exception ignored){}});}
 public boolean message(String raw){try{JSONObject data=new JSONObject(raw);String type=data.optString("type");if(!type.equals("driver.push-bound")&&!type.equals("driver.push-unbound")&&!type.equals("driver.push-refresh"))return false;android.content.SharedPreferences store=context.getSharedPreferences("driver-push",0);if(type.equals("driver.push-bound")){String actor=data.optString("recipient");if(actor.matches("[a-fA-F0-9-]{36}"))store.edit().putBoolean("bound",true).putString("recipient",actor).commit();}else if(type.equals("driver.push-unbound")){removeRegistration(store);store.edit().putBoolean("bound",false).remove("recipient").commit();DriverPushRegistrationJob.cancel(context);}else refresh();if(port!=null&&data.has("id"))port.postMessage(new WebMessage(new JSONObject().put("id",data.getString("id")).put("data",true).toString()));return true;}catch(Exception ignored){return false;}}
 private void removeRegistration(android.content.SharedPreferences store){
  if(!store.getBoolean("bound",false))return;
  try{String origin=DriverConfig.origin(context);String saved=SecureDriverSession.load(context,origin);if(saved.isEmpty())return;String bearer=new JSONObject(saved).optString("token");JSONObject body=new JSONObject().put("installationId",store.getString("installation","")).put("token","");java.util.concurrent.ExecutorService worker=java.util.concurrent.Executors.newSingleThreadExecutor();worker.execute(()->{try{DriverNativeApi.send(ApiPolicy.endpoint(origin,"driver/push-device/remove"),"POST",body,bearer);}catch(Exception ignored){}finally{worker.shutdown();}});}catch(Exception ignored){}
 }
}
