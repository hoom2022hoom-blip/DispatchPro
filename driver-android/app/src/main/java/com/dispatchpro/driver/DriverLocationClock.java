package com.dispatchpro.driver;

/** Keep a real GPS fix's monotonic age when the device wall clock is incorrect. */
final class DriverLocationClock {
    private long serverAtAnchor, elapsedAtAnchor;

    private static boolean fresh(long fixElapsed, long nowElapsed) {
        return fixElapsed >= 0 && nowElapsed >= fixElapsed && nowElapsed - fixElapsed <= 60000;
    }

    long capturedAt(long fixWallTime, long fixElapsed, long nowElapsed) {
        if (!fresh(fixElapsed, nowElapsed)) return 0;
        return serverAtAnchor == 0 ? fixWallTime : serverAtAnchor + fixElapsed - elapsedAtAnchor;
    }

    boolean observeRejection(String reason, long serverTime, long sentElapsed,
                             long receivedElapsed, long fixElapsed) {
        if (!("FUTURE_LOCATION".equals(reason) || "STALE_LOCATION".equals(reason))
                || serverTime <= 0 || sentElapsed < 0 || receivedElapsed < sentElapsed
                || receivedElapsed - sentElapsed > 10000 || !fresh(fixElapsed, receivedElapsed)) return false;
        // The server generated its timestamp between request and response. Midpoint
        // limits clock uncertainty to half the RTT without making an old fix new.
        serverAtAnchor = serverTime;
        elapsedAtAnchor = sentElapsed + (receivedElapsed - sentElapsed) / 2;
        return true;
    }
}
