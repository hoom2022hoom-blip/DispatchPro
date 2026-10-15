package com.dispatchpro.driver;
import android.content.Context;
import org.json.JSONObject;
/** Uses the existing audience-specific secure session; never trusts push identity as authorization. */
final class MobileNativeApi {
 private static volatile String customerToken="",customerIdentity="";private static volatile long customerUntil;
 static void clear(){customerToken="";customerIdentity="";customerUntil=0;}
 static DriverNativeApi.Result request(Context c,String method,String path,JSONObject body)throws Exception{
  if(!c.getSharedPreferences("communication-auth",0).getBoolean("active",false))throw new java.io.IOException("Account locked");
  if(CommunicationNotifications.driver(c))return DriverNativeApi.authenticated(c,method,"driver/"+path,body);
  String origin=CustomerOriginPolicy.origin(BuildConfig.DEFAULT_WEB_URL,BuildConfig.DEBUG,BuildConfig.CUSTOMER_LOCAL_DEBUG);String key=origin+(BuildConfig.DEBUG?"#customer-debug":"");String saved=CustomerSecureSession.load(c,key);if(saved.isEmpty())throw new java.io.IOException("Session unavailable");JSONObject device=new JSONObject(saved);
  long generation=c.getSharedPreferences("communication-auth",0).getLong("generation",0);String identity=device.getString("accountId")+":"+device.optString("tenant");String token;
  synchronized(MobileNativeApi.class){if(!customerIdentity.equals(identity)||android.os.SystemClock.elapsedRealtime()>=customerUntil){DriverNativeApi.Result login=login(origin,device);if(login.status!=200)return login;customerToken=login.body.getString("accessToken");customerIdentity=identity;customerUntil=android.os.SystemClock.elapsedRealtime()+25*60000;}token=customerToken;}
  if(!current(c,generation))return new DriverNativeApi.Result(401,new JSONObject());DriverNativeApi.Result result=DriverNativeApi.send(origin+"/api/customer/"+path,method,body,token);if(result.status==401){clear();synchronized(MobileNativeApi.class){DriverNativeApi.Result login=login(origin,device);if(login.status!=200)return login;customerToken=login.body.getString("accessToken");customerIdentity=identity;customerUntil=android.os.SystemClock.elapsedRealtime()+25*60000;token=customerToken;}if(!current(c,generation))return new DriverNativeApi.Result(401,new JSONObject());result=DriverNativeApi.send(origin+"/api/customer/"+path,method,body,token);}return result;
 }
 static boolean current(Context c,long generation){android.content.SharedPreferences p=c.getSharedPreferences("communication-auth",0);return p.getBoolean("active",false)&&p.getLong("generation",0)==generation;}
 private static DriverNativeApi.Result login(String origin,JSONObject device)throws Exception{return DriverNativeApi.send(origin+"/api/customer/login","POST",new JSONObject().put("tenant",device.optString("tenant")).put("username","customer-"+device.getString("accountId").replace("-","")).put("password",device.getString("deviceSecret")),"");}
 static void sync(Context c)throws Exception{long generation=c.getSharedPreferences("communication-auth",0).getLong("generation",0);DriverNativeApi.Result result=request(c,"GET","mobile/updates?deviceId="+CommunicationNotifications.device(c),null);if(result.status==200&&current(c,generation))CommunicationNotifications.sync(c,result.body.getJSONObject("data"),DriverNotifications.timestamp(result.body.optString("serverTime"),System.currentTimeMillis()));else if(result.status>=500||result.status==429)throw new java.io.IOException("Resync deferred");}
}
