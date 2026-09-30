package com.dispatchpro.driver;

import java.net.URI;

/** Shared by the native bridge and its JVM tests. No arbitrary URL/header forwarding. */
public final class ApiPolicy {
    private ApiPolicy() {}
    public static String origin(String value) {
        URI uri = URI.create(value.trim());
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getRawUserInfo() != null
                || uri.getRawQuery() != null || uri.getRawFragment() != null
                || !(uri.getPath().isEmpty() || uri.getPath().equals("/"))) throw new IllegalArgumentException("HTTPS API origin required");
        return "https://" + uri.getHost().toLowerCase(java.util.Locale.ROOT) + (uri.getPort() == -1 ? "" : ":" + uri.getPort());
    }
    public static boolean allowed(String method, String path) {
        if (path == null || path.length() > 512) return false;
        if ("POST".equals(method)) return path.equals("auth/login");
        if ("GET".equals(method)) return path.equals("driver/me")
            || path.matches("driver/updates\\?cursor=[A-Za-z0-9%_-]*")
            || path.matches("driver/history\\?page=[0-9]{1,5}")
            || path.matches("driver/rides/[a-fA-F0-9-]{36}");
        return "PUT".equals(method) && (path.equals("driver/availability") || path.equals("driver/location")
            || path.matches("driver/rides/[a-fA-F0-9-]{36}/reject")
            || path.matches("rides/[a-fA-F0-9-]{36}/status"));
    }
}
