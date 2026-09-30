import com.dispatchpro.driver.ApiPolicy;
public final class ApiPolicyTest {
    private static void check(boolean value){if(!value)throw new AssertionError();}
    public static void main(String[] args){
        check(ApiPolicy.origin("https://example.com/").equals("https://example.com"));
        for(String url:new String[]{"http://example.com","https://user:pass@example.com","https://example.com/api","https://example.com?token=secret","file:///secret"}){
            boolean rejected=false;try{ApiPolicy.origin(url);}catch(IllegalArgumentException expected){rejected=true;}check(rejected);
        }
        check(ApiPolicy.allowed("POST","auth/login"));check(ApiPolicy.allowed("GET","driver/updates?cursor=A10"));
        check(ApiPolicy.allowed("PUT","driver/availability"));check(ApiPolicy.allowed("PUT","driver/location"));check(ApiPolicy.allowed("GET","driver/history?page=2"));
        check(ApiPolicy.allowed("PUT","rides/11111111-1111-1111-1111-111111111111/status"));
        check(ApiPolicy.allowed("PUT","driver/rides/11111111-1111-1111-1111-111111111111/reject"));
        check(!ApiPolicy.allowed("GET","users"));check(!ApiPolicy.allowed("GET","driver/../users"));
        check(!ApiPolicy.allowed("DELETE","driver/me"));check(!ApiPolicy.allowed("GET","driver/history?page=1&url=https://evil.test"));
        System.out.println("PASS: HTTPS origins, all driver actions, rejection of arbitrary native requests");
    }
}
