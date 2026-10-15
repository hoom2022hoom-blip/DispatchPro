import com.dispatchpro.driver.DriverOfferPolicy;
public final class DriverOfferPolicyTest {
 private static void check(long actual,long expected){if(actual!=expected)throw new AssertionError(actual+" != "+expected);}
 public static void main(String[] args){
  check(DriverOfferPolicy.notificationLifetime("Assigned",true,145000,100000),45000);
  check(DriverOfferPolicy.notificationLifetime("Assigned",true,99999,100000),0);
  check(DriverOfferPolicy.notificationLifetime("Assigned",true,100000,100000),0);
  check(DriverOfferPolicy.notificationLifetime("Assigned",true,0,100000),0);
  check(DriverOfferPolicy.notificationLifetime("Assigned",false,0,100000),-1);
  check(DriverOfferPolicy.notificationLifetime("Accepted",false,0,100000),0);
  check(DriverOfferPolicy.notificationLifetime("Cancelled",true,145000,100000),0);
  check(DriverOfferPolicy.notificationLifetime("Assigned",true,1000000,100000),900000);
  System.out.println("PASS: native offer deadlines, malformed/expired suppression, bounded lifetime, manual assignments retained");
 }
}
