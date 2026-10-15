package com.dispatchpro.driver;
import com.google.firebase.messaging.*;
import java.util.*;
public final class DriverMessagingService extends FirebaseMessagingService{
 @Override public void onMessageReceived(RemoteMessage message){Map<String,String> data=message.getData();android.content.SharedPreferences store=getSharedPreferences("driver-push",0);String type=data.get("type");if(!PushEnvelopePolicy.accepts(data,store.getBoolean("bound",false),store.getString("installation",""),store.getString("recipient",""),true))return;if("DRIVER_REQUEST".equals(type)){DriverOfferSyncJob.schedule(this);return;}NativeCommunicationPush.display(this,data);MobileSyncJob.schedule(this);}
 @Override public void onNewToken(String token){DriverPushRegistrationJob.schedule(this);}
}
