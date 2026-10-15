import com.dispatchpro.driver.PushDisplayPolicy;
import com.dispatchpro.driver.PushEnvelopePolicy;
import java.util.*;
public final class PushDisplayPolicyTest {
 static void expect(boolean ok){if(!ok)throw new AssertionError("Bound push display policy");}
 public static void main(String[] args){
  long now=1000000;Map<String,String> data=new HashMap<>();
  data.put("displayVersion","1");data.put("installationId","phone");data.put("recipient","customer");data.put("eventId","11111111-1111-1111-1111-111111111111");data.put("rideId","22222222-2222-2222-2222-222222222222");data.put("type","ARRIVED");data.put("createdAt",Long.toString(now-1000));data.put("expiresAt",Long.toString(now+40000));data.put("revision","1");
  expect(PushEnvelopePolicy.accepts(data,true,"phone","customer",false)&&PushDisplayPolicy.visible(data,now));
  expect(!PushEnvelopePolicy.accepts(data,true,"phone","other-customer",false));expect(!PushEnvelopePolicy.accepts(data,false,"phone","customer",false));
  data.put("type","CALL");expect(PushDisplayPolicy.visible(data,now));data.put("expiresAt",Long.toString(now-1));expect(!PushDisplayPolicy.visible(data,now));
  data.put("type","CALL_END");expect(!PushDisplayPolicy.visible(data,now));data.put("revision","2");expect(PushDisplayPolicy.visible(data,now));
  data.put("type","ARRIVED");data.put("expiresAt",Long.toString(now+40000));data.put("createdAt",Long.toString(now-600001));expect(!PushDisplayPolicy.visible(data,now));
  data.put("createdAt",Long.toString(now));data.put("rideId","------------------------------------");expect(!PushDisplayPolicy.visible(data,now));
  expect("أحمد".equals(PushDisplayPolicy.name("\nأحمد\u202e")));expect(PushDisplayPolicy.name("a".repeat(150)).length()==80);
  expect(PushDisplayPolicy.missedEligible(true,true,false,true)); // CALL_END beat the alarm, server confirms no answer.
  expect(!PushDisplayPolicy.missedEligible(true,true,false,false)); // A late alarm must not relabel an ended call.
  expect(!PushDisplayPolicy.missedEligible(true,true,true,true)); // Local decline stays declined even if its request failed.
  expect(!PushDisplayPolicy.missedEligible(false,false,false,true)); // Logout suppresses delayed notifications.
  System.out.println("PushDisplayPolicy: PASS (binding, expiry, revisions, stale/invalid payloads, name sanitization, missed-call races)");
 }
}
