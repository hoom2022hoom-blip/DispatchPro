package com.maktab.calls

import android.content.Context
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** One-time QR exchange; permanent credential is encrypted with a non-exportable Keystore key. */
internal object DevicePairingManager {
    private const val ALIAS = "officecalls3-device"
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    private fun prefs(context: Context) = context.getSharedPreferences("officecalls3_credentials", Context.MODE_PRIVATE)
    fun token(context: Context): String = runCatching {
        val value = prefs(context).getString("credential", "").orEmpty().split(':')
        if (value.size != 2) return@runCatching ""
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(value[0], Base64.NO_WRAP)))
        String(cipher.doFinal(Base64.decode(value[1], Base64.NO_WRAP)), Charsets.UTF_8)
    }.getOrDefault("")
    fun office(context: Context) = prefs(context).getString("office", "").orEmpty()
    private fun signingKey(): java.security.KeyPair {
        val store=KeyStore.getInstance("AndroidKeyStore").apply {load(null)}
        val signingAlias="officecalls3-signing"
        val existing=store.getKey(signingAlias,null)
        if(existing!=null) return java.security.KeyPair(store.getCertificate(signingAlias).publicKey,existing as java.security.PrivateKey)
        return java.security.KeyPairGenerator.getInstance("RSA","AndroidKeyStore").apply {
            initialize(KeyGenParameterSpec.Builder(signingAlias,KeyProperties.PURPOSE_SIGN).setKeySize(2048)
                .setDigests(KeyProperties.DIGEST_SHA256).setSignaturePaddings(KeyProperties.SIGNATURE_PADDING_RSA_PKCS1).build())
        }.generateKeyPair()
    }
    fun signed(context: Context, payload: JSONObject): JSONObject {
        val bytes=payload.toString().toByteArray(Charsets.UTF_8)
        val signer=java.security.Signature.getInstance("SHA256withRSA").apply {initSign(signingKey().private);update(bytes)}
        return JSONObject().put("deviceId",prefs(context).getString("device","")).put("payload",String(bytes,Charsets.UTF_8)).put("signature",Base64.encodeToString(signer.sign(),Base64.NO_WRAP))
    }
    fun complete(context: Context, qr: String) {
        val uri = Uri.parse(qr.trim())
        require(uri.scheme == "officecalls" && uri.host == "pair") { "رمز الربط غير صالح" }
        val session = uri.getQueryParameter("sessionId").orEmpty()
        val secret = uri.getQueryParameter("secret").orEmpty()
        require(runCatching { java.util.UUID.fromString(session) }.isSuccess && Regex("[A-Fa-f0-9]{64}").matches(secret)) { "رمز الربط ناقص" }
        val result = OfficeHttpsTransport.request("/pair/complete", "", JSONObject().put("sessionId", session).put("secret", secret).put("name", "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}").put("publicKey",Base64.encodeToString(signingKey().public.encoded,Base64.NO_WRAP)))
        val token = result.getString("token")
        require(Regex("oc3_[A-F0-9]{64}").matches(token))
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val encrypted = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        check(prefs(context).edit().putString("credential", Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .putString("office", result.getString("officeId")).putString("device", result.getString("deviceId")).commit())
        CallStore.get(context).setState("pairing_state", "بانتظار تأكيد مدير المكتب")
        CallStore.get(context).setState("server_health_time", "")
        CallStore.get(context).setState("queue_owner_office", result.getString("officeId"))
        CallStore.get(context).setState("local_authorization_until", "")
    }
    fun unlink(context: Context) {
        // Local unpair stops sending. Remote revocation belongs to authenticated office administration.
        prefs(context).edit().clear().commit()
        CallStore.get(context).setState("pairing_state", "غير مربوط؛ ألغِ الجهاز أيضاً من لوحة المكتب")
        CallStore.get(context).setState("server_health_time", "")
        CallStore.get(context).setState("local_authorization_until", "")
    }
}
