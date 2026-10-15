package com.dispatchpro.driver;
import android.content.Context;
import android.app.Application;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;
@RunWith(RobolectricTestRunner.class) @Config(sdk=33)
public class DriverQaIsolationTest {
 @Test public void qaOriginCannotBeReplacedByOperationalPreferences(){Context c=RuntimeEnvironment.getApplication();assertTrue(BuildConfig.DRIVER_QA);assertEquals("com.dispatchpro.driver.qa",c.getPackageName());c.getSharedPreferences("MainActivity",0).edit().putString("apiOrigin","https://api.nablustaxi.com").commit();assertEquals(BuildConfig.DEFAULT_API_URL,DriverConfig.origin(c));assertFalse(DriverConfig.origin(c).contains("nablustaxi.com"));}
 @Test public void externalPttOwnershipBroadcastsOnlyToQa(){Application c=RuntimeEnvironment.getApplication();ExternalPttOwner.select(c,"driver");assertEquals("com.dispatchpro.driver.qa.permission.EXTERNAL_PTT_OWNER",ExternalPttOwner.PERMISSION);var intents=Shadows.shadowOf(c).getBroadcastIntents();assertFalse(intents.isEmpty());for(var i:intents)if(ExternalPttOwner.ACTION.equals(i.getAction()))assertEquals("com.dispatchpro.driver.qa",i.getComponent().getPackageName());}
 @Test public void operationalFirebaseIsNotInitialized(){assertTrue(com.google.firebase.FirebaseApp.getApps(RuntimeEnvironment.getApplication()).isEmpty());assertEquals("",BuildConfig.DRIVER_FIREBASE_APP_ID);assertEquals("",BuildConfig.DRIVER_FIREBASE_SENDER_ID);}
}
