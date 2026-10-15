package com.dispatchpro.driver;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/** Official FCM callback, including background data messages. Never polls. */
public final class CustomerMessagingService extends FirebaseMessagingService {
    @Override public void onMessageReceived(RemoteMessage message){
        Map<String,String> data=message.getData();
        android.content.SharedPreferences store=getSharedPreferences("customer-push",MODE_PRIVATE);
        if(!PushEnvelopePolicy.accepts(data,store.getBoolean("bound",false),store.getString("installation",""),store.getString("recipient",""),false))return;
        String eventId=data.get("eventId");if(eventId==null||!eventId.matches("[a-fA-F0-9-]{36}"))return;
        String type=data.get("type");
        NativeCommunicationPush.display(this,data);
        if("CHAT".equals(type)||"CALL".equals(type)||"CALL_END".equals(type)||"ARRIVAL_ACK".equals(type)||"ARRIVED".equals(type)||"RIDE_STATUS".equals(type))MobileSyncJob.schedule(this);
    }
    @Override public void onNewToken(String token){
        // Firebase persists/rotates its own token. Re-register through the existing
        // authenticated WebView session on next resume; never store JWT here.
        CustomerPushRegistrationJob.schedule(this);
    }
}
