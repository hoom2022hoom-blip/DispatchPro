package com.dispatchpro.driver;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Only the driver JWT/identity is persisted. The Android Keystore key never leaves the device. */
final class SecureDriverSession {
    private static final String ALIAS="dispatchpro.driver.session.v1";
    private static final java.util.Map<String,String> runtime=new java.util.HashMap<>();
    private static final java.util.Set<String> transientOrigins=new java.util.HashSet<>();
    private static SecretKey key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(store.containsAlias(ALIAS))return (SecretKey)store.getKey(ALIAS,null);
        KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
    static synchronized String load(Context context,String origin) throws Exception {
        if(runtime.containsKey(origin))return runtime.get(origin);
        String value=context.getSharedPreferences(ALIAS,Context.MODE_PRIVATE).getString(origin,"");
        if(value.isEmpty())return "";
        try {String[] parts=value.split(":",2);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));cipher.updateAAD(origin.getBytes(StandardCharsets.UTF_8));return new String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);}
        catch(Exception invalid){context.getSharedPreferences(ALIAS,Context.MODE_PRIVATE).edit().remove(origin).commit();return "";}
    }
    static synchronized void save(Context context,String origin,String value) throws Exception {
        if(value.length()>131072)throw new IllegalArgumentException("Session too large");
        if(transientOrigins.contains(origin)){runtime.put(origin,value);return;}
        android.content.SharedPreferences.Editor editor=context.getSharedPreferences(ALIAS,Context.MODE_PRIVATE).edit();
        if(value.isEmpty()){if(!editor.remove(origin).commit())throw new java.io.IOException("Session removal failed");return;}
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());cipher.updateAAD(origin.getBytes(StandardCharsets.UTF_8));
        String encrypted=Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);
        if(!editor.putString(origin,encrypted).commit())throw new java.io.IOException("Session persistence failed");
    }
    static synchronized void saveFromWeb(Context context,String origin,String value,boolean remember)throws Exception {
        if(value.isEmpty())DriverNativeApi.reset(context,origin);
        if(!value.isEmpty()){
            String current=load(context,origin);
            if(!current.isEmpty()){
                org.json.JSONObject old=new org.json.JSONObject(current),incoming=new org.json.JSONObject(value);
                if(DriverNativeApi.rotated(origin,incoming.optString("refreshToken"))&&old.getJSONObject("profile").optString("id").equals(incoming.getJSONObject("profile").optString("id"))&&old.optString("tenant").equals(incoming.optString("tenant"))){
                    incoming.put("token",old.getString("token"));
                    if(old.has("refreshToken"))incoming.put("refreshToken",old.getString("refreshToken"));
                    value=incoming.toString();
                }
            }
        }
        runtime.remove(origin);transientOrigins.remove(origin);
        if(!remember&&!value.isEmpty()){
            context.getSharedPreferences(ALIAS,Context.MODE_PRIVATE).edit().remove(origin).commit();
            transientOrigins.add(origin);runtime.put(origin,value);
        }else save(context,origin,value);
    }
}
