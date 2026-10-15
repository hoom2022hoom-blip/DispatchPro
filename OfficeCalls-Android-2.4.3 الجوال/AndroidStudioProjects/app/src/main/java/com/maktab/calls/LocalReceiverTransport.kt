package com.maktab.calls

import android.content.Context
import org.json.JSONObject
import java.net.URL
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.*

/** Offline pairing authenticates the receiver certificate and the phone token; no cloud lease. */
internal object LocalReceiverTransport {
    fun enabled(context: Context) = context.getSharedPreferences(NetworkSender.PREFS_NAME,0).getString("delivery_mode","local") != "cloud"
    fun saved(context: Context): Boolean {
        val p=context.getSharedPreferences(NetworkSender.PREFS_NAME,0)
        return validHost(p.getString(NetworkSender.KEY_HOST,"").orEmpty()) && p.getInt(NetworkSender.KEY_PORT,5051) in 1..65535 &&
            p.getString("local_token","").orEmpty().matches(Regex("[a-f0-9]{64}")) && p.getString("local_pin","").orEmpty().matches(Regex("[a-f0-9]{64}"))
    }
    fun useSaved(context: Context) {
        require(saved(context)) {"LOCAL_PAIRING_REQUIRED"}
        context.getSharedPreferences(NetworkSender.PREFS_NAME,0).edit().putString("delivery_mode","local").commit()
        CallStore.get(context).setState("local_health_time","")
        NetworkSender.sendTest(context)
    }
    fun validHost(host: String): Boolean {
        val parts=host.split('.')
        if(parts.size!=4 || parts.any { it.toIntOrNull() !in 0..255 || it != it.toIntOrNull().toString() }) return false
        val a=parts.map(String::toInt)
        return a[0]==10 || (a[0]==192 && a[1]==168) || (a[0]==172 && a[1] in 16..31)
    }
    fun endpoint(context: Context): String {
        val p=context.getSharedPreferences(NetworkSender.PREFS_NAME,0)
        return "https://${p.getString(NetworkSender.KEY_HOST,"")}:${p.getInt(NetworkSender.KEY_PORT,5051)}"
    }
    fun deviceId(context: Context): String {
        val p=context.getSharedPreferences(NetworkSender.PREFS_NAME,0)
        synchronized(this) {
            return p.getString("local_device_id",null) ?: java.util.UUID.randomUUID().toString().also {p.edit().putString("local_device_id",it).commit()}
        }
    }
    fun configure(context: Context, host: String, port: Int, token: String, pin: String) {
        require(validHost(host) && port in 1..65535 && token.matches(Regex("[a-f0-9]{64}")) && pin.matches(Regex("[a-f0-9]{64}"))) {"تحقق من IP المحلي والمنفذ ورمز الاقتران وبصمة الشهادة"}
        context.getSharedPreferences(NetworkSender.PREFS_NAME,0).edit().putString(NetworkSender.KEY_HOST,host).putInt(NetworkSender.KEY_PORT,port)
            .putString("local_token",token).putString("local_pin",pin).putString("delivery_mode","local").commit()
        CallStore.get(context).setState("local_health_time","")
    }
    fun importPairing(context: Context, text: String) {
        val j=JSONObject(text); require(j.getString("type")=="officecalls-local-v1")
        validatePairingWindow(j,System.currentTimeMillis())
        if(j.has("pairId")) request(context,pairing=j)
        configure(context,j.getString("host"),j.getInt("port"),j.getString("token"),j.getString("pin"))
    }
    /** Only an encrypted, authenticated bootstrap envelope is read before the pin is known.
     * No code, credential or event is transmitted on this connection. Its certificate
     * must match the identity authenticated by AES-GCM before settings can be saved. */
    fun pairWithCode(context: Context,host: String,port: Int,code: String) {
        require(validHost(host) && port in 1..65535) {"INVALID_LOCAL_ADDRESS"}
        val normalized=code.replace(Regex("[ -]"),"").uppercase(java.util.Locale.ROOT)
        require(normalized.matches(Regex("[A-F0-9]{16}"))) {"INVALID_PAIRING_CODE"}
        val trust=object:X509TrustManager {
            override fun getAcceptedIssuers()=emptyArray<X509Certificate>()
            override fun checkClientTrusted(chain:Array<X509Certificate>,authType:String)=throw CertificateException("CLIENT_NOT_SUPPORTED")
            override fun checkServerTrusted(chain:Array<X509Certificate>,authType:String) {require(chain.isNotEmpty());chain[0].checkValidity()}
        }
        val tls=SSLContext.getInstance("TLS").apply {init(null,arrayOf(trust),java.security.SecureRandom())}
        val connection=URL("https://$host:$port/pairing/offer").openConnection() as HttpsURLConnection
        try {
            connection.sslSocketFactory=tls.socketFactory;connection.hostnameVerifier=HostnameVerifier {name,_->name==host}
            connection.instanceFollowRedirects=false;connection.connectTimeout=2500;connection.readTimeout=5000
            require(connection.responseCode==200) {"PAIRING_NOT_OPEN"}
            val envelope=JSONObject(String(connection.inputStream.use {it.readBytesLimited(8192)},Charsets.UTF_8))
            val payload=decodeOffer(envelope,normalized)
            require(payload.getString("host")==host && payload.getInt("port")==port) {"PAIRING_ADDRESS_MISMATCH"}
            val cert=connection.serverCertificates.first() as X509Certificate
            val fingerprint=MessageDigest.getInstance("SHA-256").digest(cert.encoded).joinToString("") {"%02x".format(it)}
            require(MessageDigest.isEqual(fingerprint.toByteArray(),payload.getString("pin").toByteArray())) {"RECEIVER_CERTIFICATE_CHANGED"}
            importPairing(context,payload.toString())
        } finally {connection.disconnect()}
    }
    internal fun decodeOffer(envelope:JSONObject,code:String,now:Long=System.currentTimeMillis()):JSONObject {
        require(envelope.getString("type")=="officecalls-pair-v1")
        fun bytes(field:String)=android.util.Base64.decode(envelope.getString(field),android.util.Base64.DEFAULT)
        val salt=bytes("salt");val iv=bytes("iv");val ciphertext=bytes("ciphertext")
        require(salt.size==16 && iv.size==12 && ciphertext.size in 17..4096)
        val spec=javax.crypto.spec.PBEKeySpec(code.toCharArray(),salt,200000,256)
        val key=try {javax.crypto.SecretKeyFactory.getInstance("PBKDF2WithHmacSHA1").generateSecret(spec).encoded}finally{spec.clearPassword()}
        val cipher=javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(javax.crypto.Cipher.DECRYPT_MODE,javax.crypto.spec.SecretKeySpec(key,"AES"),javax.crypto.spec.GCMParameterSpec(128,iv))
        cipher.updateAAD("officecalls-pair-v1".toByteArray(Charsets.UTF_8))
        val payload=JSONObject(String(cipher.doFinal(ciphertext),Charsets.UTF_8))
        validatePairingWindow(payload,now)
        return payload
    }
    internal fun validatePairingWindow(payload:JSONObject,now:Long) {
        if(payload.has("pairId")) {
            require(payload.getString("pairId").matches(Regex("[a-f0-9]{32}"))) {"INVALID_PAIRING_CODE"}
            val issued=payload.getLong("issuedAt");val expires=payload.getLong("expiresAt")
            require(issued>0 && expires>issued && expires-issued<=180000) {"PAIRING_EXPIRED"}
            // The authenticated, certificate-pinned receiver confirms the active window.
            // Phone wall-clock differences must not extend or prematurely expire it.
        } else if(payload.has("expiresAt")) {
            require(payload.getLong("expiresAt")>now && payload.getLong("expiresAt")<=now+300000) {"PAIRING_EXPIRED"}
        }
    }
    fun request(context: Context, payload: JSONObject?=null, pairing:JSONObject?=null): JSONObject {
        val p=context.getSharedPreferences(NetworkSender.PREFS_NAME,0)
        val host=pairing?.getString("host") ?: p.getString(NetworkSender.KEY_HOST,"").orEmpty(); val pin=pairing?.getString("pin") ?: p.getString("local_pin","").orEmpty(); val token=pairing?.getString("token") ?: p.getString("local_token","").orEmpty()
        val port=pairing?.getInt("port") ?: p.getInt(NetworkSender.KEY_PORT,5051)
        require(validHost(host) && port in 1..65535 && pin.matches(Regex("[a-f0-9]{64}")) && token.matches(Regex("[a-f0-9]{64}"))) {"LOCAL_PAIRING_REQUIRED"}
        fun trusted(cert: X509Certificate): Boolean = MessageDigest.getInstance("SHA-256").digest(cert.encoded).joinToString("") {"%02x".format(it)} == pin
        val trust=object:X509TrustManager {
            override fun getAcceptedIssuers()=emptyArray<X509Certificate>()
            override fun checkClientTrusted(chain: Array<X509Certificate>,authType: String) {throw CertificateException("CLIENT_NOT_SUPPORTED")}
            override fun checkServerTrusted(chain: Array<X509Certificate>,authType: String) {
                val cert=chain.firstOrNull() ?: throw CertificateException("EMPTY_CERTIFICATE")
                cert.checkValidity(); if(!trusted(cert)) throw CertificateException("RECEIVER_CERTIFICATE_CHANGED")
            }
        }
        val tls=SSLContext.getInstance("TLS").apply {init(null,arrayOf(trust),java.security.SecureRandom())}
        val path=if(pairing!=null) "/pairing/confirm?pairId=${pairing.getString("pairId")}&expiresAt=${pairing.getLong("expiresAt")}" else if(payload==null) "/health" else "/events"
        val connection=URL("https://$host:$port$path").openConnection() as HttpsURLConnection
        connection.sslSocketFactory=tls.socketFactory
        connection.hostnameVerifier=HostnameVerifier {name,session -> name==host && runCatching {trusted(session.peerCertificates.first() as X509Certificate)}.getOrDefault(false)}
        try {
            connection.instanceFollowRedirects=false; connection.connectTimeout=2500; connection.readTimeout=5000
            connection.setRequestProperty("Authorization","Bearer $token")
            connection.setRequestProperty("X-OfficeCalls-Device",deviceId(context))
            if(payload!=null) {
                connection.requestMethod="POST";connection.doOutput=true;connection.setRequestProperty("Content-Type","application/json")
                val body=JSONObject(payload.toString()).put("deviceId",deviceId(context)).put("revision",payload.optInt("revision",1)).toString().toByteArray(Charsets.UTF_8)
                connection.setFixedLengthStreamingMode(body.size);connection.outputStream.use {it.write(body)}
            }
            if(pairing!=null && connection.responseCode==410) throw IllegalArgumentException("PAIRING_EXPIRED")
            if(pairing!=null && connection.responseCode==404) throw IllegalArgumentException("RECEIVER_UPDATE_REQUIRED")
            require(connection.responseCode==200) {"LOCAL_HTTP_${connection.responseCode}"}
            val bytes=connection.inputStream.use {it.readBytesLimited(16384)}
            val result=JSONObject(String(bytes,Charsets.UTF_8))
            if(pairing!=null) require(result.optBoolean("pairingConfirmed") && result.optString("pairId")==pairing.getString("pairId") && result.optLong("expiresAt")==pairing.getLong("expiresAt")) {"INVALID_PAIRING_CONFIRMATION"}
            else if(payload!=null) require(result.optBoolean("receiverAcknowledged") && result.optString("eventId")==payload.getString("eventId") && result.optInt("revision")==payload.optInt("revision",1)) {"INVALID_LOCAL_ACK"}
            else require(result.optString("service")=="OfficeCalls Local Receiver" && result.optBoolean("storageHealthy",true)) {"INVALID_RECEIVER_OR_STORAGE"}
            return result
        } finally {connection.disconnect()}
    }
    private fun java.io.InputStream.readBytesLimited(limit: Int): ByteArray {
        val output=java.io.ByteArrayOutputStream();val buffer=ByteArray(1024)
        while(true) {val n=read(buffer);if(n<0)break;require(output.size()+n<=limit) {"RESPONSE_TOO_LARGE"};output.write(buffer,0,n)}
        return output.toByteArray()
    }
}
