package com.dispatchpro.driver;
import android.app.Application;
import com.google.firebase.FirebaseApp;
public final class DriverApplication extends Application{
 @Override public void onCreate(){super.onCreate();if(!BuildConfig.DRIVER_QA)FirebaseApp.initializeApp(this);CommunicationNotifications.configure(this);DriverNotifications.configure(this);}
}
