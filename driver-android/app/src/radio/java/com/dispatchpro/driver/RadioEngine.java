package com.dispatchpro.driver;
import android.content.*;
import android.net.*;
import android.net.http.SslError;
import android.os.*;
import android.webkit.*;
import android.view.ViewGroup;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

final class RadioEngine {
 static final String ORIGIN="https://appassets.androidplatform.net";
 final RadioService service;final MutableContextWrapper context;final WebView web;
 final ExecutorService io=Executors.newFixedThreadPool(6),control=Executors.newFixedThreadPool(2),sessions=Executors.newSingleThreadExecutor();
 final Map<String,HttpURLConnection> requests=new ConcurrentHashMap<>();final Set<String> cancelled=ConcurrentHashMap.newKeySet();
 final ConnectivityManager connectivity;final ConnectivityManager.NetworkCallback callback;
 Network network;WebMessagePort port;boolean dead;
 RadioCapture capture=new RadioCapture();
 RadioEngine(RadioService service){this.service=service;context=new MutableContextWrapper(service.getApplicationContext());web=new WebView(context);
  WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setMediaPlaybackRequiresUserGesture(false);settings.setCacheMode(WebSettings.LOAD_NO_CACHE);settings.setSupportMultipleWindows(false);
  WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);if(Build.VERSION.SDK_INT>=26)web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT,false);
  android.webkit.CookieManager.getInstance().setAcceptCookie(false);
  web.setWebChromeClient(new WebChromeClient(){@Override public void onPermissionRequest(PermissionRequest r){if(ORIGIN.equals(r.getOrigin().toString().replaceAll("/$",""))&&service.operational&&service.microphoneReady&&Arrays.asList(r.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE))r.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});else r.deny();}});
  web.setWebViewClient(new WebViewClient(){
   @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){String path=r.getUrl().getPath();if(!"GET".equals(r.getMethod())||!ORIGIN.equals(r.getUrl().getScheme()+"://"+r.getUrl().getAuthority())||!Arrays.asList("/index.html","/app.js","/app.css","/office-logo.webp","/voice-preroll-worklet.js").contains(path))return denied();try{return new WebResourceResponse(path.endsWith(".js")?"application/javascript":path.endsWith(".css")?"text/css":path.endsWith(".webp")?"image/webp":"text/html","UTF-8",200,"OK",Collections.singletonMap("Cache-Control","no-store"),service.getAssets().open(path.substring(1)));}catch(IOException e){return denied();}}
   @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return !r.getUrl().toString().equals(ORIGIN+"/index.html");}
   @Override public void onReceivedSslError(WebView v,SslErrorHandler h,SslError e){h.cancel();}
   @Override public boolean onRenderProcessGone(WebView v,RenderProcessGoneDetail d){dead=true;service.failure="توقف محرك الصوت؛ أغلق التطبيق وافتحه لاستعادته";service.duty(false);if(v.getParent()!=null)((ViewGroup)v.getParent()).removeView(v);v.destroy();if(service.activity!=null){android.widget.TextView message=new android.widget.TextView(service.activity);message.setText(service.failure);message.setTextColor(0xffffffff);service.activity.root.addView(message);}return true;}
   @Override public void onPageFinished(WebView v,String url){if(!url.equals(ORIGIN+"/index.html"))return;if(port!=null)port.close();WebMessagePort[] pair=v.createWebMessageChannel();port=pair[0];port.setWebMessageCallback(new WebMessagePort.WebMessageCallback(){@Override public void onMessage(WebMessagePort p,WebMessage m){receive(m.getData());}});v.postWebMessage(new WebMessage("dispatchpro-connect",new WebMessagePort[]{pair[1]}),Uri.parse(ORIGIN));}
  });
  connectivity=service.getSystemService(ConnectivityManager.class);network=connectivity.getActiveNetwork();callback=new ConnectivityManager.NetworkCallback(){@Override public void onAvailable(Network n){service.handler.post(()->networkChanged());}@Override public void onLost(Network n){service.handler.post(()->networkChanged());}};connectivity.registerDefaultNetworkCallback(callback);
  web.loadUrl(ORIGIN+"/index.html");
 }
 void keepReceiving(){if(!dead){web.onResume();web.resumeTimers();}}
 void attach(RadioActivity activity){if(dead)return;keepReceiving();context.setBaseContext(activity);if(web.getParent()!=null)((ViewGroup)web.getParent()).removeView(web);activity.root.addView(web,new android.widget.LinearLayout.LayoutParams(-1,-1));event("foreground",true);event("background",service.operational);service.getSystemService(android.app.NotificationManager.class).cancel(104);}
 void detach(){if(web.getParent()!=null)((ViewGroup)web.getParent()).removeView(web);context.setBaseContext(service.getApplicationContext());if(service.operational)keepReceiving();event("background",service.operational);event("foreground",false);}
 boolean online(){NetworkCapabilities n=connectivity.getNetworkCapabilities(connectivity.getActiveNetwork());return n!=null&&n.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);}
 void networkChanged(){Network n=connectivity.getActiveNetwork();event("online",online());if(Objects.equals(n,network))return;network=n;service.keys.release("تغيرت الشبكة");DriverNativeApi.networkChanged();for(HttpURLConnection r:requests.values())r.disconnect();event("network-changed",true);}
 void receive(String raw){if(raw==null||raw.length()>150000)return;try{JSONObject d=new JSONObject(raw);String id=d.optString("id"),type=d.optString("type");if(!id.matches("[A-Za-z0-9-]{1,80}"))return;
  switch(type){
   case "ready":reply(id,new JSONObject().put("apiOrigin",DriverConfig.origin(service)).put("online",online()).put("foreground",service.visible()).put("notifications",DriverNotifications.permitted(service)));break;
   case "session.load":sessions.execute(()->{try{String saved=SecureDriverSession.load(service,DriverConfig.origin(service));service.handler.post(()->service.authenticated(!saved.isEmpty()));reply(id,saved);}catch(Exception e){error(id,"تعذر استعادة الحساب المحفوظ");}});break;
   case "session.save":String value=d.optString("value");if(value.isEmpty())service.authenticated(false);sessions.execute(()->{try{SecureDriverSession.saveFromWeb(service,DriverConfig.origin(service),value,d.optBoolean("remember",true));service.handler.post(()->service.authenticated(!value.isEmpty()));reply(id,true);}catch(Exception e){error(id,"تعذر حفظ جلسة الحساب بأمان");}});break;
   case "request":(d.optString("path").matches("voice/(floor|release|heartbeat)")?control:io).execute(()->request(id,d));break;
   case "cancel":if(cancelled.size()>1000)cancelled.clear();cancelled.add(id);HttpURLConnection r=requests.get(id);if(r!=null)r.disconnect();break;
   case "service.duty":service.duty(d.optBoolean("active"));reply(id,true);break;
   case "service.gps":service.getSharedPreferences("driver-duty",0).edit().putBoolean("gpsEnabled",d.optBoolean("active",true)).apply();service.changed();reply(id,true);break;
   case "service.status":reply(id,service.operational);break;
   case "radio.status":service.changed();reply(id,service.status());break;
   case "external.configure":service.keys.configure(d);reply(id,service.keys.info());break;
   case "permission":if(service.activity!=null)service.activity.permissions(d.optBoolean("automatic"));reply(id,true);break;
   case "diagnostics.settings":if(service.visible()){String section=d.optString("section");Intent intent=new Intent(section.equals("gps")?android.provider.Settings.ACTION_LOCATION_SOURCE_SETTINGS:section.equals("external")?android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS:section.equals("battery")?android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS:android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);if(!section.equals("gps")&&!section.equals("external")&&!section.equals("battery"))intent.setData(Uri.parse("package:"+service.getPackageName()));service.activity.startActivity(intent);}reply(id,true);break;
   case "voice.audio":long routeStarted=SystemClock.elapsedRealtime();service.voiceActive(d.optBoolean("active"));android.util.Log.i("TNMMedia","stage=radioPressRouteSetupMs ms="+(SystemClock.elapsedRealtime()-routeStarted));reply(id,true);break;
   case "voice.receiving":long receiveStarted=SystemClock.elapsedRealtime();service.receiveReady(d.optBoolean("active"));android.util.Log.i("TNMMedia","stage=radioReceiveRouteSetupMs ms="+(SystemClock.elapsedRealtime()-receiveStarted));reply(id,true);break;
   case "capture.prepare":if(!service.operational||!service.microphoneReady||!service.soundAvailable)throw new IllegalStateException();capture.prepareAsync(()->reply(id,true),e->error(id,"تعذر تهيئة الميكروفون"));break;
   case "capture.start":String captureId=d.optString("attemptId");if(!captureId.matches("[0-9a-fA-F-]{36}")||!service.operational||!service.microphoneReady||!service.soundAvailable)throw new IllegalStateException();capture.start(captureId,()->reply(id,true),e->error(id,"تعذر بدء الميكروفون"));break;
   case "capture.pull":reply(id,new JSONObject().put("pcm",capture.pull(d.optString("attemptId"))).put("failed",capture.failed));break;
   case "capture.stop":capture.stop(d.optString("attemptId"));reply(id,true);break;
   case "capture.discard":capture.discard(d.optString("attemptId"));reply(id,true);break;
   case "capture.close":capture.close();capture=new RadioCapture();reply(id,true);break;
   case "communication.metric":VoiceDiagnostics.record(service,d);String stage=d.optString("name");if(stage.matches("[A-Za-z]{1,50}")){
    long ms=Math.max(0,d.optLong("ms"));android.util.Log.i("TNMMedia","stage="+stage+" ms="+ms);
    JSONObject timing=new JSONObject().put("stage",stage).put("ms",ms).put("atMs",Math.max(0,d.optLong("atMs"))).put("eventEpochMs",Math.max(0,d.optLong("eventEpochMs")));
    for(String key:new String[]{"sessionId","attemptId","floorId"}){String identifier=d.optString(key);if(identifier.matches("[0-9a-fA-F-]{36}"))timing.put(key,identifier);}
    android.util.Log.i("TNMTrace",timing.toString());
   }reply(id,true);break;
   case "voice.speaker":service.speaker(d);reply(id,true);break;
   case "diagnostics.copy":JSONObject diagnostics=new JSONObject().put("version",BuildConfig.VERSION_NAME).put("runtime",service.status()).put("metrics",new JSONObject(service.getSharedPreferences("communication-metrics",0).getAll()));service.getSystemService(android.content.ClipboardManager.class).setPrimaryClip(ClipData.newPlainText("TNM radio diagnostics",diagnostics.toString()));reply(id,true);break;
   case "voice.prepared":case "driver.push-refresh":case "diagnostics.runtime":reply(id,true);break;
   default:error(id,"Unsupported radio action");
  }
 }catch(Exception e){try{String message=e.getMessage();error(new JSONObject(raw).optString("id"),message!=null&&message.matches(".*[\\u0600-\\u06ff].*")?message:"تعذر تطبيق الإعداد");}catch(Exception ignored){}}}
 void httpDiagnostic(String path,int status,long started,int bytes,String ray){
  String route=path.split("\\?",2)[0];if(!route.matches("[A-Za-z0-9/-]{1,160}"))return;if(!route.matches("radio/me|voice/(session|updates|floor|release|heartbeat)")&&status>0&&status<400)return;
  String correlation=ray!=null&&ray.matches("[A-Za-z0-9-]{1,64}")?ray:"-";
  android.util.Log.i("TNMHttp","route="+route+" status="+status+" elapsedMs="+(android.os.SystemClock.elapsedRealtime()-started)+" bytes="+bytes+" ray="+correlation);
 }
 void request(String id,JSONObject d){HttpURLConnection http=null;long started=android.os.SystemClock.elapsedRealtime();try{String method=d.optString("method"),path=d.optString("path"),body=d.optString("body"),authorization=d.optString("authorization");if(!ApiPolicy.allowed(method,path)||body.length()>131072||authorization.length()>8192||authorization.contains("\r")||authorization.contains("\n"))throw new IOException("Blocked request");if(cancelled.remove(id))return;
  if(path.matches("auth/(driver|radio)-refresh")){DriverNativeApi.Result result=DriverNativeApi.refresh(service,DriverConfig.origin(service),new JSONObject(body).optString("refreshToken"));httpDiagnostic(path,result.status,started,result.body.toString().getBytes(StandardCharsets.UTF_8).length,null);reply(id,new JSONObject().put("status",result.status).put("body",result.body.toString()));return;}
  if(path.equals("voice/floor")&&(!service.operational||!service.microphoneReady))throw new IOException("Radio gate closed");
  http=(HttpURLConnection)new URL(ApiPolicy.endpoint(DriverConfig.origin(service),BuildConfig.DEFAULT_WEB_URL,path)).openConnection();requests.put(id,http);if(cancelled.remove(id))return;boolean ptt=path.matches("voice/(floor|release|heartbeat)");http.setInstanceFollowRedirects(false);http.setConnectTimeout(ptt?4000:10000);http.setReadTimeout(ptt?6000:32000);http.setUseCaches(false);http.setRequestMethod(method);http.setRequestProperty("Accept","application/json");http.setRequestProperty("Cache-Control","no-store");if(path.matches("auth/(driver|radio)-login"))http.setRequestProperty("X-Driver-Session","native");if(!authorization.isEmpty())http.setRequestProperty("Authorization",authorization);if(!method.equals("GET")){http.setDoOutput(true);http.setRequestProperty("Content-Type","application/json");try(OutputStream out=http.getOutputStream()){out.write(body.getBytes(StandardCharsets.UTF_8));}}
  int status=http.getResponseCode();if(status>=300&&status<400)throw new IOException("Redirect refused");InputStream input=status>=400?http.getErrorStream():http.getInputStream();ByteArrayOutputStream bytes=new ByteArrayOutputStream();if(input!=null)try(InputStream in=input){byte[] block=new byte[8192];int count;while((count=in.read(block))!=-1){if(bytes.size()+count>524288)throw new IOException("Response limit");bytes.write(block,0,count);}}
  httpDiagnostic(path,status,started,bytes.size(),http.getHeaderField("CF-Ray"));
  if(!cancelled.remove(id))reply(id,new JSONObject().put("status",status).put("body",bytes.toString("UTF-8")));
 }catch(Exception e){if(!cancelled.remove(id)){httpDiagnostic(d.optString("path"),0,started,0,null);error(id,"تعذر الاتصال بالمكتب؛ تحقق من الإنترنت");}}finally{requests.remove(id);cancelled.remove(id);if(http!=null)http.disconnect();}}
 void reply(String id,Object value){send(newMessage("id",id,"data",value));}
 void error(String id,String value){send(newMessage("id",id,"error",value));}
 void event(String name,Object value){send(newMessage("event",name,"value",value));}
 private JSONObject newMessage(String a,Object av,String b,Object bv){try{return new JSONObject().put(a,av).put(b,bv);}catch(JSONException e){return new JSONObject();}}
 private void send(JSONObject value){service.handler.post(()->{try{if(port!=null&&!dead)port.postMessage(new WebMessage(value.toString()));}catch(RuntimeException ignored){}});}
 private WebResourceResponse denied(){return new WebResourceResponse("text/plain","UTF-8",403,"Forbidden",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
 void close(){capture.close();connectivity.unregisterNetworkCallback(callback);for(HttpURLConnection r:requests.values())r.disconnect();io.shutdownNow();control.shutdownNow();sessions.shutdownNow();if(port!=null)port.close();detach();if(!dead)web.destroy();}
}
