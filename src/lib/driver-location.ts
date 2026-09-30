export type LocationUpdate = { latitude:number; longitude:number; accuracy:number; capturedAt:string };

// Request precise GPS; a coarse network fix may never meet dispatch's 200m limit.
// No location queue: stale/offline fixes must never be replayed as current positions.
export function startDriverLocation(send:(value:LocationUpdate)=>Promise<unknown>, status:(text:string)=>void) {
  if(typeof document==='undefined'||typeof navigator==='undefined')return()=>{};
  if(typeof window!=='undefined'&&window.isSecureContext===false){status('GPS محظور على HTTP؛ افتح رابط HTTPS لتطبيق السائق على الهاتف');return()=>{};}
  let stopped=false, timer:ReturnType<typeof setTimeout>, last:{lat:number;lon:number;at:number}|null=null;
  async function tick() {
    if(stopped)return;
    if(document.hidden||!navigator.onLine){timer=setTimeout(tick,20000);return;}
    if(!navigator.geolocation){status('الموقع غير متاح؛ افتح التطبيق عبر HTTPS واسمح بالموقع الدقيق');return;}
    status('جارٍ تحديد موقع GPS وإرساله للمكتب…');
    navigator.geolocation.getCurrentPosition(async position=>{
      if(stopped)return;
      const {latitude,longitude,accuracy}=position.coords;
      const now=Date.now();
      const meters=last?Math.hypot((latitude-last.lat)*111320,(longitude-last.lon)*111320*Math.cos(latitude*Math.PI/180)):Infinity;
      try {
        if(accuracy<=200&&now-position.timestamp<=60000&&(!last||meters>=30||now-last.at>=60000)){
          const result=await send({latitude,longitude,accuracy,capturedAt:new Date(position.timestamp).toISOString()});
          if(result&&typeof result==='object'&&'stored' in result&&result.stored===false){status('لم يُحفظ تحديث GPS؛ ستتم المحاولة تلقائيًا');}
          else if(!stopped){last={lat:latitude,lon:longitude,at:now};status('تم إرسال GPS للمكتب');}
        } else if(accuracy>200) status(`دقة الموقع ${Math.round(accuracy)}م؛ فعّل الموقع الدقيق وانتظر GPS أدق من 200م`);
        else if(now-position.timestamp>60000) status('موقع GPS قديم؛ بانتظار موقع حديث');
        else status('مشاركة الموقع مفعّلة');
      } catch(error) {if(!stopped)status(`تعذر إرسال الموقع: ${error instanceof Error?error.message:'خطأ اتصال'}؛ ستتم المحاولة تلقائيًا`);}
      finally {if(!stopped)timer=setTimeout(tick,20000);}
    },error=>{if(!stopped){status(error.code===1?'إذن الموقع مرفوض؛ اسمح بالموقع الدقيق من إعدادات المتصفح':error.code===3?'انتهت مهلة GPS؛ تأكد من تشغيل الموقع وأبقِ التطبيق مفتوحًا':'تعذر تحديد GPS؛ تأكد من تشغيل الموقع في الهاتف');timer=setTimeout(tick,20000);}},{enableHighAccuracy:true,maximumAge:0,timeout:20000});
  }
  void tick();
  return()=>{stopped=true;clearTimeout(timer);};
}
