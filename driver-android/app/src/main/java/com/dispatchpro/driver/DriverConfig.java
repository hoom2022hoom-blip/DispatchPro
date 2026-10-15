package com.dispatchpro.driver;
import android.content.Context;
final class DriverConfig {
 static String origin(Context context){return BuildConfig.DRIVER_QA?BuildConfig.DEFAULT_API_URL:ApiPolicy.upgradeOrigin(context.getSharedPreferences("MainActivity",0).getString("apiOrigin",BuildConfig.DEFAULT_API_URL),BuildConfig.DEFAULT_API_URL);}
}
