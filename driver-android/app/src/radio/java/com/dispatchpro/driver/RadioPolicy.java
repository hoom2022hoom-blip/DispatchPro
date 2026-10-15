package com.dispatchpro.driver;

/** Pure rules; GPS readiness and upload acknowledgement are intentionally separate. */
public final class RadioPolicy {
 public static boolean operational(boolean authenticated,boolean locationEnabled,boolean precise,boolean officeGps){return authenticated;}
 public static String tracking(boolean operational,boolean uploadFailed,long now,long acknowledgedFix){if(!operational||uploadFailed)return "red";return acknowledgedFix>0&&now>=acknowledgedFix&&now-acknowledgedFix<=90000?"green":"yellow";}
 public static boolean allowedKey(int key){return key>0&&key!=3&&key!=4&&key!=5&&key!=6&&key!=24&&key!=25&&key!=164&&key!=26&&key!=82&&key!=187&&key!=223&&key!=224&&key!=219;}
 public static boolean mediaKey(int key){return key==79||key==85||key==87||key==88||key==89||key==90||key==126||key==127||key==86;}
 public static final class Hold {
  private boolean down;private int device;
  public boolean press(int id,int repeat){if(down||repeat!=0)return false;down=true;device=id;return true;}
  public boolean release(){boolean was=down;down=false;return was;}
  public boolean removed(int id){return down&&id==device&&release();}
  public boolean pressed(){return down;}
  public boolean matches(int id){return down&&device==id;}
 }
}
