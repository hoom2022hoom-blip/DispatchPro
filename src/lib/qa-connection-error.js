const messages={OFFLINE:'لا يتوفر اتصال بالإنترنت على الهاتف',ENDPOINT_DNS:'تعذر العثور على عنوان مكتب QA؛ تحقق من صلاحية رابط الاختبار',TLS_ERROR:'تعذر التحقق من شهادة خادم QA؛ لا تتجاوز تحذير الأمان',SERVER_TIMEOUT:'انتهت مهلة استجابة المكتب؛ أعد المحاولة بعد التحقق من الخادم',QA_LOCAL_TIMEOUT:'انتهت مهلة خادم QA المحلي؛ تحقق من تشغيل بيئة الاختبار',QA_LOCAL_UNAVAILABLE:'تعذر الوصول إلى QA المحلي؛ تحقق من USB وتشغيل بيئة الاختبار',SERVER_UNAVAILABLE:'خادم المكتب غير متاح حاليًا؛ تحقق من تشغيله'};
export function qaConnectionFailure(error,online=true){
 const code=error?.code||(online?(error?.name==='TimeoutError'?'SERVER_TIMEOUT':'SERVER_UNAVAILABLE'):'OFFLINE');
 return {code,message:messages[code]||messages.SERVER_UNAVAILABLE};
}
export function qaHttpFailure(status,detail={}){
 if(status===401)return {code:detail.code||'AUTH_FAILED',message:'بيانات الدخول غير صحيحة أو انتهت الجلسة'};
 if(status===403)return {code:detail.code||'FORBIDDEN',message:'حساب السائق غير متاح أو لا يملك الصلاحية'};
 if([502,503,504,530].includes(status))return {code:detail.code||'SERVER_UNAVAILABLE',message:detail.code==='QA_UPSTREAM_UNAVAILABLE'?'خدمة الاختبار متوقفة؛ شغّل بيئة QA ثم أعد المحاولة':'خادم مكتب QA غير متاح حاليًا'};
 if(status>=500)return {code:detail.code||'SERVER_ERROR',message:'حدث خطأ في خادم المكتب؛ حالة الرحلة محفوظة ويجب التحقق منها'};
 return null;
}
