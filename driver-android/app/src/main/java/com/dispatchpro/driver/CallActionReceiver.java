package com.dispatchpro.driver;
import android.content.*;
import org.json.JSONObject;
public final class CallActionReceiver extends BroadcastReceiver {
 @Override public void onReceive(Context c,Intent i){String id=i.getStringExtra("callId");if(!PushDisplayPolicy.guid(id))return;if("expire".equals(i.getAction())){try{CommunicationNotifications.missed(c,new JSONObject().put("id",id).put("rideId",i.getStringExtra("rideId")).put("peerName",i.getStringExtra("peerName")));}catch(Exception ignored){}CommunicationNotifications.finishCall(c,id,2);MobileSyncJob.schedule(c);return;}String action="end".equals(i.getAction())?"end":"reject";if(action.equals("reject"))c.getSharedPreferences("native-call-state",0).edit().putBoolean("declined:"+id,true).commit();CommunicationNotifications.finishCall(c,id,2);if(action.equals("end"))CallAudioService.endFromNotification(c);MobileSyncJob.action(c,id,action);}
}
