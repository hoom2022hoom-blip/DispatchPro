package com.dispatchpro.driver;
import org.junit.Test;
import static org.junit.Assert.*;
import java.net.*;
import javax.net.ssl.SSLHandshakeException;
public class QaNetworkFailureTest {
 @Test public void distinguishesInternetDnsTlsServerAndUsb(){
  assertEquals("OFFLINE",QaNetworkFailure.code(new ConnectException(),false,false));
  assertEquals("ENDPOINT_DNS",QaNetworkFailure.code(new UnknownHostException(),true,false));
  assertEquals("TLS_ERROR",QaNetworkFailure.code(new SSLHandshakeException("private"),true,true));
  assertEquals("SERVER_TIMEOUT",QaNetworkFailure.code(new SocketTimeoutException(),true,false));
  assertEquals("SERVER_UNAVAILABLE",QaNetworkFailure.code(new ConnectException(),true,false));
  assertEquals("QA_LOCAL_UNAVAILABLE",QaNetworkFailure.code(new ConnectException(),false,true));
  assertEquals("QA_LOCAL_TIMEOUT",QaNetworkFailure.code(new SocketTimeoutException(),true,true));
 }
 @Test public void unwrapsCausesAndNeverLeaksExceptionMessage(){
  assertEquals("ENDPOINT_DNS",QaNetworkFailure.code(new RuntimeException(new UnknownHostException("secret-url")),true,false));
  assertEquals("QA_LOCAL_TIMEOUT",QaNetworkFailure.code(new RuntimeException(new SocketTimeoutException("private")),true,true));
  assertFalse(QaNetworkFailure.message("ENDPOINT_DNS").contains("secret-url"));
  assertFalse(QaNetworkFailure.message("SERVER_UNAVAILABLE").contains("الإنترنت"));
 }
}
