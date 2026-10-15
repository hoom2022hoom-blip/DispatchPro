package com.maktab.calls

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.URL

/** Optional signed LAN delivery. Discovery runs independently of HTTPS and only on shared Wi-Fi. */
internal object NetworkConnectionManager {
    @Volatile private var candidate: NsdServiceInfo? = null
    private var started=false
    private var discovery: NsdManager.DiscoveryListener?=null
    @Synchronized fun start(context: Context) {
        if(started)return;started=true
        val app=context.applicationContext
        val connectivity=app.getSystemService(ConnectivityManager::class.java)
        connectivity.registerNetworkCallback(NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build(),object:ConnectivityManager.NetworkCallback(){
            override fun onAvailable(network: Network) {discover(app);NetworkSender.resume(app)}
            override fun onLost(network: Network) {candidate=null;stop(app)}
        })
    }
    @Suppress("DEPRECATION") @Synchronized private fun discover(context: Context) {
        if(discovery!=null)return
        val nsd=context.getSystemService(NsdManager::class.java)
        val listener=object:NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(type: String)=Unit
            override fun onDiscoveryStopped(type: String)=Unit
            override fun onStartDiscoveryFailed(type: String,error: Int){discovery=null}
            override fun onStopDiscoveryFailed(type: String,error: Int){discovery=null}
            override fun onServiceLost(service: NsdServiceInfo){if(candidate?.serviceName==service.serviceName)candidate=null}
            override fun onServiceFound(service: NsdServiceInfo){
                if(!service.serviceType.contains("_officecalls._tcp"))return
                runCatching {nsd.resolveService(service,object:NsdManager.ResolveListener{
                    override fun onResolveFailed(service: NsdServiceInfo,error: Int)=Unit
                    override fun onServiceResolved(service: NsdServiceInfo){
                        val office=service.attributes["officeId"]?.toString(Charsets.UTF_8)
                        if(office==DevicePairingManager.office(context) && office?.isNotBlank()==true)candidate=service
                    }
                })}
            }
        }
        discovery=listener
        runCatching {nsd.discoverServices("_officecalls._tcp.",NsdManager.PROTOCOL_DNS_SD,listener)}.onFailure{discovery=null}
    }
    @Synchronized private fun stop(context: Context){discovery?.let {runCatching {context.getSystemService(NsdManager::class.java).stopServiceDiscovery(it)}};discovery=null}
    @Suppress("DEPRECATION") fun fallback(context: Context,payload: JSONObject): JSONObject? {
        val target=candidate ?: return null
        if(target.attributes["officeId"]?.toString(Charsets.UTF_8)!=DevicePairingManager.office(context))return null
        val prefs=context.getSharedPreferences(NetworkSender.PREFS_NAME,Context.MODE_PRIVATE)
        if(!prefs.getBoolean("signed_lan_fallback",false))return null
        val manager=context.getSystemService(ConnectivityManager::class.java)
        val network=manager.activeNetwork ?: return null
        if(manager.getNetworkCapabilities(network)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)!=true)return null
        val address=target.host ?: return null
        if(!address.isSiteLocalAddress || address is java.net.Inet6Address)return null
        val properties=manager.getLinkProperties(network) ?: return null
        if(properties.routes.none {it.destination.prefixLength>0 && it.destination.contains(address)})return null
        if(target.port !in 1..65535)return null
        // Never transmit the HTTPS bearer credential on LAN. A device signature authorizes the event.
        val store=CallStore.get(context)
        if(store.state("server_health_office")!=DevicePairingManager.office(context))return null
        if((store.state("local_authorization_until").toLongOrNull() ?: 0L)<System.currentTimeMillis())return null
        val keys=org.json.JSONArray(store.state("local_agent_keys").ifBlank {"[]"})
        val approved=List(keys.length()){keys.getString(it)}.toSet()
        if(approved.isEmpty())return null
        val trust=object:javax.net.ssl.X509TrustManager {
            override fun getAcceptedIssuers()=emptyArray<java.security.cert.X509Certificate>()
            override fun checkClientTrusted(chain: Array<java.security.cert.X509Certificate>,authType: String){throw java.security.cert.CertificateException("CLIENT_TRUST_NOT_SUPPORTED")}
            override fun checkServerTrusted(chain: Array<java.security.cert.X509Certificate>,authType: String){
                val certificate=chain.firstOrNull() ?: throw java.security.cert.CertificateException("EMPTY_CERTIFICATE")
                certificate.checkValidity()
                if(android.util.Base64.encodeToString(certificate.publicKey.encoded,android.util.Base64.NO_WRAP) !in approved)throw java.security.cert.CertificateException("UNAPPROVED_AGENT_KEY")
            }
        }
        val tls=javax.net.ssl.SSLContext.getInstance("TLS").apply {init(null,arrayOf(trust),java.security.SecureRandom())}
        val url=URL("https://${address.hostAddress}:${target.port}/officecalls/events")
        val connection=network.openConnection(url) as javax.net.ssl.HttpsURLConnection
        connection.sslSocketFactory=tls.socketFactory
        // Dynamic LAN IP is authenticated by the office-approved certificate key, not its DNS name.
        connection.hostnameVerifier=javax.net.ssl.HostnameVerifier {host,session->host==address.hostAddress && runCatching {
            android.util.Base64.encodeToString(session.peerCertificates.first().publicKey.encoded,android.util.Base64.NO_WRAP) in approved
        }.getOrDefault(false)}
        try {
            connection.requestMethod="POST";connection.doOutput=true;connection.instanceFollowRedirects=false
            connection.connectTimeout=1500;connection.readTimeout=2500
            connection.setRequestProperty("Content-Type","application/json")
            val bytes=DevicePairingManager.signed(context,payload).toString().toByteArray(Charsets.UTF_8)
            connection.setFixedLengthStreamingMode(bytes.size);connection.outputStream.use {it.write(bytes)}
            if(connection.responseCode!=200)return null
            val response=JSONObject(connection.inputStream.bufferedReader().use {it.readText().take(8192)})
            require(response.optString("eventId")==payload.getString("eventId") && response.optBoolean("receiverAcknowledged"))
            return response
        } finally {connection.disconnect()}
    }
}
