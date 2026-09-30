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
    private TextView connection;
    private WebMessagePort port;
    private volatile String apiOrigin;
    private volatile boolean foreground;
    private String permissionRequest;
    private GeolocationPermissions.Callback locationPermission;
    private String locationOrigin;
    private final ExecutorService network = Executors.newFixedThreadPool(3);
    private final Map<String, HttpURLConnection> requests = new ConcurrentHashMap<>();
    private final Set<String> cancelled = ConcurrentHashMap.newKeySet();
    private ConnectivityManager connectivity;
    private ConnectivityManager.NetworkCallback networkCallback;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        apiOrigin = getPreferences(MODE_PRIVATE).getString("apiOrigin", BuildConfig.DEFAULT_API_URL);
        DriverNotifications.configure(this);
        LinearLayout root = new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setBackgroundColor(Color.WHITE);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());return insets;
        });
        LinearLayout header = new LinearLayout(this);header.setGravity(Gravity.CENTER_VERTICAL);header.setPadding(12, 4, 12, 4);
        connection = new TextView(this);connection.setTextSize(12);connection.setText("DispatchPro Driver · 0.1.2");
        header.addView(connection, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button settings = new Button(this);settings.setText("الاتصال");settings.setOnClickListener(v -> settings());header.addView(settings);
        root.addView(header);web = new WebView(this);root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));setContentView(root);
        WebSettings options = web.getSettings();options.setJavaScriptEnabled(true);options.setDomStorageEnabled(false);
        options.setAllowFileAccess(false);options.setAllowContentAccess(false);options.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        options.setCacheMode(WebSettings.LOAD_NO_CACHE);options.setSupportMultipleWindows(false);
        options.setGeolocationEnabled(true);
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (!foreground || !(APP_ORIGIN.equals(origin) || (APP_ORIGIN+"/").equals(origin))) { callback.invoke(origin,false,false); return; }
                if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED) { callback.invoke(origin,true,false); return; }
                if (locationPermission!=null) { callback.invoke(origin,false,false); return; }
                locationPermission=callback;locationOrigin=origin;
                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},34);
            }
        });
        android.webkit.CookieManager.getInstance().setAcceptCookie(false);
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri=request.getUrl();String path=uri.getPath();
                if (!APP_ORIGIN.equals(uri.getScheme()+"://"+uri.getAuthority()) || !"GET".equals(request.getMethod())
                        || !("/index.html".equals(path)||"/app.js".equals(path)||"/app.css".equals(path))) return denied();
                try {
                    String mime=path.endsWith(".js")?"application/javascript":path.endsWith(".css")?"text/css":"text/html";
                    return new WebResourceResponse(mime,"UTF-8",200,"OK",Collections.singletonMap("Cache-Control","no-store"),getAssets().open(path.substring(1)));
                } catch(IOException error) { return denied(); }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri=request.getUrl();
                if ((APP_ORIGIN+"/index.html").equals(uri.toString())) return false;
                if (request.isForMainFrame() && ("tel".equals(uri.getScheme()) || ("https".equals(uri.getScheme())&&"www.google.com".equals(uri.getHost())&&uri.getPath()!=null&&uri.getPath().startsWith("/maps/")))) {
                    try { startActivity(new Intent("tel".equals(uri.getScheme())?Intent.ACTION_DIAL:Intent.ACTION_VIEW,uri)); } catch(ActivityNotFoundException ignored) { Toast.makeText(MainActivity.this,"لا يوجد تطبيق لفتح الرابط",Toast.LENGTH_SHORT).show(); }
                }
                return true;
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) { handler.cancel(); }
            @Override public void onPageFinished(WebView view, String url) {
                if (!(APP_ORIGIN+"/index.html").equals(url)) return;
                if(port!=null)port.close();WebMessagePort[] channels=web.createWebMessageChannel();port=channels[0];
                port.setWebMessageCallback(new WebMessagePort.WebMessageCallback(){@Override public void onMessage(WebMessagePort source,WebMessage message){receive(message.getData());}});
                web.postWebMessage(new WebMessage("dispatchpro-connect",new WebMessagePort[]{channels[1]}),Uri.parse(APP_ORIGIN));
            }
        });
        connectivity=getSystemService(ConnectivityManager.class);
        networkCallback=new ConnectivityManager.NetworkCallback(){
            @Override public void onAvailable(Network n){runOnUiThread(()->announceConnectivity());}
            @Override public void onLost(Network n){runOnUiThread(()->announceConnectivity());}
        };
        connectivity.registerDefaultNetworkCallback(networkCallback);
        web.loadUrl(APP_ORIGIN+"/index.html");
    }
    private WebResourceResponse denied(){return new WebResourceResponse("text/plain","UTF-8",403,"Forbidden",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
    private void receive(String raw) {
        if(raw==null||raw.length()>150000)return;
        try {
            JSONObject data=new JSONObject(raw);String id=data.optString("id");String type=data.optString("type");
            if(!id.matches("[A-Za-z0-9-]{1,80}"))return;
            switch(type) {
                case "ready": reply(id,new JSONObject().put("apiOrigin",apiOrigin).put("notifications",DriverNotifications.permitted(this)).put("foreground",foreground).put("online",online()));break;
                case "request": network.execute(()->request(id,data));break;
                case "cancel": cancelled.add(id);HttpURLConnection active=requests.remove(id);if(active!=null)active.disconnect();break;
                case "permission":
                    if(!foreground){reply(id,"denied");break;}
                    if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){permissionRequest=id;requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},33);}
                    else reply(id,DriverNotifications.permitted(this)?"granted":"denied");break;
                case "notification":
                    if(foreground)DriverNotifications.show(this,limited(data.optString("title"),150),limited(data.optString("body"),500));reply(id,true);break;
                default: error(id,"Unsupported native action");
            }
        } catch(JSONException ignored) { }
    }
    private static String limited(String text,int count){return text.substring(0,Math.min(text.length(),count));}
    private void request(String id,JSONObject data) {
        HttpURLConnection http=null;
        try {
            String method=data.optString("method"),path=data.optString("path"),body=data.optString("body",""),authorization=data.optString("authorization","");
            if(!ApiPolicy.allowed(method,path)||body.length()>131072||authorization.length()>8192||authorization.contains("\r")||authorization.contains("\n"))throw new IOException("Request blocked");
            if(!foreground||cancelled.remove(id))throw new IOException("Request cancelled");
            http=(HttpURLConnection)new URL(ApiPolicy.origin(apiOrigin)+"/api/v1/"+path).openConnection();requests.put(id,http);
            http.setInstanceFollowRedirects(false);http.setRequestMethod(method);http.setConnectTimeout(10000);http.setReadTimeout(32000);http.setUseCaches(false);
            http.setRequestProperty("Accept","application/json");http.setRequestProperty("Cache-Control","no-store");
            if(!authorization.isEmpty())http.setRequestProperty("Authorization",authorization);
            if(!"GET".equals(method)){http.setDoOutput(true);http.setRequestProperty("Content-Type","application/json");try(OutputStream out=http.getOutputStream()){out.write(body.getBytes(StandardCharsets.UTF_8));}}
            int status=http.getResponseCode();if(status>=300&&status<400)throw new IOException("API redirect refused");
            InputStream input=status>=400?http.getErrorStream():http.getInputStream();ByteArrayOutputStream buffer=new ByteArrayOutputStream();
            if(input!=null)try(InputStream source=input){byte[] chunk=new byte[8192];int count;while((count=source.read(chunk))!=-1){if(buffer.size()+count>524288)throw new IOException("Response too large");buffer.write(chunk,0,count);}}
            if(cancelled.remove(id))return;
            reply(id,new JSONObject().put("status",status).put("body",buffer.toString("UTF-8")));
        } catch(Exception error) { error(id,"تعذر الاتصال بخادم المكتب؛ تحقق من الاتصال ورابط API"); }
        finally { requests.remove(id);cancelled.remove(id);if(http!=null)http.disconnect(); }
    }
    private void reply(String id,Object data){runOnUiThread(()->{try{if(port!=null)port.postMessage(new WebMessage(new JSONObject().put("id",id).put("data",data).toString()));}catch(Exception ignored){}});}
    private void error(String id,String message){runOnUiThread(()->{try{if(port!=null)port.postMessage(new WebMessage(new JSONObject().put("id",id).put("error",message).toString()));}catch(Exception ignored){}});}
    private boolean online(){NetworkCapabilities capabilities=connectivity==null?null:connectivity.getNetworkCapabilities(connectivity.getActiveNetwork());return capabilities!=null&&capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);}
    private void event(String name,boolean value){try{if(port!=null)port.postMessage(new WebMessage(new JSONObject().put("event",name).put("value",value).toString()));}catch(Exception ignored){}}
    private void announceConnectivity(){boolean available=online();connection.setText(available?"DispatchPro Driver · إشعارات أثناء الفتح":"غير متصل بالإنترنت");event("online",available);}
    @Override protected void onResume(){super.onResume();foreground=true;if(web!=null){web.onResume();web.resumeTimers();}event("foreground",true);announceConnectivity();}
    @Override protected void onPause(){foreground=false;event("foreground",false);for(HttpURLConnection request:requests.values())request.disconnect();if(web!=null){web.onPause();web.pauseTimers();}super.onPause();}
    @Override public void onRequestPermissionsResult(int requestCode,String[] permissions,int[] results){super.onRequestPermissionsResult(requestCode,permissions,results);if(requestCode==34&&locationPermission!=null){locationPermission.invoke(locationOrigin,foreground&&checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED,false);locationPermission=null;locationOrigin=null;}if(requestCode==33&&permissionRequest!=null){reply(permissionRequest,DriverNotifications.permitted(this)?"granted":"denied");permissionRequest=null;}}
    private void settings(){
        LinearLayout panel=new LinearLayout(this);panel.setOrientation(LinearLayout.VERTICAL);panel.setPadding(32,16,32,8);
        TextView help=new TextView(this);help.setText("رابط API الحالي (HTTPS). تغيير الرابط ينهي الجلسة المحلية. التنبيهات تعمل أثناء فتح التطبيق فقط؛ Push خارجي غير مفعّل.");panel.addView(help);
        EditText value=new EditText(this);value.setSingleLine(true);value.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_URI);value.setText(apiOrigin);panel.addView(value);
        new AlertDialog.Builder(this).setTitle("اتصال المكتب").setView(panel).setNegativeButton("إلغاء",null).setPositiveButton("حفظ",(dialog,which)->{
            try{String origin=ApiPolicy.origin(value.getText().toString());if(!origin.equals(apiOrigin)){apiOrigin=origin;getPreferences(MODE_PRIVATE).edit().putString("apiOrigin",origin).apply();for(HttpURLConnection request:requests.values())request.disconnect();web.reload();}}
            catch(IllegalArgumentException invalid){Toast.makeText(this,"أدخل رابط HTTPS الأساسي دون مسار أو بيانات دخول",Toast.LENGTH_LONG).show();}
        }).show();
    }
    @Override public void onBackPressed(){new AlertDialog.Builder(this).setMessage("وضع التطبيق في الخلفية يوقف استقبال الطلبات حتى العودة. هل تريد المتابعة؟").setNegativeButton("البقاء",null).setPositiveButton("متابعة",(d,w)->moveTaskToBack(true)).show();}
    @Override protected void onDestroy(){if(networkCallback!=null)connectivity.unregisterNetworkCallback(networkCallback);for(HttpURLConnection request:requests.values())request.disconnect();network.shutdownNow();if(port!=null)port.close();if(web!=null)web.destroy();super.onDestroy();}
}
