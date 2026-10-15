package com.dispatchpro.driver;
import android.webkit.WebMessagePort;
/** Customer flavor extension; Driver flavor has no Firebase dependency. */
public interface CustomerPushHook {
    void ready(WebMessagePort port);
    boolean message(String value);
    void refresh();
}
