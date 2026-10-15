package com.dispatchpro.driver;
import android.content.Context;
import org.json.JSONObject;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;

/** Read-only state synchronization and shared token renewal, independent of WebView. */
final class DriverNativeApi {
 static final java.util.Set<HttpURLConnection> active=java.util.concurrent.ConcurrentHashMap.newKeySet();
 private static final java.util.Map<String,java.util.Set<String>> rotations=new java.util.HashMap<>();
 static void reset(Context context,String origin){synchronized(SecureDriverSession.class){rotations.remove(origin);}}
 static boolean rotated(String origin,String token){synchronized(SecureDriverSession.class){return rotations.getOrDefault(origin,java.util.Collections.emptySet()).contains(token);}}
 static void networkChanged(){for(HttpURLConnection request:active)request.disconnect();}
 static final class Result {final int status;final JSONObject body;Result(int s,JSONObject b){status=s;body=b;}}
 static Result send(String url,String method,JSONObject body,String bearer)throws Exception {
  HttpURLConnection http=(HttpURLConnection)new URL(url).openConnection();
  active.add(http);
  try{http.setInstanceFollowRedirects(false);http.setConnectTimeout(10000);http.setReadTimeout(30000);http.setUseCaches(false);http.setRequestMethod(method);http.setRequestProperty("Accept","application/json");
   if(!bearer.isEmpty())http.setRequestProperty("Authorization","Bearer "+bearer);
   if(body!=null){http.setDoOutput(true);http.setRequestProperty("Content-Type","application/json");try(OutputStream o=http.getOutputStream()){o.write(body.toString().getBytes(StandardCharsets.UTF_8));}}
   int status=http.getResponseCode();if(status>=300&&status<400)throw new IOException("Redirect refused");InputStream input=status>=400?http.getErrorStream():http.getInputStream();ByteArrayOutputStream bytes=new ByteArrayOutputStream();
   if(input!=null)try(InputStream in=input){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(bytes.size()+n>524288)throw new IOException("Response limit");bytes.write(b,0,n);}}
   return new Result(status,bytes.size()==0?new JSONObject():new JSONObject(bytes.toString("UTF-8")));
  }finally{active.remove(http);http.disconnect();}
 }
 static Result refresh(Context context,String origin,String requested)throws Exception {
  synchronized(SecureDriverSession.class){
   String saved=SecureDriverSession.load(context,origin);JSONObject session=saved.isEmpty()?null:new JSONObject(saved);
   // A native GPS/push/state request may already have rotated the same local session.
   if(session!=null&&!requested.equals(session.optString("refreshToken"))&&rotations.getOrDefault(origin,java.util.Collections.emptySet()).contains(requested))return new Result(200,new JSONObject().put("accessToken",session.getString("token")).put("refreshToken",session.getString("refreshToken")));
   Result result=send(ApiPolicy.endpoint(origin,"auth/refresh"),"POST",new JSONObject().put("refreshToken",requested),"");
   if(result.status==200&&session!=null&&requested.equals(session.optString("refreshToken"))){java.util.Set<String> previous=rotations.computeIfAbsent(origin,key->new java.util.LinkedHashSet<>());previous.add(requested);while(previous.size()>16)previous.remove(previous.iterator().next());session.put("token",result.body.getString("accessToken")).put("refreshToken",result.body.getString("refreshToken"));SecureDriverSession.save(context,origin,session.toString());}
   return result;
  }
 }
 static Result authenticated(Context context,String method,String path,JSONObject body)throws Exception {
  String origin=DriverConfig.origin(context),saved=SecureDriverSession.load(context,origin);if(saved.isEmpty())throw new IOException("Session unavailable");JSONObject session=new JSONObject(saved);
  Result result=send(ApiPolicy.endpoint(origin,path),method,body,session.getString("token"));
  if(result.status==401&&!session.optString("refreshToken").isEmpty()){
   Result renewal=refresh(context,origin,session.getString("refreshToken"));
   if(renewal.status!=200)return renewal;
   result=send(ApiPolicy.endpoint(origin,path),method,body,renewal.body.getString("accessToken"));
  }
  return result;
 }
}
