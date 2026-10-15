package com.dispatchpro.driver;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.ActivityNotFoundException;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.*;
import android.widget.*;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Collections;

/** Customer flavor of the existing Android project. Uses the existing hosted customer app and APIs. */
public final class CustomerActivity extends Activity {
    private WebView web;
    private TextView status;
    private String origin;
    private boolean foreground;
    private GeolocationPermissions.Callback locationPermission;
    private String locationOrigin;
    private WebMessagePort arrivalPort;
    private CustomerPushHook push;
    private NativePermissions permissionGuide;private PermissionRequest microphonePermission;private org.json.JSONObject callAudioPending;private boolean destroyed;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);NativeCallWindow.apply(this,getIntent());permissionGuide=new NativePermissions(this,false);CommunicationNotifications.configure(this);
        origin = CustomerOriginPolicy.origin(BuildConfig.DEFAULT_WEB_URL, BuildConfig.DEBUG, BuildConfig.CUSTOMER_LOCAL_DEBUG);
        getPreferences(MODE_PRIVATE).edit().putString("webOrigin",origin).apply();
        LinearLayout root = new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setBackgroundColor(Color.WHITE);
        root.setOnApplyWindowInsetsListener((view,insets)->{view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets;});
        status=new TextView(this);status.setVisibility(android.view.View.GONE);status.setPadding(16,8,16,8);status.setTextSize(16);status.setOnClickListener(v->{if(web!=null)web.reload();});root.addView(status,new LinearLayout.LayoutParams(-1,-2));
        CustomerArrivalNotifications.configure(this);
        if("customer".equals(BuildConfig.FLAVOR))try{
            push=(CustomerPushHook)Class.forName("com.dispatchpro.driver.CustomerPushBridge").getConstructor(android.content.Context.class).newInstance(this);
        }catch(ReflectiveOperationException ignored){ /* Unconfigured customer build remains usable. */ }
        Button settings=new Button(this);settings.setText("الأذونات والصوت");settings.setOnClickListener(v->permissionGuide.diagnostics());root.addView(settings,new LinearLayout.LayoutParams(-1,-2));
        web=new WebView(this);root.addView(web,new LinearLayout.LayoutParams(-1,0,1));setContentView(root);
        WebSettings options=web.getSettings();options.setJavaScriptEnabled(true);options.setDomStorageEnabled(true);options.setGeolocationEnabled(true);
        options.setAllowFileAccess(false);options.setAllowContentAccess(false);options.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);options.setSupportMultipleWindows(false);
        options.setMediaPlaybackRequiresUserGesture(false);options.setCacheMode(WebSettings.LOAD_DEFAULT);options.setUserAgentString(options.getUserAgentString()+" NM-Customer/"+BuildConfig.VERSION_NAME);CookieManager.getInstance().setAcceptCookie(false);
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                Uri uri=request.getUrl();if(sameOrigin(uri)&&uri.getPath()!=null&&uri.getPath().startsWith("/customer-mobile/"))return false;
                if(request.isForMainFrame()&&("tel".equals(uri.getScheme())||"https".equals(uri.getScheme())&&("wa.me".equals(uri.getHost())||"www.google.com".equals(uri.getHost())&&uri.getPath()!=null&&uri.getPath().startsWith("/maps/")))){
                    try{startActivity(new Intent("tel".equals(uri.getScheme())?Intent.ACTION_DIAL:Intent.ACTION_VIEW,uri));}catch(ActivityNotFoundException ignored){Toast.makeText(CustomerActivity.this,"لا يوجد تطبيق لفتح الرابط",Toast.LENGTH_SHORT).show();}
                }return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                Uri uri=request.getUrl();String path=uri.getPath();
                if(sameOrigin(uri)&&path!=null&&path.startsWith("/api/customer/"))return null;
                if(sameOrigin(uri)&&"GET".equals(request.getMethod())&&path!=null&&path.matches("/customer-mobile/[a-zA-Z0-9_.-]+")){
                    try{String name=path.substring("/customer-mobile/".length());String mime=name.endsWith(".js")?"text/javascript":name.endsWith(".css")?"text/css":name.endsWith(".webp")?"image/webp":name.endsWith(".png")?"image/png":name.endsWith(".svg")?"image/svg+xml":name.endsWith(".webmanifest")?"application/manifest+json":"text/html";
                        return new WebResourceResponse(mime,"UTF-8",200,"OK",Collections.singletonMap("Cache-Control","no-store"),customerAsset(name));
                    }catch(IOException ignored){}
                }
                if("GET".equals(request.getMethod())&&"https".equals(uri.getScheme())&&"tile.openstreetmap.org".equals(uri.getHost())&&uri.getUserInfo()==null&&uri.getQuery()==null&&path!=null&&path.matches("/[0-9]{1,2}/[0-9]+/[0-9]+\\.png"))return null;
                return new WebResourceResponse("text/plain","UTF-8",403,"Forbidden",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));
            }
            @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,SslError error){handler.cancel();status.setText("تعذر التحقق من اتصال HTTPS · اضغط للمحاولة");status.setVisibility(android.view.View.VISIBLE);}
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame()){status.setText("تعذر الاتصال · تحقق من الإنترنت واضغط للمحاولة");status.setVisibility(android.view.View.VISIBLE);}}
            @Override public boolean onRenderProcessGone(WebView view,RenderProcessGoneDetail detail){CallAudioService.end(CustomerActivity.this);if(arrivalPort!=null){arrivalPort.close();arrivalPort=null;}view.destroy();web=null;getSharedPreferences("communication-metrics",0).edit().putLong("rendererFailureAt",System.currentTimeMillis()).apply();WebViewRecovery.show(CustomerActivity.this);return true;}
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon){if(arrivalPort!=null){arrivalPort.close();arrivalPort=null;}}
            @Override public void onPageFinished(WebView view,String url){if(url.equals(origin+"/customer-mobile/index.html")){
                status.setText("تكسي نابلس والمهندس · الزبون");status.setVisibility(android.view.View.GONE);
                if(arrivalPort!=null)arrivalPort.close();
                WebMessagePort[] ports=web.createWebMessageChannel();arrivalPort=ports[0];
                arrivalPort.setWebMessageCallback(new WebMessagePort.WebMessageCallback(){@Override public void onMessage(WebMessagePort port,WebMessage message){
                    if((!foreground&&!CallAudioService.requested)||!url.equals(web.getUrl())||port!=arrivalPort)return;
                    String eventId=message.getData();if(communication(eventId))return;if("{\"type\":\"notification-permission\"}".equals(eventId)){enableNotifications();return;}if(eventId!=null&&(push==null||!push.message(eventId)))CustomerArrivalNotifications.show(CustomerActivity.this,eventId);
                }});
                web.postWebMessage(new WebMessage("dispatchpro-customer-arrival",new WebMessagePort[]{ports[1]}),Uri.parse(origin));
                if(push!=null)push.ready(arrivalPort);communicationOpen();
            }}
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public void onPermissionRequest(PermissionRequest request){if(!foreground||!sameOrigin(request.getOrigin())||microphonePermission!=null||!java.util.Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)){request.deny();return;}if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED){request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});return;}if(permissionGuide.busy()){request.deny();return;}microphonePermission=request;requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},45);}
            @Override public void onPermissionRequestCanceled(PermissionRequest request){if(microphonePermission==request)microphonePermission=null;}
            @Override public void onGeolocationPermissionsShowPrompt(String requestedOrigin,GeolocationPermissions.Callback callback){
                if(!foreground||!(origin.equals(requestedOrigin)||(origin+"/").equals(requestedOrigin))){callback.invoke(requestedOrigin,false,false);return;}
                if(checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED){callback.invoke(requestedOrigin,true,false);return;}
                if(locationPermission!=null||permissionGuide.busy()){callback.invoke(requestedOrigin,false,false);return;}
                locationPermission=callback;locationOrigin=requestedOrigin;requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},43);
            }
        });
        web.loadUrl(origin+"/customer-mobile/index.html");
    }
    private boolean communication(String raw){try{org.json.JSONObject input=new org.json.JSONObject(raw);String type=input.optString("type");if(!type.startsWith("call.")&&!type.equals("communication.sync")&&!type.equals("communication.metric"))return false;switch(type){case "communication.metric":String metric=input.optString("name");if(metric.matches("[A-Za-z]{1,50}"))getSharedPreferences("communication-metrics",0).edit().putLong(metric,Math.max(0,Math.min(600000,input.optLong("ms")))).apply();communicationReply(input,true,"");break;case "call.device":CommunicationNotifications.activate(this);communicationReply(input,new org.json.JSONObject().put("deviceId",CommunicationNotifications.device(this)),"");break;case "communication.sync":CommunicationNotifications.sync(this,input.getJSONObject("data"),DriverNotifications.timestamp(input.optString("serverTime"),System.currentTimeMillis()));communicationReply(input,true,"");break;case "call.window":NativeCallWindow.apply(this,input.optBoolean("active")?getIntent():new Intent());communicationReply(input,true,"");break;case "call.cancel":CommunicationNotifications.finishCall(this,input.optString("callId"),2);communicationReply(input,true,"");break;case "call.audio":if(input.optBoolean("active")){if(!foreground&&!CallAudioService.requested){communicationReply(input,false,"افتح شاشة المكالمة أولًا");break;}if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){if(permissionGuide.busy()||callAudioPending!=null){communicationReply(input,false,"أكمل تفعيل الأذونات أولًا");break;}callAudioPending=input;requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},45);break;}if(!beginCallAudio(input))break;}else {CallAudioService.end(this);NativeCallWindow.apply(this,new Intent());}communicationReply(input,true,"");break;default:communicationReply(input,false,"غير مدعوم");}return true;}catch(Exception ignored){return false;}}
    private void communicationReply(org.json.JSONObject input,Object data,String error){try{if(arrivalPort!=null)arrivalPort.postMessage(new WebMessage(new org.json.JSONObject().put("type","native-result").put("id",input.optString("id")).put("data",data).put("error",error).toString()));}catch(Exception ignored){}}
    private boolean beginCallAudio(org.json.JSONObject input){try{CallAudioService.begin(this,input.optString("callId"),input.optBoolean("speaker"),input.optString("rideId"),input.optString("peerName"));return true;}catch(RuntimeException denied){CallAudioService.end(this);communicationReply(input,false,"تعذر بدء خدمة المكالمة؛ راجع الأذونات وإعدادات التطبيق");return false;}}
    private void communicationOpen(){Intent i=getIntent();if(!"com.dispatchpro.COMMUNICATION".equals(i.getAction()))return;try{if(arrivalPort!=null)arrivalPort.postMessage(new WebMessage(new org.json.JSONObject().put("type","communication-open").put("callId",i.getStringExtra("callId")).put("rideId",i.getStringExtra("rideId")).put("action",i.getStringExtra("communicationAction")).toString()));}catch(Exception ignored){}}
    @Override protected void onNewIntent(Intent i){super.onNewIntent(i);setIntent(i);NativeCallWindow.apply(this,i);communicationOpen();}
    void callFocusLost(){if(web!=null)web.evaluateJavascript("window.dispatchEvent(new Event('dispatchpro-call-focus-lost'))",null);}
    private java.io.InputStream customerAsset(String name)throws IOException {
        java.io.InputStream input=getAssets().open("customer-mobile/"+name);
        if(!"index.html".equals(name))return input;
        java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();
        try(java.io.InputStream stream=input){byte[] chunk=new byte[8192];int n;while((n=stream.read(chunk))!=-1)bytes.write(chunk,0,n);}
        String html=bytes.toString("UTF-8").replace("window.dispatchProCustomerNative=true;","window.dispatchProCustomerNative=true;window.dispatchProCustomerDebug="+BuildConfig.DEBUG+";");
        if(BuildConfig.DEBUG&&!BuildConfig.CUSTOMER_LOCAL_DEBUG)html=html.replace("</head>","<script src=\"test-login.js\" defer></script></head>");
        return new ByteArrayInputStream(html.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
    private boolean sameOrigin(Uri uri){return uri.getUserInfo()==null&&origin.equals(uri.getScheme()+"://"+uri.getAuthority());}
    private void enableNotifications(){
        if(android.os.Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},44);
        else Toast.makeText(this,"تنبيه الوصول يخضع لإعدادات الصوت والإشعارات في هاتفك",Toast.LENGTH_LONG).show();
    }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] grants){super.onRequestPermissionsResult(request,permissions,grants);if(permissionGuide.result(request))return;if(request==45){boolean allowed=foreground&&checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED;if(microphonePermission!=null){if(allowed)microphonePermission.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});else microphonePermission.deny();microphonePermission=null;}if(callAudioPending!=null){org.json.JSONObject input=callAudioPending;callAudioPending=null;if(allowed){if(beginCallAudio(input))communicationReply(input,true,"");}else communicationReply(input,false,"إذن الميكروفون مطلوب للمكالمة");}return;}if(request==43&&locationPermission!=null){boolean allowed=checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED;locationPermission.invoke(locationOrigin,allowed,false);locationPermission=null;locationOrigin=null;}}
    @Override protected void onResume(){super.onResume();foreground=true;permissionGuide.firstRun();if(push!=null)push.refresh();if(web!=null){web.onResume();web.resumeTimers();web.evaluateJavascript("window.dispatchProCustomerNativeForeground=true;window.dispatchEvent(new Event('dispatchpro-driver-foreground'));window.dispatchEvent(new Event('online'))",null);}}
    @Override protected void onPause(){foreground=false;if(web!=null)web.evaluateJavascript("window.dispatchProCustomerNativeForeground=false;window.dispatchEvent(new Event('dispatchpro-driver-foreground'))",null);if(locationPermission!=null){locationPermission.invoke(locationOrigin,false,false);locationPermission=null;}if(web!=null&&!CallAudioService.requested){web.onPause();web.pauseTimers();}super.onPause();}
    @Override public void onBackPressed(){if(web==null){moveTaskToBack(true);return;}web.evaluateJavascript("Boolean(window.dispatchProCustomerBack && window.dispatchProCustomerBack())",result->{if(!"true".equals(result)){if(web.canGoBack())web.goBack();else moveTaskToBack(true);}});}
    void closeEngineIfDestroyed(){if(destroyed){if(arrivalPort!=null){arrivalPort.close();arrivalPort=null;}if(web!=null){web.destroy();web=null;}}}
    @Override protected void onDestroy(){destroyed=true;if(!CallAudioService.requested)closeEngineIfDestroyed();super.onDestroy();}
}
