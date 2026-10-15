package com.dispatchpro.driver;

/** One fixed ADB loopback target; release always uses the existing HTTPS origin. */
public final class CustomerOriginPolicy {
    private CustomerOriginPolicy() {}
    public static String origin(String productionOrigin, boolean debugBuild, boolean localOptIn) {
        return debugBuild && localOptIn ? "http://localhost:19105" : ApiPolicy.origin(productionOrigin);
    }
}
