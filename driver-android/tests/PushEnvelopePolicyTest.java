import com.dispatchpro.driver.PushEnvelopePolicy;
import java.util.*;
public class PushEnvelopePolicyTest {
 static void expect(boolean ok){if(!ok)throw new AssertionError("push envelope policy");}
 public static void main(String[] args){
  Map<String,String> data=new HashMap<>();data.put("installationId","device");data.put("recipient","account");data.put("eventId","11111111-1111-1111-1111-111111111111");
  for(String type:new String[]{"CHAT","CALL","CALL_END"}){data.put("type",type);expect(PushEnvelopePolicy.accepts(data,true,"device","account",true));expect(PushEnvelopePolicy.accepts(data,true,"device","account",false));}
  for(String type:new String[]{"ARRIVED","ARRIVAL_ACK","RIDE_STATUS"}){data.put("type",type);expect(PushEnvelopePolicy.accepts(data,true,"device","account",false));expect(!PushEnvelopePolicy.accepts(data,true,"device","account",true));}
  data.put("type","DRIVER_REQUEST");expect(PushEnvelopePolicy.accepts(data,true,"device","account",true));expect(!PushEnvelopePolicy.accepts(data,true,"device","account",false));expect(!PushEnvelopePolicy.accepts(data,false,"device","account",true));expect(!PushEnvelopePolicy.accepts(data,true,"other","account",true));expect(!PushEnvelopePolicy.accepts(data,true,"device","other",true));expect(!PushEnvelopePolicy.accepts(data,true,"","",true));
  data.put("eventId","------------------------------------");expect(!PushEnvelopePolicy.accepts(data,true,"device","account",true));data.put("eventId","11111111-1111-1111-1111-111111111111");data.put("type","PTT");expect(!PushEnvelopePolicy.accepts(data,true,"device","account",true));System.out.println("PushEnvelopePolicy: PASS (audiences, binding, identity, event IDs, PTT isolation)");
 }
}
