package com.dispatchpro.driver;
import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import org.json.JSONObject;
import java.util.UUID;

/** Only the existing trusted same-origin WebMessage port can bind this installation. */
public final class CustomerPushBridge implements CustomerPushHook {
    private final SharedPreferences store;
    private final Context context;
    private final String origin;
    private WebMessagePort port;
    private String token="";
    private boolean configured;
    public CustomerPushBridge(Context context){
        this.context=context;
        origin=CustomerOriginPolicy.origin(BuildConfig.DEFAULT_WEB_URL,BuildConfig.DEBUG,BuildConfig.CUSTOMER_LOCAL_DEBUG)+(BuildConfig.DEBUG?"#customer-debug":"");
        store=context.getSharedPreferences("customer-push",Context.MODE_PRIVATE);
        if(!store.contains("installation"))store.edit().putString("installation",UUID.randomUUID().toString()).commit();
        if(!FirebaseApp.getApps(context).isEmpty()){
            configured=true;refresh();
        }
    }
    public void ready(WebMessagePort value){port=value;try{
        String device=CustomerSecureSession.load(context,origin);
        if(!device.isEmpty())port.postMessage(new WebMessage(new JSONObject().put("type","device-restored").put("device",new JSONObject(device)).toString()));
    }catch(Exception ignored){}publish();refresh();}
    public void refresh(){if(configured)FirebaseMessaging.getInstance().getToken().addOnSuccessListener(value->{token=value;publish();});}
    private void publish(){if(port==null||token.isEmpty())return;try{
        JSONObject value=new JSONObject().put("type","push-device").put("installationId",store.getString("installation","")).put("token",token);
        port.postMessage(new WebMessage(value.toString()));
    }catch(Exception ignored){ /* No token/exception logs. Retry on resume. */ }}
    public boolean message(String value){
        if(!value.startsWith("{"))return false;
        try{JSONObject input=new JSONObject(value);String type=input.optString("type");
            if(type.equals("arrival-event"))CustomerArrivalNotifications.show(context,input.optString("eventId"),input.optString("rideId"),input.optString("driverName"));
            else if(type.equals("arrival-ack"))CustomerArrivalNotifications.acknowledge(context,input.optString("eventId"));
            else if(type.equals("push-bound"))store.edit().putBoolean("bound",true).putString("recipient",input.getString("recipient")).putBoolean("wanted",true).commit();
            else if(type.equals("push-unbound")){CommunicationNotifications.clear(context);CustomerArrivalNotifications.acknowledge(context,context.getSharedPreferences("customer-arrival",0).getString("pending",""));store.edit().putBoolean("bound",false).putBoolean("wanted",false).commit();CustomerPushRegistrationJob.cancel(context);}
            else if(type.equals("notifications-enable")&&android.os.Build.VERSION.SDK_INT>=33&&context instanceof android.app.Activity){((android.app.Activity)context).requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},44);}
            else if(type.equals("device-store")){
                JSONObject device=input.getJSONObject("device");
                if(device.optString("accountId").matches("[a-fA-F0-9-]{36}")&&device.optString("deviceSecret").matches("[a-fA-F0-9]{64}")){
                    CustomerSecureSession.save(context,origin,device.toString());
                    port.postMessage(new WebMessage("{\"type\":\"device-stored\"}"));
                }
            }
        }catch(Exception ignored){}return true;
    }
}
