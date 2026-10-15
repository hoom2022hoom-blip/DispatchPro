package com.dispatchpro.driver;
/** A manual assignment without a deadline stays until server state closes it. */
public final class DriverOfferPolicy {
 private DriverOfferPolicy(){}
 public static long notificationLifetime(String status,boolean hasExpiry,long expiresAt,long serverNow){
  if(!"Assigned".equals(status))return 0;
  // Existing OFFICE_MANUAL assignments may legitimately have no offer deadline.
  if(!hasExpiry)return -1;
  if(expiresAt<=serverNow)return 0;
  return expiresAt-serverNow;
 }
}
