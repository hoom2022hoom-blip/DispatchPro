import com.dispatchpro.driver.ApiPolicy;
public final class ApiPolicyTest {
    private static void check(boolean value){if(!value)throw new AssertionError();}
    public static void main(String[] args){
        check(ApiPolicy.origin("https://example.com/").equals("https://example.com"));
        check(ApiPolicy.endpoint("https://example.com/", "auth/login").equals("https://example.com/api/v1/auth/login"));
        check(ApiPolicy.endpoint("https://example.com", "driver/me").equals("https://example.com/api/v1/driver/me"));
        check(ApiPolicy.endpoint("https://api.nablustaxi.com", "https://office.nablustaxi.com", "auth/login").equals("https://office.nablustaxi.com/api/reception/auth/login"));
        check(ApiPolicy.endpoint("https://api.nablustaxi.com", "https://office.nablustaxi.com", "driver/updates?cursor=A10").equals("https://api.nablustaxi.com/api/v1/driver/updates?cursor=A10"));
        check(ApiPolicy.upgradeOrigin("https://old.trycloudflare.com","https://api.nablustaxi.com").equals("https://api.nablustaxi.com"));
        check(ApiPolicy.upgradeOrigin("https://custom.example.com","https://api.nablustaxi.com").equals("https://custom.example.com"));
        for(String url:new String[]{"http://example.com","https://user:pass@example.com","https://example.com/api","https://example.com?token=secret","file:///secret"}){
            boolean rejected=false;try{ApiPolicy.origin(url);}catch(IllegalArgumentException expected){rejected=true;}check(rejected);
        }
        check(ApiPolicy.allowed("POST","auth/login"));check(ApiPolicy.allowed("GET","driver/updates?cursor=A10"));
        check(ApiPolicy.allowed("PUT","driver/availability"));check(ApiPolicy.allowed("PUT","driver/location"));check(ApiPolicy.allowed("GET","driver/history?page=2"));
        check(ApiPolicy.allowed("PUT","rides/11111111-1111-1111-1111-111111111111/status"));
        check(ApiPolicy.allowed("GET","driver/earnings?page=2"));check(ApiPolicy.allowed("GET","driver/places"));
        check(ApiPolicy.allowed("GET","driver/earnings?page=2&period=week"));check(ApiPolicy.allowed("GET","driver/earnings?page=1&period=month"));
        check(!ApiPolicy.allowed("GET","driver/earnings?page=1&period=all"));
        check(ApiPolicy.allowed("POST","driver/street-rides"));
        check(ApiPolicy.allowed("PUT","rides/11111111-1111-1111-1111-111111111111/fare"));
        check(ApiPolicy.allowed("PUT","rides/11111111-1111-1111-1111-111111111111/locations"));
        check(!ApiPolicy.allowed("POST","driver/earnings?page=1"));check(!ApiPolicy.allowed("GET","driver/earnings?page=1&url=https://evil.test"));
        check(ApiPolicy.allowed("PUT","driver/rides/11111111-1111-1111-1111-111111111111/reject"));
        check(!ApiPolicy.allowed("GET","users"));check(!ApiPolicy.allowed("GET","driver/../users"));
        check(ApiPolicy.allowed("POST","auth/radio-login"));
        check(ApiPolicy.allowed("POST","auth/radio-refresh"));
        check(ApiPolicy.allowed("GET","radio/me"));
        check(ApiPolicy.allowed("PUT","radio/location"));
        check(ApiPolicy.endpoint("https://api.test","https://office.test","auth/radio-login").equals("https://office.test/api/reception/auth/radio-login"));
        check(ApiPolicy.endpoint("https://api.test","https://office.test","auth/radio-refresh").equals("https://api.test/api/v1/auth/refresh"));
        check(!ApiPolicy.allowed("DELETE","driver/me"));check(!ApiPolicy.allowed("GET","driver/history?page=1&url=https://evil.test"));
        System.out.println("PASS: HTTPS origins, all driver actions, rejection of arbitrary native requests");
    }
}
