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

/** Only the existing customer device credential is persisted. The Android Keystore key never leaves the device. */
final class CustomerSecureSession {
    private static final String ALIAS="dispatchpro.customer.device.v1";
    private static SecretKey key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(store.containsAlias(ALIAS))return (SecretKey)store.getKey(ALIAS,null);
        KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
    static synchronized String load(Context context,String origin) throws Exception {
        String value=context.getSharedPreferences(ALIAS,Context.MODE_PRIVATE).getString(origin,"");
        if(value.isEmpty())return "";
        try {String[] parts=value.split(":",2);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));cipher.updateAAD(origin.getBytes(StandardCharsets.UTF_8));return new String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);}
        catch(Exception invalid){context.getSharedPreferences(ALIAS,Context.MODE_PRIVATE).edit().remove(origin).commit();return "";}
    }
    static synchronized void save(Context context,String origin,String value) throws Exception {
        if(value.length()>16384)throw new IllegalArgumentException("Session too large");
        android.content.SharedPreferences.Editor editor=context.getSharedPreferences(ALIAS,Context.MODE_PRIVATE).edit();
        if(value.isEmpty()){if(!editor.remove(origin).commit())throw new java.io.IOException("Session removal failed");return;}
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());cipher.updateAAD(origin.getBytes(StandardCharsets.UTF_8));
        String encrypted=Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);
        if(!editor.putString(origin,encrypted).commit())throw new java.io.IOException("Session persistence failed");
    }
}

