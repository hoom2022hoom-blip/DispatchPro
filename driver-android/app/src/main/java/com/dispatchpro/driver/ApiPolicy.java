package com.dispatchpro.driver;

import java.net.URI;

/** Shared by the native bridge and its JVM tests. No arbitrary URL/header forwarding. */
public final class ApiPolicy {
    private ApiPolicy() {}
    public static String endpoint(String value, String path) {
        return origin(value) + "/api/v1/" + path;
    }
    public static String endpoint(String apiOrigin, String officeOrigin, String path) {
        // The existing Office proxy binds login to this edition's tenant on the server.
        return ("auth/login".equals(path)||"auth/driver-login".equals(path)||"auth/radio-login".equals(path)) ? origin(officeOrigin) + "/api/reception/"+path : endpoint(apiOrigin, path.matches("auth/(driver|radio)-refresh")?"auth/refresh":path.matches("auth/(driver|radio)-logout")?"auth/logout":path);
    }
    public static String upgradeOrigin(String value, String fallback) {
        String current = origin(value);
        return URI.create(current).getHost().endsWith(".trycloudflare.com") ? origin(fallback) : current;
    }
    public static String origin(String value) {
        URI uri = URI.create(value.trim());
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getRawUserInfo() != null
                || uri.getRawQuery() != null || uri.getRawFragment() != null
                || !(uri.getPath().isEmpty() || uri.getPath().equals("/"))) throw new IllegalArgumentException("HTTPS API origin required");
        return "https://" + uri.getHost().toLowerCase(java.util.Locale.ROOT) + (uri.getPort() == -1 ? "" : ":" + uri.getPort());
    }
    public static boolean allowed(String method, String path) {
        if (path == null || path.length() > 512) return false;
        if("GET".equals(method)&&path.matches("driver/mobile/updates\\?deviceId=[a-fA-F0-9-]{36}(&cursor=[A-Fa-f0-9]*)?"))return true;
        if("POST".equals(method)&&(path.equals("driver/mobile/chat-read")||path.equals("driver/calls")||path.matches("driver/calls/[a-fA-F0-9-]{36}/(answer|reject|end|heartbeat|signal)")))return true;
        if("GET".equals(method)&&path.matches("driver/calls/[a-fA-F0-9-]{36}\\?deviceId=[a-fA-F0-9-]{36}"))return true;
        if (("GET".equals(method)||"POST".equals(method)) && path.matches("driver/rides/[a-fA-F0-9-]{36}/chat(\\?(before=[a-fA-F0-9-]{36}|after=[a-fA-F0-9-]{36}&wait=true))?")) return true;
        if ("POST".equals(method)) return path.equals("auth/login") || path.matches("auth/(driver|radio)-(login|refresh|logout)") || path.matches("driver/push-device(/remove)?") || path.equals("driver/street-rides") || path.matches("voice/(session|floor|release|heartbeat|signal)");
        if ("GET".equals(method)) return path.equals("driver/me") || path.equals("radio/me")
            || path.matches("voice/updates\\?sessionId=[a-fA-F0-9-]{36}(&revision=[0-9]{1,19})?")
            || path.matches("driver/updates\\?cursor=[A-Za-z0-9%_-]*")
            || path.matches("driver/history\\?page=[0-9]{1,5}")
            || path.matches("driver/earnings\\?page=[0-9]{1,5}(&period=(today|week|month))?") || path.equals("driver/places")
            || path.matches("driver/rides/[a-fA-F0-9-]{36}");
        return "PUT".equals(method) && (path.equals("driver/availability") || path.equals("driver/location") || path.equals("radio/location")
            || path.matches("driver/rides/[a-fA-F0-9-]{36}/reject")
            || path.matches("rides/[a-fA-F0-9-]{36}/(status|fare|locations)"));
    }
}
