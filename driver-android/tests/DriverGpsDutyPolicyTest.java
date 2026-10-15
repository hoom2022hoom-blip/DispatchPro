import com.dispatchpro.driver.DriverGpsDutyPolicy;
public final class DriverGpsDutyPolicyTest {public static void main(String[] args){if(DriverGpsDutyPolicy.interval(true)!=10000||DriverGpsDutyPolicy.interval(false)!=30000)throw new AssertionError("GPS duty rate");System.out.println("PASS: active GPS policy retained; idle Online uses fewer native fixes");}}
