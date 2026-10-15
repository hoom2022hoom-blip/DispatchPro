package com.dispatchpro.driver;
import android.app.Activity;
import android.graphics.Color;
import android.view.Gravity;
import android.widget.*;
final class WebViewRecovery {
 static void show(Activity host) {
  LinearLayout panel=new LinearLayout(host);panel.setOrientation(LinearLayout.VERTICAL);panel.setGravity(Gravity.CENTER);panel.setPadding(32,32,32,32);panel.setBackgroundColor(Color.WHITE);
  TextView message=new TextView(host);message.setText("تعذر عرض التطبيق\nحالة الرحلة محفوظة لدى المكتب. أعد فتح الواجهة للمتابعة.");message.setTextSize(18);message.setGravity(Gravity.CENTER);message.setTextColor(Color.rgb(23,32,51));panel.addView(message,new LinearLayout.LayoutParams(-1,-2));
  Button retry=new Button(host);retry.setText("إعادة فتح التطبيق");retry.setOnClickListener(v->host.recreate());panel.addView(retry,new LinearLayout.LayoutParams(-1,-2));host.setContentView(panel);
 }
}
