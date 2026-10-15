import com.dispatchpro.driver.PermissionPlan;
public class PermissionPlanTest {
 static void equal(String a,String b){if(!a.equals(b))throw new AssertionError(a+" != "+b);}
 public static void main(String[] args){equal("notifications",PermissionPlan.next(33,false,false,false,false,false,false));equal("location",PermissionPlan.next(33,false,false,false,true,false,false));equal("microphone",PermissionPlan.next(33,false,false,false,true,true,false));equal("done",PermissionPlan.next(33,false,false,false,true,true,true));equal("location",PermissionPlan.next(32,false,false,false,false,false,false));equal("done",PermissionPlan.next(36,true,true,true,false,false,false));if(!PermissionPlan.backgroundSettings(30)||PermissionPlan.backgroundSettings(29))throw new AssertionError("Background must request separately");System.out.println("PASS: ordered permission requests, denial progression, no repeat loop, Android 29/30 separation");}
}
