package com.dispatchpro.driver;
/** Pure request ordering: background access is always separate from foreground. */
public final class PermissionPlan {
 public static String next(int sdk,boolean notifications,boolean location,boolean microphone,boolean askedNotifications,boolean askedLocation,boolean askedMicrophone){if(sdk>=33&&!notifications&&!askedNotifications)return "notifications";if(!location&&!askedLocation)return "location";if(!microphone&&!askedMicrophone)return "microphone";return "done";}
 public static boolean backgroundSettings(int sdk){return sdk>=30;}
}
