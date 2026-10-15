package com.dispatchpro.driver;
public final class CustomerOriginPolicyTest {
    public static void main(String[] args) {
        String production = "https://office.nablustaxi.com";
        if (!CustomerOriginPolicy.origin(production,true,true).equals("http://localhost:19105")) throw new AssertionError("debug target");
        for (boolean optedIn : new boolean[]{true,false})
            if (!CustomerOriginPolicy.origin(production,false,optedIn).equals(production)) throw new AssertionError("release must ignore opt-in");
        if (!CustomerOriginPolicy.origin(production,true,false).equals(production)) throw new AssertionError("normal debug HTTPS");
        try { CustomerOriginPolicy.origin("http://192.168.1.8:19105",false,true); throw new AssertionError("release insecure origin"); }
        catch (IllegalArgumentException expected) {}
        System.out.println("CustomerOriginPolicy: debug opt-in, release and HTTPS guards PASS");
    }
}
