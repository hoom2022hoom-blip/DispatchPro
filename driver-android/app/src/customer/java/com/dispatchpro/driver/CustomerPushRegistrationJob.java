package com.dispatchpro.driver;
import android.app.job.*;
import android.content.*;
import com.google.firebase.messaging.FirebaseMessaging;
import org.json.JSONObject;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;

/** One-shot token rotation retry, scheduled by FCM; no background polling. */
public final class CustomerPushRegistrationJob extends JobService {
    private static final int JOB=2306;
    public static void schedule(Context context){
        if(!context.getSharedPreferences("customer-push",MODE_PRIVATE).getBoolean("wanted",false))return;
        context.getSystemService(JobScheduler.class).schedule(new JobInfo.Builder(JOB,new ComponentName(context,CustomerPushRegistrationJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setBackoffCriteria(30000,JobInfo.BACKOFF_POLICY_EXPONENTIAL).build());
    }
    public static void cancel(Context context){context.getSystemService(JobScheduler.class).cancel(JOB);}
    @Override public boolean onStartJob(JobParameters params){
        FirebaseMessaging.getInstance().getToken().addOnSuccessListener(token->{
            java.util.concurrent.ExecutorService executor=Executors.newSingleThreadExecutor();
            executor.execute(()->{boolean retry=true;try{retry=!register(token);}catch(Exception ignored){}finally{jobFinished(params,retry);executor.shutdown();}});
        }).addOnFailureListener(error->jobFinished(params,true));return true;
    }
    private boolean register(String token)throws Exception{
        android.content.SharedPreferences store=getSharedPreferences("customer-push",MODE_PRIVATE);
        if(!store.getBoolean("wanted",false))return true;
        String origin=CustomerOriginPolicy.origin(BuildConfig.DEFAULT_WEB_URL,BuildConfig.DEBUG,BuildConfig.CUSTOMER_LOCAL_DEBUG);
        String saved=CustomerSecureSession.load(this,origin+(BuildConfig.DEBUG?"#customer-debug":""));if(saved.isEmpty())return true;
        JSONObject device=new JSONObject(saved);
        JSONObject auth=new JSONObject().put("tenant",device.optString("tenant")).put("username","customer-"+device.getString("accountId").replace("-","")).put("password",device.getString("deviceSecret"));
        JSONObject login=post(origin+"/api/customer/login",auth,"");
        String bearer=login.getString("accessToken");
        if(!store.getBoolean("wanted",false))return true;
        JSONObject input=new JSONObject().put("installationId",store.getString("installation","")).put("token",token);
        post(origin+"/api/customer/push-device",input,bearer);
        return true;
    }
    private JSONObject post(String url,JSONObject body,String bearer)throws Exception{
        HttpURLConnection connection=(HttpURLConnection)new URL(url).openConnection();
        try{connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(5000);connection.setReadTimeout(5000);connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");if(!bearer.isEmpty())connection.setRequestProperty("Authorization","Bearer "+bearer);
            try(java.io.OutputStream output=connection.getOutputStream()){output.write(body.toString().getBytes(StandardCharsets.UTF_8));}
            int status=connection.getResponseCode();if(status<200||status>=300)throw new java.io.IOException("Registration unavailable");if(status==204)return new JSONObject();
            try(java.io.InputStream stream=connection.getInputStream()){java.io.ByteArrayOutputStream data=new java.io.ByteArrayOutputStream();byte[] buffer=new byte[1024];int count;while((count=stream.read(buffer))!=-1){if(data.size()+count>16384)throw new java.io.IOException("Invalid response");data.write(buffer,0,count);}return new JSONObject(data.toString("UTF-8"));}
        }finally{connection.disconnect();}
    }
    @Override public boolean onStopJob(JobParameters params){return true;}
}
