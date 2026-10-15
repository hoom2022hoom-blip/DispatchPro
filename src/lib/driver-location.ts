export type LocationUpdate = { latitude:number; longitude:number; accuracy:number; capturedAt:string };

// Request precise GPS; a coarse network fix may never meet dispatch's 200m limit.
// Reconnect requests a new observation; never replay an offline position as current.
export function startDriverLocation(send:(value:LocationUpdate)=>Promise<unknown>, status:(text:string)=>void, options:{meterActive?:boolean}={}) {
  if(typeof document==='undefined'||typeof navigator==='undefined')return()=>{};
  if(typeof window!=='undefined'&&window.isSecureContext===false){status('GPS محظور على HTTP؛ افتح رابط HTTPS لتطبيق السائق على الهاتف');return()=>{};}
  let interval=20000;
  let stopped=false,inFlight=false, timer:ReturnType<typeof setTimeout>, last:{lat:number;lon:number;at:number}|null=null;
  async function tick() {
    if(stopped||inFlight)return;
    if(!navigator.onLine){status('بانتظار الإنترنت لتحديث GPS');timer=setTimeout(tick,60000);return;}
    if((globalThis as typeof globalThis&{dispatchProDriverNativeForeground?:boolean}).dispatchProDriverNativeForeground===false||document.hidden&&!(globalThis as typeof globalThis&{dispatchProDriverBackground?:boolean}).dispatchProDriverBackground ){timer=setTimeout(tick,60000);return;}
    if(!navigator.geolocation){status('الموقع غير متاح؛ افتح التطبيق عبر HTTPS واسمح بالموقع الدقيق');return;}
    if(!last)status('جارٍ تحديد موقع GPS…');
    inFlight=true;
    navigator.geolocation.getCurrentPosition(async position=>{
      if(stopped||(globalThis as typeof globalThis&{dispatchProDriverNativeForeground?:boolean}).dispatchProDriverNativeForeground===false){inFlight=false;return;}
      const {latitude,longitude,accuracy}=position.coords;
      const now=Date.now();
      const meters=last?Math.hypot((latitude-last.lat)*111320,(longitude-last.lon)*111320*Math.cos(latitude*Math.PI/180)):Infinity;
      interval=options.meterActive||meters>=30?10000:60000;
      try {
        if(!navigator.onLine){status('جاري إعادة الاتصال؛ سيُطلب موقع حديث عند عودة الشبكة');interval=60000;return;}
        if(accuracy<=200&&now-position.timestamp<=60000&&(options.meterActive||!last||meters>=30||now-last.at>=60000)){
          const result=await send({latitude,longitude,accuracy,capturedAt:new Date(position.timestamp).toISOString()});
          if(result&&typeof result==='object'&&'stored' in result&&result.stored===false){status('لم يُحفظ تحديث GPS؛ ستتم المحاولة تلقائيًا');}
          else if(!stopped){last={lat:latitude,lon:longitude,at:now};status(options.meterActive&&result&&typeof result==='object'&&'meterAccepted' in result&&result.meterAccepted===false?'تم إرسال GPS؛ هذه النقطة لم تُقبل لحساب العداد':'تم إرسال GPS للمكتب');}
        } else if(accuracy>200) status(`دقة الموقع ${Math.round(accuracy)}م؛ فعّل الموقع الدقيق وانتظر GPS أدق من 200م`);
        else if(now-position.timestamp>60000) status('موقع GPS قديم؛ بانتظار موقع حديث');
        else status('مشاركة الموقع مفعّلة');
      } catch(error) {if(!stopped)status('جاري إعادة الاتصال؛ سيُرسل آخر موقع حديث');}
      finally {inFlight=false;if(!stopped)timer=setTimeout(tick,interval);}
    },error=>{inFlight=false;if(!stopped){status(error.code===1?'إذن الموقع مرفوض؛ اسمح بالموقع الدقيق من إعدادات المتصفح':error.code===3?'انتهت مهلة GPS؛ تأكد من تشغيل الموقع وأبقِ التطبيق مفتوحًا':'تعذر تحديد GPS؛ تأكد من تشغيل الموقع في الهاتف');timer=setTimeout(tick,interval);}},{enableHighAccuracy:true,maximumAge:0,timeout:20000});
  }
  void tick();
  const resume=()=>{if(inFlight||stopped||(globalThis as typeof globalThis&{dispatchProDriverNativeForeground?:boolean}).dispatchProDriverNativeForeground===false)return;clearTimeout(timer);
    void tick();};
  window.addEventListener('online',resume);document.addEventListener('visibilitychange',resume);
  return()=>{stopped=true;clearTimeout(timer);window.removeEventListener('online',resume);document.removeEventListener('visibilitychange',resume);};
}
