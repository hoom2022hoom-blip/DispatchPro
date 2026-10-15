package com.dispatchpro.driver;
import android.app.Application;
import com.google.firebase.FirebaseApp;
/** Initializes FCM on cold service starts as well as foreground Activity starts. */
public final class CustomerApplication extends Application {
    @Override public void onCreate(){super.onCreate();
        FirebaseApp.initializeApp(this);CommunicationNotifications.configure(this);CustomerArrivalNotifications.configure(this);CustomerRideNotifications.configure(this);
    }
}
