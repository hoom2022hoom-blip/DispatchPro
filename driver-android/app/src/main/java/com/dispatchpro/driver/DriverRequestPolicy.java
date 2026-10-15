package com.dispatchpro.driver;
public final class DriverRequestPolicy {
    private DriverRequestPolicy(){}
    public static boolean longPoll(String method,String path){
        String route=path.split("\\?",2)[0];
        return "GET".equals(method)&&(route.equals("driver/updates")||route.equals("driver/mobile/updates")||route.equals("voice/updates")||route.endsWith("/chat")&&path.contains("wait=true"));
    }
}
