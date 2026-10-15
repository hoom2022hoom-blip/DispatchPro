package com.dispatchpro.driver;

public final class DriverLocationClockTest {
    private static final long SERVER = 1791540000000L;
    private static int checks;
    private static void equal(long actual, long expected, String message) {
        checks++; if (actual != expected) throw new AssertionError(message + ": " + actual + " != " + expected);
    }
    private static void yes(boolean actual, String message) {
        checks++; if (!actual) throw new AssertionError(message);
    }
    public static void main(String[] args) {
        for (long skew : new long[]{300000, -300000}) {
            DriverLocationClock clock = new DriverLocationClock();
            equal(clock.capturedAt(SERVER + skew - 5000, 95000, 100000), SERVER + skew - 5000, "Uncalibrated real fix");
            yes(clock.observeRejection(skew > 0 ? "FUTURE_LOCATION" : "STALE_LOCATION", SERVER + 500,
                    100000, 101000, 95000), "Fresh fix permits clock correction");
            equal(clock.capturedAt(SERVER + skew - 5000, 95000, 101000), SERVER - 5000, "Retry preserves 6 second age");
            equal(clock.capturedAt(SERVER + 900000, 130000, 132000), SERVER + 30000, "Later wall clock jump ignored");
            equal(clock.capturedAt(SERVER + skew, 95000, 155001), 0, "Queued stale fix blocked after calibration");
        }
        DriverLocationClock clock = new DriverLocationClock();
        equal(clock.capturedAt(SERVER, 1000, 61001), 0, "Queued stale fix blocked before calibration");
        equal(clock.capturedAt(SERVER, 1001, 1000), 0, "Future monotonic fix blocked");
        yes(!clock.observeRejection("STALE_LOCATION", SERVER, 61000, 61001, 1000), "Rejection cannot rejuvenate stale GPS");
        yes(!clock.observeRejection("FUTURE_LOCATION", SERVER, 100000, 110001, 100000), "Slow response cannot calibrate");
        yes(!clock.observeRejection("POOR_ACCURACY", SERVER, 100000, 100001, 100000), "Accuracy rejection not retried");
        yes(!clock.observeRejection("FUTURE_LOCATION", 0, 100000, 100001, 100000), "Missing server time rejected");
        yes(!clock.observeRejection("FUTURE_LOCATION", SERVER, 100001, 100000, 95000), "Reversed clock rejected");
        equal(clock.capturedAt(SERVER + 300000, 100000, 100001), SERVER + 300000, "Invalid calibration leaves clock intact");
        yes(clock.observeRejection("FUTURE_LOCATION", SERVER + 5000, 100000, 110000, 100000), "Bounded 10 second response accepted");
        equal(clock.capturedAt(SERVER + 300000, 100000, 110000), SERVER, "Ten second old fix remains ten seconds old");
        equal(new DriverLocationClock().capturedAt(SERVER + 300000, 100000, 100001), SERVER + 300000, "New origin does not inherit another server clock");
        System.out.println("Native GPS clock: " + checks + " assertions passed");
    }
}
