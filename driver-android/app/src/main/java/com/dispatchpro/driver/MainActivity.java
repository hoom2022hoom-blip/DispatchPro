package com.dispatchpro.driver;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.*;
import android.net.http.SslError;
import android.os.*;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

public final class MainActivity extends Activity {
    private static final String APP_ORIGIN = "https://appassets.androidplatform.net";
    private WebView web;
    private DriverExternalKeys externalKeys;
    @Override public boolean dispatchKeyEvent(KeyEvent event){return externalKeys!=null&&externalKeys.key(event,"Activity")||super.dispatchKeyEvent(event);}
    boolean externalReady(){return web!=null&&!CallAudioService.requested&&checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED&&(foreground||DriverForegroundService.microphoneReady());}
    void externalEvent(String name,JSONObject value){runOnUiThread(()->{try{if(port!=null)port.postMessage(new WebMessage(new JSONObject().put("event",name).put("value",value).toString()));}catch(Exception ignored){}});}
    private boolean destroyed;
    private android.media.AudioManager audioManager;
    private int previousAudioMode=android.media.AudioManager.MODE_NORMAL;
    private boolean previousSpeaker=false;
    private boolean audioRouteActive=false,voiceFocusPaused=false;
    private android.media.AudioDeviceInfo previousCommunicationDevice;
    private android.media.AudioFocusRequest audioFocus;
    private TextView connection;
    private WebMessagePort port;
    private CustomerPushHook pushHook;
    private volatile String apiOrigin;
    private volatile boolean foreground;
    private boolean onlineDuty;
    private String permissionRequest;
    private GeolocationPermissions.Callback locationPermission;
    private String locationOrigin;
    private PermissionRequest microphonePermission;
    private NativePermissions permissionGuide;
    private String callAudioReply;
    private JSONObject callAudioData;
    private final ExecutorService sessions = Executors.newSingleThreadExecutor();
    private final ExecutorService network = Executors.newFixedThreadPool(3);
    // RADIO floor control must not queue behind SDP/ICE fan-out or profile/GPS HTTP.
    private final ExecutorService pttControl = Executors.newFixedThreadPool(2);
    // Driver, voice and chat can each occupy a thread for 25 seconds. Mutations
    // and GPS must not wait behind those polls and expire in the JS bridge queue.
    private final ExecutorService polls = Executors.newFixedThreadPool(4);
    private final Map<String, HttpURLConnection> requests = new ConcurrentHashMap<>();
    private final Set<String> cancelled = ConcurrentHashMap.newKeySet();
    private ConnectivityManager connectivity;
    private ConnectivityManager.NetworkCallback networkCallback;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);NativeCallWindow.apply(this,getIntent());
        permissionGuide=new NativePermissions(this,true);onlineDuty=getSharedPreferences("driver-duty",0).getBoolean("online",false);
        CommunicationNotifications.configure(this);
        try{if(!BuildConfig.DRIVER_QA&&!BuildConfig.FLAVOR.equals("radio"))pushHook=(CustomerPushHook)Class.forName("com.dispatchpro.driver.DriverPushBridge").getConstructor(Context.class).newInstance(this);}catch(Exception ignored){}
        audioManager=getSystemService(android.media.AudioManager.class);
        apiOrigin = BuildConfig.DRIVER_QA?BuildConfig.DEFAULT_API_URL:ApiPolicy.upgradeOrigin(getPreferences(MODE_PRIVATE).getString("apiOrigin", BuildConfig.DEFAULT_API_URL), BuildConfig.DEFAULT_API_URL);
        getPreferences(MODE_PRIVATE).edit().putString("apiOrigin",apiOrigin).apply();
        DriverNotifications.configure(this);
        LinearLayout root = new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setBackgroundColor(Color.WHITE);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());return insets;
        });
        LinearLayout header = new LinearLayout(this);header.setGravity(Gravity.CENTER_VERTICAL);header.setPadding(12, 4, 12, 4);
        connection = new TextView(this);connection.setTextSize(12);connection.setText("تكسي نابلس والمهندس · السائق · "+BuildConfig.VERSION_NAME);
        header.addView(connection, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button settings = new Button(this);settings.setText("⚙");settings.setOnClickListener(v -> web.evaluateJavascript("document.querySelector('[aria-label=\"إعدادات السائق\"]')?.click()",null));
        web = new WebView(this);root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));setContentView(root);
        // Tokens stay in SecureDriverSession; DOM storage holds display preferences only.
        WebSettings options = web.getSettings();options.setJavaScriptEnabled(true);options.setDomStorageEnabled(true);
        options.setAllowFileAccess(false);options.setAllowContentAccess(false);options.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        options.setCacheMode(WebSettings.LOAD_DEFAULT);options.setUserAgentString(options.getUserAgentString()+" NM-"+BuildConfig.FLAVOR+"/"+BuildConfig.VERSION_NAME);options.setSupportMultipleWindows(false);
        options.setGeolocationEnabled(true);
        options.setMediaPlaybackRequiresUserGesture(false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        if(Build.VERSION.SDK_INT>=26)web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT,false);
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                if (!foreground&&!DriverForegroundService.microphoneReady() || !APP_ORIGIN.equals(request.getOrigin().toString().replaceAll("/$", "")) || microphonePermission != null
                    || !Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) { request.deny(); return; }
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    if(!CallAudioService.requested)DriverForegroundService.beginMicrophone(MainActivity.this);
                    request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE}); return;
                }
                if(permissionGuide.busy()){request.deny();return;}microphonePermission = request;
                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},35);
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) { if (microphonePermission == request) microphonePermission = null; }
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (!foreground || !(APP_ORIGIN.equals(origin) || (APP_ORIGIN+"/").equals(origin))) { callback.invoke(origin,false,false); return; }
                if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED) { callback.invoke(origin,true,false); return; }
                if (locationPermission!=null||permissionGuide.busy()) { callback.invoke(origin,false,false); return; }
                locationPermission=callback;locationOrigin=origin;
                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},34);
            }
        });
        android.webkit.CookieManager.getInstance().setAcceptCookie(false);
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri=request.getUrl();String path=uri.getPath();
                if ("GET".equals(request.getMethod()) && "https".equals(uri.getScheme()) && "tile.openstreetmap.org".equals(uri.getHost()) && uri.getUserInfo()==null && uri.getQuery()==null && path!=null && path.matches("/[0-9]{1,2}/[0-9]+/[0-9]+\\.png")) return null;
                if (!APP_ORIGIN.equals(uri.getScheme()+"://"+uri.getAuthority()) || !"GET".equals(request.getMethod())
                        || !("/index.html".equals(path)||"/app.js".equals(path)||"/app.css".equals(path)||"/office-logo.webp".equals(path)||path!=null&&path.matches("/(driver-mobile|customer-mobile)/(maps\\.js|maplibre-gl\\.js|maplibre-gl\\.css)"))) return denied();
                try {
                    String mime=path.endsWith(".webp")?"image/webp":path.endsWith(".js")?"application/javascript":path.endsWith(".css")?"text/css":"text/html";
                    return new WebResourceResponse(mime,"UTF-8",200,"OK",Collections.singletonMap("Cache-Control","no-store"),getAssets().open(path.substring(1)));
                } catch(IOException error) { return denied(); }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri=request.getUrl();
                if ((APP_ORIGIN+"/index.html").equals(uri.toString())) return false;
                if(BuildConfig.DRIVER_QA&&"tel".equals(uri.getScheme())){Toast.makeText(MainActivity.this,"الاتصالات الهاتفية الخارجية معطلة في QA",Toast.LENGTH_LONG).show();return true;}
                if (request.isForMainFrame() && ("tel".equals(uri.getScheme()) || ("https".equals(uri.getScheme())&&"www.google.com".equals(uri.getHost())&&uri.getPath()!=null&&uri.getPath().startsWith("/maps/")))) {
                    try { startActivity(new Intent("tel".equals(uri.getScheme())?Intent.ACTION_DIAL:Intent.ACTION_VIEW,uri)); } catch(ActivityNotFoundException ignored) { Toast.makeText(MainActivity.this,"لا يوجد تطبيق لفتح الرابط",Toast.LENGTH_SHORT).show(); }
                }
                return true;
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) { handler.cancel(); }
            @Override public boolean onRenderProcessGone(WebView view,RenderProcessGoneDetail detail){CallAudioService.end(MainActivity.this);DriverForegroundService.end(MainActivity.this);closeEngine();getSharedPreferences("driver-health",0).edit().putString("runtimeKind","WebViewRenderer").putLong("runtimeAt",System.currentTimeMillis()).apply();WebViewRecovery.show(MainActivity.this);return true;}
            @Override public void onPageFinished(WebView view, String url) {
                if (!(APP_ORIGIN+"/index.html").equals(url)) return;
                if(port!=null)port.close();WebMessagePort[] channels=web.createWebMessageChannel();port=channels[0];
                port.setWebMessageCallback(new WebMessagePort.WebMessageCallback(){@Override public void onMessage(WebMessagePort source,WebMessage message){receive(message.getData());}});
                if(pushHook!=null)pushHook.ready(port);
                web.postWebMessage(new WebMessage("dispatchpro-connect",new WebMessagePort[]{channels[1]}),Uri.parse(APP_ORIGIN));
            }
        });
        connectivity=getSystemService(ConnectivityManager.class);
        networkCallback=new ConnectivityManager.NetworkCallback(){
            @Override public void onAvailable(Network n){runOnUiThread(()->networkChanged());}
            @Override public void onLost(Network n){runOnUiThread(()->networkChanged());}
        };
        connectivity.registerDefaultNetworkCallback(networkCallback);
        web.loadUrl(APP_ORIGIN+"/index.html");
    }
    private WebResourceResponse denied(){return new WebResourceResponse("text/plain","UTF-8",403,"Forbidden",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
    private void receive(String raw) {
        if(raw==null||raw.length()>150000)return;
        if(pushHook!=null&&pushHook.message(raw))return;
        try {
            JSONObject data=new JSONObject(raw);String id=data.optString("id");String type=data.optString("type");
            if(!id.matches("[A-Za-z0-9-]{1,80}"))return;
            switch(type) {
                case "sound.event":if(BuildConfig.DRIVER_QA)QaSounds.play(this,data.optString("kind"),data.optString("key"));reply(id,true);break;
                case "sound.ringback":if(BuildConfig.DRIVER_QA)QaSounds.ringback(this,data.optBoolean("active"));reply(id,true);break;
                case "chat.visible":if(BuildConfig.DRIVER_QA){getSharedPreferences("qa-audio",0).edit().putString("chat",data.optBoolean("visible")?data.optString("rideId"):"").commit();if(data.optBoolean("visible"))getSystemService(NotificationManager.class).cancel("chat:"+data.optString("rideId"),1);}reply(id,true);break;
                case "external.configure":if(externalKeys==null)externalKeys=new DriverExternalKeys(this);externalKeys.configure(data);reply(id,externalKeys.info());break;
                case "external.status":if(externalKeys==null)externalKeys=new DriverExternalKeys(this);externalKeys.active(foreground||DriverForegroundService.running);reply(id,externalKeys.info());break;
                case "ready": reply(id,new JSONObject().put("apiOrigin",apiOrigin).put("qa",BuildConfig.DRIVER_QA).put("appVersion",BuildConfig.VERSION_NAME).put("appVersionCode",BuildConfig.VERSION_CODE).put("notifications",DriverNotifications.permitted(this)).put("foreground",foreground).put("online",online()).put("openOffer","com.dispatchpro.driver.OPEN_OFFER".equals(getIntent().getAction())).put("communicationOpen",communicationIntent()));break;
                case "call.device": CommunicationNotifications.activate(this);reply(id,new JSONObject().put("deviceId",CommunicationNotifications.device(this)));break;
                case "communication.sync": CommunicationNotifications.sync(this,data.getJSONObject("data"),DriverNotifications.timestamp(data.optString("serverTime"),System.currentTimeMillis()));reply(id,true);break;
                case "call.window": NativeCallWindow.apply(this,data.optBoolean("active")?getIntent():new Intent());reply(id,true);break;
                case "call.cancel": CommunicationNotifications.finishCall(this,data.optString("callId"),2);reply(id,true);break;
                case "call.audio":
                    if(data.optBoolean("active")&&(!foreground&&!CallAudioService.requested)){error(id,"افتح شاشة المكالمة أولًا");break;}
                    if(data.optBoolean("active")&&checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){if(permissionGuide.busy()||callAudioReply!=null){error(id,"أكمل تفعيل الأذونات أولًا");break;}callAudioReply=id;callAudioData=data;requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},36);break;}
                    if(callAudio(data))reply(id,true);else error(id,"تعذر بدء خدمة المكالمة؛ راجع الأذونات وإعدادات التطبيق");break;
                case "diagnostics.runtime": {
                    String kind=data.optString("kind");if(!kind.matches("[A-Za-z0-9]{0,40}"))kind="Error";
                    String stage=data.optString("stage");if(!stage.matches("[A-Za-z0-9._-]{1,60}"))stage="runtime";
                    String status=data.optString("status");if(!status.matches("Assigned|Accepted|DriverArriving|Arrived|InProgress|Completed|Cancelled|Rejected|Pending"))status="";
                    String stack=data.optString("stack");if(!stack.matches("[A-Za-z0-9. :_-]{0,300}"))stack="";
                    String field=data.optString("field");if(!field.matches("[A-Za-z0-9._]{0,60}"))field="";
                    JSONObject trace=new JSONObject().put("at",System.currentTimeMillis()).put("stage",stage).put("status",status).put("kind",kind).put("stack",stack).put("field",field).put("http",data.optInt("http",0)).put("version",BuildConfig.VERSION_NAME);
                    android.content.SharedPreferences health=getSharedPreferences("driver-health",0);
                    JSONArray old=new JSONArray(health.getString("runtimeTrace","[]")),next=new JSONArray();for(int i=Math.max(0,old.length()-63);i<old.length();i++)next.put(old.get(i));next.put(trace);
                    android.content.SharedPreferences.Editor editor=health.edit().putString("runtimeTrace",next.toString());
                    if(!kind.isEmpty())editor.putString("runtimeKind",kind).putString("runtimeStage",stage).putLong("runtimeAt",System.currentTimeMillis());editor.apply();
                    android.util.Log.i("NablusDriverRuntime",trace.toString());reply(id,true);break;
                }
                case "session.load": sessions.execute(()->{try{String saved=SecureDriverSession.load(this,apiOrigin);if(saved!=null&&!saved.isEmpty())runOnUiThread(()->{event("background",DriverForegroundService.running);});reply(id,saved);}catch(Exception e){error(id,"تعذر استعادة جلسة السائق");}});break;
                case "session.save": {
                    String saved=data.optString("value","");
                    if(saved.isEmpty()){CommunicationNotifications.clear(this);onlineDuty=false;getSharedPreferences("driver-duty",MODE_PRIVATE).edit().putBoolean("online",false).apply();DriverForegroundService.end(this);DriverNotifications.closeOffers(this);if(pushHook!=null)pushHook.message("{\"type\":\"driver.push-unbound\"}");}
                    sessions.execute(()->{try{SecureDriverSession.saveFromWeb(this,apiOrigin,saved,data.optBoolean("remember",true));reply(id,true);}catch(Exception e){error(id,"تعذر حفظ جلسة السائق");}});break;
                }
                case "request": {
                    String path=data.optString("path");
                    boolean poll=DriverRequestPolicy.longPoll(data.optString("method"),path);
                    boolean control=path.matches("voice/(floor|release|heartbeat)");
                    (poll?polls:control?pttControl:network).execute(()->request(id,data));break;
                }
                case "cancel": cancelled.add(id);HttpURLConnection active=requests.remove(id);if(active!=null)active.disconnect();break;
                case "permission":
                    if(!foreground){reply(id,"denied");break;}
                    if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){permissionRequest=id;requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},33);}
                    else reply(id,DriverNotifications.permitted(this)?"granted":"denied");break;
                case "notification.settings": getSharedPreferences("driver-alerts",0).edit().putInt("tone",Math.max(1,Math.min(4,data.optInt("orderTone",1)))).putBoolean("sound",data.optBoolean("sound",true)).putBoolean("vibration",data.optBoolean("vibration",true)).putBoolean("enabled",data.optBoolean("notifications",true)).commit();DriverNotifications.configure(this);reply(id,true);break;
                case "notification":
                    if(!data.optString("tag").startsWith("driver-offer-"))DriverNotifications.show(this,limited(data.optString("title"),150),limited(data.optString("body"),500),limited(data.optString("tag"),100),limited(data.optString("eventId"),36));reply(id,true);break;
                case "offer": DriverNotifications.offer(this,data.optString("rideId"),data.optString("eventId"),limited(data.optString("offerKey"),160),data.optLong("remaining"));reply(id,true);break;
                case "notification.close": DriverNotifications.close(this,limited(data.optString("tag"),100));reply(id,true);break;
                case "voice.audio": if(!CallAudioService.requested)runOnUiThread(()->{
                    String reason=data.optString("reason");
                    if(!java.util.Arrays.asList("capture","floor","receive","idle","ptt-press").contains(reason))reason="unspecified";
                    android.util.Log.i("DriverAudio","bridge active="+data.optBoolean("active")+" reason="+reason+" prepared="+pttPrepared+" foreground="+foreground);
                    if(!BuildConfig.DRIVER_QA){audio(data.optBoolean("active"));return;}
                    try{audio(data.optBoolean("active"));getSharedPreferences("qa-audio",0).edit().putBoolean("voiceActive",data.optBoolean("active")).apply();reply(id,true);}catch(RuntimeException failure){android.util.Log.w("DriverAudio","Audio operation unavailable");try{audio(false);}catch(RuntimeException ignored){}getSharedPreferences("qa-audio",0).edit().putBoolean("voiceActive",false).apply();error(id,"تعذر تجهيز جهاز الصوت؛ أعد المحاولة");}
                });if(!BuildConfig.DRIVER_QA||CallAudioService.requested)reply(id,true);break;
                case "voice.receiving": if(foreground||DriverForegroundService.running)DriverForegroundService.receiving(this,data.optBoolean("active"));reply(id,true);break;
                case "voice.prepared": pttPrepared=data.optBoolean("active");if(pttPrepared&&foreground&&!CallAudioService.requested)DriverForegroundService.beginMicrophone(this);else if(!pttPrepared)DriverForegroundService.releaseMicrophone(this);reply(id,true);break;
                case "communication.metric": VoiceDiagnostics.record(this,data);reply(id,true);break;
                case "voice.speaker": DriverForegroundService.speaker(data);reply(id,true);break;
                case "service.gps": getSharedPreferences("driver-duty",0).edit().putBoolean("gpsEnabled",data.optBoolean("active",true)).apply();DriverForegroundService.gpsAccessChanged();reply(id,true);break;
                case "service.status": reply(id,DriverForegroundService.running);break;
                case "diagnostics": reply(id,DriverDiagnostics.read(this));break;
                case "diagnostics.copy": getSystemService(android.content.ClipboardManager.class).setPrimaryClip(android.content.ClipData.newPlainText("Nablus Taxi Driver diagnostics",DriverDiagnostics.read(this).toString()));reply(id,true);break;
                case "diagnostics.settings": if(foreground){if("permissions".equals(data.optString("section")))permissionGuide.diagnostics();else if("connection".equals(data.optString("section")))settings();else DriverDiagnostics.settings(this,data.optString("section"));}reply(id,true);break;
                case "service.start": if(foreground)DriverForegroundService.begin(this);reply(id,true);break;
                case "service.duty": onlineDuty=data.optBoolean("active");getSharedPreferences("driver-duty",MODE_PRIVATE).edit().putBoolean("online",onlineDuty).apply();if(onlineDuty){if(foreground){if(BuildConfig.FLAVOR.equals("radio"))DriverForegroundService.playback(this,true);else DriverForegroundService.begin(this);}}else DriverForegroundService.end(this);reply(id,true);break;
                case "location": runOnUiThread(()->location(id));break;
                default: error(id,"Unsupported native action");
            }
        } catch(JSONException ignored) { }
    }
    private static String limited(String text,int count){return text.substring(0,Math.min(text.length(),count));}
    private boolean callAudio(JSONObject data){try{if(data.optBoolean("active")){audio(false);CallAudioService.begin(this,data.optString("callId"),data.optBoolean("speaker"),data.optString("rideId"),data.optString("peerName"));}else {CallAudioService.end(this);NativeCallWindow.apply(this,new Intent());DriverForegroundService.releaseMicrophone(this);}return true;}catch(RuntimeException denied){CallAudioService.end(this);DriverForegroundService.releaseMicrophone(this);return false;}}
    void callFocusLost(){if(web!=null)web.evaluateJavascript("window.dispatchEvent(new Event('dispatchpro-call-focus-lost'))",null);}
    private JSONObject communicationIntent()throws JSONException{Intent i=getIntent();if(!"com.dispatchpro.COMMUNICATION".equals(i.getAction()))return null;return new JSONObject().put("callId",i.getStringExtra("callId")).put("rideId",i.getStringExtra("rideId")).put("action",i.getStringExtra("communicationAction"));}
    private void request(String id,JSONObject data) {
        HttpURLConnection http=null;
        try {
            String method=data.optString("method"),path=data.optString("path"),body=data.optString("body",""),authorization=data.optString("authorization","");
            if(!ApiPolicy.allowed(method,path)||body.length()>131072||authorization.length()>8192||authorization.contains("\r")||authorization.contains("\n"))throw new IOException("Request blocked");
            if((!foreground&&!DriverForegroundService.running&&!CallAudioService.requested)||cancelled.remove(id))throw new IOException("Request cancelled");
            if(path.matches("auth/(driver|radio)-refresh")){
                DriverNativeApi.Result result=DriverNativeApi.refresh(this,apiOrigin,new JSONObject(body).optString("refreshToken"));
                reply(id,new JSONObject().put("status",result.status).put("body",result.body.toString()));return;
            }
            http=(HttpURLConnection)new URL(ApiPolicy.endpoint(apiOrigin,BuildConfig.DEFAULT_WEB_URL,path)).openConnection();requests.put(id,http);
            boolean ptt=path.matches("voice/(floor|release|heartbeat)");
            http.setInstanceFollowRedirects(false);http.setRequestMethod(method);http.setConnectTimeout(ptt?4000:10000);http.setReadTimeout(ptt?6000:32000);http.setUseCaches(false);
            if(path.matches("auth/(driver|radio)-login"))http.setRequestProperty("X-Driver-Session","native");
            http.setRequestProperty("Accept","application/json");http.setRequestProperty("Cache-Control","no-store");
            if(!authorization.isEmpty())http.setRequestProperty("Authorization",authorization);
            if(!"GET".equals(method)){http.setDoOutput(true);http.setRequestProperty("Content-Type","application/json");try(OutputStream out=http.getOutputStream()){out.write(body.getBytes(StandardCharsets.UTF_8));}}
            int status=http.getResponseCode();if(BuildConfig.DRIVER_QA&&(path.startsWith("auth/")||"PUT".equals(method)))android.util.Log.i("QaConnection","HTTP status="+status+" operation="+(path.startsWith("auth/")?"auth":"mutation"));if(status>=300&&status<400)throw new IOException("API redirect refused");
            InputStream input=status>=400?http.getErrorStream():http.getInputStream();ByteArrayOutputStream buffer=new ByteArrayOutputStream();
            if(input!=null)try(InputStream source=input){byte[] chunk=new byte[8192];int count;while((count=source.read(chunk))!=-1){if(buffer.size()+count>524288)throw new IOException("Response too large");buffer.write(chunk,0,count);}}
            if(status==200&&(path.equals("driver/location")||path.equals("radio/location"))&&new JSONObject(buffer.toString("UTF-8")).optBoolean("stored",false)){long captured=DriverNotifications.timestamp(new JSONObject(body).optString("capturedAt"),0);getSharedPreferences("driver-health",0).edit().putLong("gpsAt",captured).apply();}
            if(cancelled.remove(id))return;
            reply(id,new JSONObject().put("status",status).put("body",buffer.toString("UTF-8")));
        } catch(Exception failure) {
            if(cancelled.contains(id))return;
            if(BuildConfig.DRIVER_QA){String code=QaNetworkFailure.code(failure,online(),apiOrigin.equals("https://localhost:9443"));android.util.Log.w("QaConnection","Transport code="+code+" exception="+failure.getClass().getSimpleName());transportError(id,code);}
            else error(id,"تعذر الاتصال بخادم المكتب؛ تحقق من الاتصال ورابط API");
        }
        finally { requests.remove(id);cancelled.remove(id);if(http!=null)http.disconnect(); }
    }
    private void reply(String id,Object data){runOnUiThread(()->{try{if(port!=null)port.postMessage(new WebMessage(new JSONObject().put("id",id).put("data",data).toString()));}catch(Exception ignored){}});}
    private void error(String id,String message){runOnUiThread(()->{try{if(port!=null)port.postMessage(new WebMessage(new JSONObject().put("id",id).put("error",message).toString()));}catch(Exception ignored){}});}
    private void transportError(String id,String code){runOnUiThread(()->{try{if(port!=null)port.postMessage(new WebMessage(new JSONObject().put("id",id).put("error",QaNetworkFailure.message(code)).put("code",code).toString()));}catch(Exception ignored){}});}
    private boolean online(){if(BuildConfig.DRIVER_QA&&"https://localhost:9443".equals(apiOrigin))return true;NetworkCapabilities capabilities=connectivity==null?null:connectivity.getNetworkCapabilities(connectivity.getActiveNetwork());return capabilities!=null&&capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);}
    private void event(String name,boolean value){try{if(port!=null)port.postMessage(new WebMessage(new JSONObject().put("event",name).put("value",value).toString()));}catch(Exception ignored){}}
    void serviceChanged(boolean active){runOnUiThread(()->{if(externalKeys!=null)externalKeys.active(foreground||active);event("background",active);});}
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);NativeCallWindow.apply(this,intent);if("com.dispatchpro.driver.OPEN_OFFER".equals(intent.getAction()))event("offer-open",true);try{if(port!=null&&communicationIntent()!=null)port.postMessage(new WebMessage(new JSONObject().put("event","communication-open").put("value",communicationIntent()).toString()));}catch(Exception ignored){}}
    private void announceConnectivity(){boolean available=online();connection.setText(available?"🟢 متصل":"🔴 غير متصل");event("online",available);}
    private Network lastVoiceNetwork;
    private void networkChanged(){Network current=connectivity.getActiveNetwork();announceConnectivity();if(Objects.equals(current,lastVoiceNetwork))return;lastVoiceNetwork=current;for(HttpURLConnection active:requests.values())active.disconnect();DriverForegroundService.networkChanged();event("network-changed",true);}
    @Override protected void onResume(){super.onResume();foreground=true;if(BuildConfig.DRIVER_QA)getSharedPreferences("qa-audio",0).edit().putBoolean("foreground",true).apply();if(externalKeys==null)externalKeys=new DriverExternalKeys(this);externalKeys.active(true);permissionGuide.firstRun();DriverForegroundService.background(false);if(onlineDuty&&!DriverForegroundService.running)DriverForegroundService.begin(this);if(pushHook!=null)pushHook.refresh();if(web!=null){web.onResume();web.resumeTimers();}event("foreground",true);if(voiceFocusPaused){voiceFocusPaused=false;event("voice-focus",true);}announceConnectivity();}
    @Override protected void onPause(){if(externalKeys!=null)externalKeys.release();DriverForegroundService.background(onlineDuty);foreground=false;if(BuildConfig.DRIVER_QA)getSharedPreferences("qa-audio",0).edit().putBoolean("foreground",false).apply();DriverForegroundService.receivingBackground(pttPrepared||audioRouteActive||DriverForegroundService.receivingReady());event("background",DriverForegroundService.running);event("foreground",false);if(!DriverForegroundService.running&&!CallAudioService.requested){for(HttpURLConnection request:requests.values())request.disconnect();if(web!=null){web.onPause();web.pauseTimers();}}super.onPause();}
    @Override public void onRequestPermissionsResult(int requestCode,String[] permissions,int[] results){super.onRequestPermissionsResult(requestCode,permissions,results);if(permissionGuide.result(requestCode))return;if(requestCode==36&&callAudioReply!=null){if(foreground&&checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED){if(callAudio(callAudioData))reply(callAudioReply,true);else error(callAudioReply,"تعذر بدء خدمة المكالمة؛ راجع الأذونات");}else error(callAudioReply,"إذن الميكروفون مطلوب للمكالمة؛ يمكنك تفعيله من الإعدادات");callAudioReply=null;callAudioData=null;return;}if(requestCode==35&&microphonePermission!=null){if(foreground&&checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED){if(!CallAudioService.requested)DriverForegroundService.beginMicrophone(this);microphonePermission.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});}else microphonePermission.deny();microphonePermission=null;}if(requestCode==34&&locationPermission!=null){locationPermission.invoke(locationOrigin,foreground&&checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED,false);locationPermission=null;locationOrigin=null;if(onlineDuty&&foreground)DriverForegroundService.begin(this);}if(requestCode==33&&permissionRequest!=null){reply(permissionRequest,DriverNotifications.permitted(this)?"granted":"denied");permissionRequest=null;}}
    private void settings(){
        if(BuildConfig.DRIVER_QA){Toast.makeText(this,"اتصال نسخة QA مقيد ببيئة الاختبار",Toast.LENGTH_LONG).show();return;}
        LinearLayout panel=new LinearLayout(this);panel.setOrientation(LinearLayout.VERTICAL);panel.setPadding(32,16,32,8);
        TextView help=new TextView(this);help.setText("رابط المكتب الآمن. تغيير الرابط ينهي الجلسة المحلية. تنبيهات التطبيق المغلق تحتاج إعداد Firebase.");panel.addView(help);
        EditText value=new EditText(this);value.setSingleLine(true);value.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_URI);value.setText(apiOrigin);panel.addView(value);
        new AlertDialog.Builder(this).setTitle("اتصال المكتب").setView(panel).setNegativeButton("إلغاء",null).setPositiveButton("حفظ",(dialog,which)->{
            try{String origin=ApiPolicy.origin(value.getText().toString());if(!origin.equals(apiOrigin)){apiOrigin=origin;getPreferences(MODE_PRIVATE).edit().putString("apiOrigin",origin).apply();for(HttpURLConnection request:requests.values())request.disconnect();web.reload();}}
            catch(IllegalArgumentException invalid){Toast.makeText(this,"أدخل رابط HTTPS الأساسي دون مسار أو بيانات دخول",Toast.LENGTH_LONG).show();}
        }).show();
    }
    private void location(String id){
        if(!DriverForegroundService.running||checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)!=PackageManager.PERMISSION_GRANTED){error(id,"إذن الموقع مطلوب");return;}
        android.location.LocationManager manager=getSystemService(android.location.LocationManager.class);
        String provider=checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED?android.location.LocationManager.GPS_PROVIDER:android.location.LocationManager.NETWORK_PROVIDER;
        Handler handler=new Handler(Looper.getMainLooper());
        android.location.LocationListener listener=new android.location.LocationListener(){
            @Override public void onLocationChanged(android.location.Location point){if(point.getAccuracy()>200)return;manager.removeUpdates(this);handler.removeCallbacksAndMessages(null);try{reply(id,new JSONObject().put("latitude",point.getLatitude()).put("longitude",point.getLongitude()).put("accuracy",point.getAccuracy()).put("timestamp",point.getTime()));}catch(Exception failure){error(id,"تعذر تحديث الموقع");}}
            @Override public void onProviderDisabled(String name){} @Override public void onProviderEnabled(String name){} @Override public void onStatusChanged(String name,int value,Bundle data){}
        };
        try{if(manager.isProviderEnabled(provider))manager.requestLocationUpdates(provider,0,0,listener,Looper.getMainLooper());if(!provider.equals(android.location.LocationManager.NETWORK_PROVIDER)&&manager.isProviderEnabled(android.location.LocationManager.NETWORK_PROVIDER))handler.postDelayed(()->{try{manager.requestLocationUpdates(android.location.LocationManager.NETWORK_PROVIDER,0,0,listener,Looper.getMainLooper());}catch(Exception ignored){}},8000);handler.postDelayed(()->{manager.removeUpdates(listener);error(id,"انتهت مهلة GPS");},20000);}catch(Exception denied){error(id,"تعذر تحديث الموقع");}
    }
    private boolean pttPrepared;
    private void audio(boolean active){
        if(!active&&!pttPrepared)DriverForegroundService.releaseMicrophone(this);if(foreground)DriverForegroundService.playback(this,active||(BuildConfig.FLAVOR.equals("radio")&&onlineDuty));
        if(audioManager==null)return;
        if(active&&audioRouteActive)return;
        android.util.Log.i("DriverAudio","route active="+active+" previousType="+(previousCommunicationDevice==null?-1:previousCommunicationDevice.getType()));
        if(!active){
            try {
                if(audioRouteActive){
                    if(!voiceFocusPaused){if(Build.VERSION.SDK_INT>=26&&audioFocus!=null)audioManager.abandonAudioFocusRequest(audioFocus);else audioManager.abandonAudioFocus(null);}
                    try {
                        if(Build.VERSION.SDK_INT>=31)CommunicationRoute.restore(audioManager,previousCommunicationDevice);
                        else audioManager.setSpeakerphoneOn(previousSpeaker);
                    } finally { audioManager.setMode(previousAudioMode); }
                }
            } finally {
                previousCommunicationDevice=null;
                if(!voiceFocusPaused)audioFocus=null;
                audioRouteActive=false;
            }
            return;
        }
        previousAudioMode=audioManager.getMode();previousSpeaker=audioManager.isSpeakerphoneOn();if(Build.VERSION.SDK_INT>=31)previousCommunicationDevice=audioManager.getCommunicationDevice();audioRouteActive=true;audioManager.setMode(android.media.AudioManager.MODE_IN_COMMUNICATION);
        android.media.AudioAttributes attributes=new android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH).build();
        android.media.AudioManager.OnAudioFocusChangeListener listener=change->{if(change<0){voiceFocusPaused=true;if(externalKeys!=null)externalKeys.release();event("voice-focus",false);}else if(change==android.media.AudioManager.AUDIOFOCUS_GAIN){voiceFocusPaused=false;event("voice-focus",true);}};
        int focusResult;if(Build.VERSION.SDK_INT>=26){if(audioFocus!=null)audioManager.abandonAudioFocusRequest(audioFocus);audioFocus=new android.media.AudioFocusRequest.Builder(android.media.AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(attributes).setOnAudioFocusChangeListener(listener).build();focusResult=audioManager.requestAudioFocus(audioFocus);}else focusResult=audioManager.requestAudioFocus(listener,android.media.AudioManager.STREAM_VOICE_CALL,android.media.AudioManager.AUDIOFOCUS_GAIN);
        if(focusResult!=android.media.AudioManager.AUDIOFOCUS_REQUEST_GRANTED){voiceFocusPaused=true;event("voice-focus",false);}
        if(Build.VERSION.SDK_INT>=31){android.media.AudioDeviceInfo current=audioManager.getCommunicationDevice();if(!externalAudio(current)){android.media.AudioDeviceInfo speaker=null;for(android.media.AudioDeviceInfo device:audioManager.getAvailableCommunicationDevices()){if(externalAudio(device)&&CommunicationRoute.select(audioManager,device)){speaker=null;break;}if(device.getType()==android.media.AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)speaker=device;}if(speaker!=null)CommunicationRoute.select(audioManager,speaker);}}
        else if(!audioManager.isBluetoothScoOn()&&!audioManager.isWiredHeadsetOn())audioManager.setSpeakerphoneOn(true);
    }
    static boolean externalAudio(android.media.AudioDeviceInfo d){return d!=null&&(d.getType()==android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO||d.getType()==android.media.AudioDeviceInfo.TYPE_BLE_HEADSET||d.getType()==android.media.AudioDeviceInfo.TYPE_WIRED_HEADSET||d.getType()==android.media.AudioDeviceInfo.TYPE_USB_HEADSET);}
    @Override public void onBackPressed(){moveTaskToBack(true);}
    void closeEngineIfDestroyed(){if(destroyed&&!DriverForegroundService.running&&!CallAudioService.requested)closeEngine();}
    boolean backgroundDuty(){return !foreground&&onlineDuty;}
    boolean backgroundVoice(){return !foreground&&(pttPrepared||audioRouteActive||DriverForegroundService.receivingReady());}
    void closeEngine(){if(externalKeys!=null){externalKeys.close();externalKeys=null;}if(networkCallback!=null){try{connectivity.unregisterNetworkCallback(networkCallback);}catch(Exception ignored){}networkCallback=null;}for(HttpURLConnection request:requests.values())request.disconnect();network.shutdownNow();pttControl.shutdownNow();polls.shutdownNow();sessions.shutdown();voiceFocusPaused=false;if(Build.VERSION.SDK_INT>=26&&audioFocus!=null)audioManager.abandonAudioFocusRequest(audioFocus);audioFocus=null;audio(false);if(port!=null){port.close();port=null;}if(web!=null){web.destroy();web=null;}}
    @Override protected void onDestroy(){destroyed=true;if(!DriverForegroundService.running&&!CallAudioService.requested)closeEngine();super.onDestroy();}
}
