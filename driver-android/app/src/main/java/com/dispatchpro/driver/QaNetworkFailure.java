package com.dispatchpro.driver;

import java.net.UnknownHostException;
import java.net.SocketTimeoutException;
import javax.net.ssl.SSLException;

/** Classifies transport failures without logging URLs, credentials or bodies. */
final class QaNetworkFailure {
 static String code(Throwable failure, boolean online, boolean localUsb) {
  for(Throwable at=failure;at!=null;at=at.getCause())if(at instanceof SSLException)return "TLS_ERROR";
  if(localUsb){
   for(Throwable at=failure;at!=null;at=at.getCause())if(at instanceof SocketTimeoutException)return "QA_LOCAL_TIMEOUT";
   return "QA_LOCAL_UNAVAILABLE";
  }
  if(!online)return "OFFLINE";
  for(Throwable at=failure;at!=null;at=at.getCause()){
   if(at instanceof UnknownHostException)return "ENDPOINT_DNS";
   if(at instanceof SocketTimeoutException)return "SERVER_TIMEOUT";
  }
  return "SERVER_UNAVAILABLE";
 }
 static String message(String code) {
  switch(code){
   case "OFFLINE":return "لا يتوفر اتصال بالإنترنت على الهاتف";
   case "ENDPOINT_DNS":return "تعذر العثور على عنوان مكتب QA؛ تحقق من صلاحية رابط الاختبار";
   case "TLS_ERROR":return "تعذر التحقق من شهادة خادم QA؛ لا تتجاوز تحذير الأمان";
   case "SERVER_TIMEOUT":return "انتهت مهلة استجابة المكتب؛ أعد المحاولة بعد التحقق من الخادم";
   case "QA_LOCAL_TIMEOUT":return "انتهت مهلة خادم QA المحلي؛ تحقق من تشغيل بيئة الاختبار";
   case "QA_LOCAL_UNAVAILABLE":return "تعذر الوصول إلى QA المحلي؛ تحقق من USB وتشغيل بيئة الاختبار";
   default:return "خادم المكتب غير متاح حاليًا؛ تحقق من تشغيله";
  }
 }
}
