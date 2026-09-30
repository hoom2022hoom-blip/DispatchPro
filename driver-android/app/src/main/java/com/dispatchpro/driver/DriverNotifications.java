package com.dispatchpro.driver;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.Build;

/** Local foreground notifications only. A future FCM service can call show after recipient checks. */
public final class DriverNotifications {
    public static final String CHANNEL = "driver_rides";
    private DriverNotifications() {}
    public static void configure(Context context) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "طلبات السائق", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("تنبيهات الطلبات أثناء فتح التطبيق — لا يوجد Push خارجي");
            context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }
    public static boolean permitted(Context context) {
        return (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
                && context.getSystemService(NotificationManager.class).areNotificationsEnabled();
    }
    public static void show(Context context, String title, String body) {
        if (!permitted(context)) return;
        Intent open = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent intent = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(context, CHANNEL) : new Notification.Builder(context);
        builder.setSmallIcon(R.drawable.ic_driver).setContentTitle(title).setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body)).setContentIntent(intent).setAutoCancel(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE).setCategory(Notification.CATEGORY_EVENT);
        if (Build.VERSION.SDK_INT < 26) builder.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
        context.getSystemService(NotificationManager.class).notify("driver-event", (title + body).hashCode(), builder.build());
    }
}
