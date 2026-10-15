package com.dispatchpro.driver;
/** Preserve ten-second active-trip fixes; reduce idle Online fixes to thirty seconds. */
public final class DriverGpsDutyPolicy {public static long interval(boolean activeTrip){return activeTrip?10000:30000;}}
