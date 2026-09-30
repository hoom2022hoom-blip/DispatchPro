"use client";

import { DriverJourneyMap } from './driver-journey-map';
import { startDriverLocation } from '@/lib/driver-location';
import { useEffect, useRef, useState } from 'react';
import { createDriverApi, DriverApiError, noticeLabel, type DriverProfile, type DriverRide, type DriverSnapshot, type RideHistory } from '@/lib/driver-api';
import { enableBrowserNotifications, sendBrowserNotification } from '@/lib/notifications';

const button='min-h-14 rounded-2xl border px-5 py-4 text-lg font-bold disabled:opacity-40';
const input='block w-full rounded-lg border p-3';
const statusLabel:Record<string,string>={Assigned:'طلب جديد',Accepted:'تم القبول',DriverArriving:'في الطريق إلى العميل',Arrived:'وصلت للعميل',InProgress:'الرحلة جارية',Completed:'مكتملة',Cancelled:'ملغاة',Available:'متصل · متاح',Offline:'غير متصل',Busy:'مشغول'};

export function DriverApiDashboard() {
  const [api]=useState(()=>createDriverApi());
  const [profile,setProfile]=useState<DriverProfile|null>(null);
  const [snapshot,setSnapshot]=useState<DriverSnapshot|null>(null);
  const [rides,setRides]=useState<DriverRide[]>([]);
  const [tenant,setTenant]=useState(''),[username,setUsername]=useState(''),[password,setPassword]=useState('');
  const [driverPoint,setDriverPoint]=useState<{latitude:number;longitude:number;at:number}|undefined>();
  const receivedOffers=useRef(new Map<string,number>());
  const [gpsStatus,setGpsStatus]=useState(''),[gpsRetry,setGpsRetry]=useState(0);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[connection,setConnection]=useState('جارٍ الاتصال');
  const [connected,setConnected]=useState(false),[revision,setRevision]=useState(0);
  const [tab,setTab]=useState('rides'),[page,setPage]=useState(1),[history,setHistory]=useState<RideHistory|null>(null);
  const [notificationPermission,setNotificationPermission]=useState(''),[read,setRead]=useState<string[]>([]);
  const seen=useRef<Set<string>|null>(null),generation=useRef(0);
  const details=useRef(new Map<string,DriverRide>());
  const [now,setNow]=useState(Date.now);
  const hasOffer=rides.some(ride=>ride.status==='Assigned'&&ride.offerExpiresAt);
  useEffect(()=>{if(!hasOffer)return;setNow(api.offerNow());const timer=setInterval(()=>setNow(api.offerNow()),1000);return()=>clearInterval(timer);},[api,hasOffer]);
  const clearSession=()=>{generation.current++;api.logout();setDriverPoint(undefined);receivedOffers.current.clear();setProfile(null);setSnapshot(null);setRides([]);setHistory(null);setRead([]);seen.current=null;details.current.clear();setConnected(false);setPage(1);setTab('rides');};

  const locationActive = !!profile && (profile.status === 'Available' || rides.length > 0);
  useEffect(()=>{
    if (!locationActive) { setGpsStatus(''); return; }
    return startDriverLocation(async value => {const result=await api.location(value);if(!(result&&typeof result==='object'&&'stored' in result&&result.stored===false))setDriverPoint({latitude:value.latitude,longitude:value.longitude,at:Date.now()});return result;}, setGpsStatus);
  },[api,profile?.id,locationActive,gpsRetry]);

  useEffect(()=>{
    const reconnect=()=>setRevision(r=>r+1);
    const offline=()=>{setConnected(false);setConnection('انقطع الإنترنت؛ الإجراءات متوقفة حتى إعادة الاتصال');};
    window.addEventListener('online',reconnect);window.addEventListener('offline',offline);
    return()=>{window.removeEventListener('online',reconnect);window.removeEventListener('offline',offline);};
  },[]);
  useEffect(()=>{
    if(!profile)return;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;let cursor='';let retry=2000;
    const current=generation.current;
    const active=()=>!controller.signal.aborted&&current===generation.current;
    async function watch(){
      if(!navigator.onLine){if(active()){setConnected(false);setConnection('غير متصل بالإنترنت');timer=setTimeout(watch,30000);}return;}
      try {
        const update=await api.updates(cursor,controller.signal);
        if(!active())return;
        const data=update.data;
        // Sensitive details are fetched only for accepted rides; snapshots and notices never contain them.
        const next=await Promise.all(data.rides.map(async ride=>{
          if(ride.status==='Assigned')return ride;
          const cached=details.current.get(ride.id);
          return cached?.version===ride.version?cached:api.ride(ride.id);
        }));
        if(!active())return;
        details.current=new Map(next.map(r=>[r.id,r]));
        const fresh=data.notices.filter(n=>seen.current?!seen.current.has(n.id):n.action.endsWith('.Assigned')&&data.rides.some(r=>r.id===n.entityId&&r.status==='Assigned'));
        for(const notice of fresh.slice(0,3)){
          const ride=data.rides.find(r=>r.id===notice.entityId);
          void sendBrowserNotification(noticeLabel(notice.action),ride?`طلب ${ride.id.slice(0,8)} · ${ride.pickup}${ride.destination?' ← '+ride.destination:''}`:`طلب ${notice.entityId.slice(0,8)}`);
        }
        seen.current=new Set(data.notices.map(n=>n.id));
        setNow(api.offerNow());for(const ride of next)if(ride.status==='Assigned'&&!receivedOffers.current.has(ride.id))receivedOffers.current.set(ride.id,api.offerNow());
        setSnapshot(data);setProfile(data.driver);setRides(next);setConnected(true);setConnection('متصل بالمكتب');
        cursor=update.cursor;retry=2000;
        timer=setTimeout(watch,0);
      }catch(e){
        if(!active())return;
        if(e instanceof DriverApiError&&(e.status===401||e.status===403)){setError(e.message);clearSession();return;}
        setConnected(false);setConnection('تعذر الاتصال؛ البيانات قديمة، إعادة المحاولة تلقائيًا');
        timer=setTimeout(watch,retry);retry=Math.min(retry*2,60000);
      }
    }
    void watch();return()=>{controller.abort();clearTimeout(timer);};
  // Profile changes are delivered by the same watch; only a new session/retry restarts it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[api,profile?.id,revision]);

  useEffect(()=>{
    if(!profile||tab!=='history')return;
    let live=true;setHistory(null);
    void api.history(page).then(data=>{if(live)setHistory(data);}).catch(e=>{if(live)setError(e.message);});
    return()=>{live=false;};
  },[api,profile?.id,tab,page,revision]);

  async function mutate(work:()=>Promise<unknown>){
    if(busy||!connected)return;
    const current=generation.current;setBusy(true);setError('');setConnected(false);
    try{await work();}catch(e){if(current===generation.current)setError(`${(e as Error).message} — راجع الحالة بعد التحديث؛ لن نكرر الإجراء تلقائيًا.`);}
    finally{if(current===generation.current){setBusy(false);setRevision(r=>r+1);}}
  }

  if(!profile)return <main dir="rtl" className="h-full overflow-auto bg-slate-50 p-4"><form className="mx-auto my-8 max-w-md space-y-5 rounded-2xl border bg-white p-6" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{const driver=await api.login(tenant.trim(),username.trim(),password);setPassword('');setProfile(driver);setRevision(r=>r+1);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>
    <p className="text-sm text-blue-700">DispatchPro · تطبيق السائق</p><h1 className="text-2xl font-bold">تسجيل دخول السائق</h1>
    <label className="block">معرف المكتب<input className={input} required autoComplete="organization" value={tenant} onChange={e=>setTenant(e.target.value)}/></label>
    <label className="block">اسم المستخدم<input className={input} required autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)}/></label>
    <label className="block">كلمة المرور<input className={input} required type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
    {error&&<p role="alert" className="text-red-700">{error}</p>}<button className={`${button} w-full bg-blue-700 text-white`} disabled={busy}>{busy?'جارٍ الدخول…':'دخول'}</button>
  </form></main>;

  return <main dir="rtl" className="h-full overflow-auto bg-slate-50 p-4"><div className="mx-auto max-w-xl space-y-4">
    <header className="space-y-3 rounded-xl border bg-white p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold text-emerald-700">DISPATCHPRO · السائق</p><h1 className="text-2xl font-bold">{profile.fullName}</h1></div><button className={button} disabled={busy} onClick={async()=>{setBusy(true);try{if(connected&&profile.status==='Available'&&rides.every(r=>r.status==='Assigned'&&r.offerExpiresAt))await api.availability('Offline');}catch{/* Local logout must remain possible offline. */}finally{clearSession();setBusy(false);}}}>خروج</button></div>
      <p role="status" className={connected?'text-green-700':'text-amber-800'}>{connection}</p><p>الحالة: {statusLabel[profile.status]}</p>{gpsStatus&&<p className="text-sm" role="status">{gpsStatus}</p>}
      {locationActive&&<><p role="status" className={profile.locationStatus==='READY'?'text-green-700':'text-amber-800'}>{profile.locationStatus==='READY'?'GPS محفوظ وحديث لدى المكتب':profile.locationStatus==='STALE_LOCATION'?'موقعك لدى المكتب قديم؛ استقبال الطلبات التلقائية متوقف':profile.locationStatus==='POOR_ACCURACY'?'الموقع لدى المكتب غير دقيق؛ استقبال الطلبات التلقائية متوقف':'لم يصل GPS صالح إلى المكتب؛ استقبال الطلبات التلقائية متوقف'}</p><button className={button} onClick={()=>setGpsRetry(n=>n+1)}>تحديث GPS الآن</button></>}
      <div className="flex flex-wrap gap-2"><button className={`${button} flex-1 bg-emerald-700 text-white`} disabled={busy||!connected||rides.length>0||profile.status==='Available'} onClick={()=>void mutate(()=>api.availability('Available'))}>متاح</button><button className={`${button} flex-1 bg-slate-100`} disabled={busy||!connected||rides.some(r=>r.status!=='Assigned'||!r.offerExpiresAt)||profile.status==='Offline'} onClick={()=>void mutate(()=>api.availability('Offline'))}>غير متاح</button>{!connected&&<button className={button} onClick={()=>setRevision(r=>r+1)}>إعادة الاتصال</button>}</div>
    </header>
    {error&&<p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-red-800">{error}</p>}
    <nav className="flex flex-wrap gap-2" aria-label="السائق">{[['rides','الطلبات'],['history','سجل الرحلات'],['notifications',`الإشعارات (${snapshot?.notices.filter(n=>!read.includes(n.id)).length??0})`]].map(([key,label])=><button key={key} className={`${button} ${tab===key?'bg-blue-700 text-white':'bg-white'}`} aria-pressed={tab===key} onClick={()=>setTab(key)}>{label}</button>)}</nav>
    {tab==='rides'&&<section className="space-y-4">{rides.map(ride=><article key={ride.id} className={`space-y-3 rounded-xl border p-5 ${ride.status==='Assigned'?'border-blue-600 bg-blue-50':'bg-white'}`}>
      <h2 className="text-lg font-bold">{statusLabel[ride.status]} · <bdi>{ride.id.slice(0,8)}</bdi></h2>
      {ride.status==='Assigned'&&receivedOffers.current.has(ride.id)&&<p className="text-sm text-slate-600">وقت وصول الطلب: {new Date(receivedOffers.current.get(ride.id)!).toLocaleTimeString('ar')}</p>}
      {ride.offerDistanceMeters!=null&&<p>المسافة إلى الزبون: {(ride.offerDistanceMeters/1000).toFixed(1)} كم تقريبًا</p>}{ride.offerExpiresAt&&<p role="timer" className="rounded-xl bg-amber-100 p-3 text-xl font-bold text-amber-950">مهلة الرد: {Math.max(0,Math.ceil((Date.parse(ride.offerExpiresAt)-now)/1000))} ثانية</p>}
      {ride.status==='Assigned'&&<p role="alert" className="font-bold text-blue-800">لديك طلب جديد — قبول أو رفض</p>}
      <p><strong>الانطلاق:</strong> {ride.pickup||'يحدده المكتب'}</p><p><strong>الوجهة:</strong> {ride.destination||'غير محددة'}</p>
      {ride.status==='Assigned'&&ride.latitude!=null&&ride.longitude!=null&&<a target="_blank" rel="noopener noreferrer" className="block text-blue-700 underline" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${ride.latitude},${ride.longitude}`)}`}>موقع الانطلاق على الخريطة</a>}
      {ride.destinationLatitude!=null&&ride.destinationLongitude!=null&&<a target="_blank" rel="noopener noreferrer" className="block text-blue-700 underline" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${ride.destinationLatitude},${ride.destinationLongitude}`)}`}>الوجهة على الخريطة</a>}
      {['Accepted','DriverArriving','Arrived','InProgress'].includes(ride.status)&&<><ol aria-label="مراحل الرحلة" className="flex flex-wrap gap-2 text-sm">{[['Accepted','تم القبول'],['DriverArriving','في الطريق إلى الزبون'],['Arrived','وصلت للزبون'],['InProgress','الرحلة جارية']].map(([state,label])=><li key={state} aria-current={ride.status===state?'step':undefined} className={ride.status===state?'rounded-lg bg-emerald-100 p-2 font-bold':'p-2 text-slate-500'}>{label}</li>)}</ol><DriverJourneyMap driver={driverPoint&&Date.now()-driverPoint.at<=120000?driverPoint:undefined} pickup={ride.latitude!=null&&ride.longitude!=null?{latitude:ride.latitude,longitude:ride.longitude}:undefined} destination={ride.destinationLatitude!=null&&ride.destinationLongitude!=null?{latitude:ride.destinationLatitude,longitude:ride.destinationLongitude}:undefined}/>{(ride.status==='InProgress'?ride.destinationLatitude!=null&&ride.destinationLongitude!=null:ride.latitude!=null&&ride.longitude!=null)&&<a className="block rounded-xl bg-slate-900 p-4 text-center text-lg font-bold text-white" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${ride.status==='InProgress'?ride.destinationLatitude:ride.latitude},${ride.status==='InProgress'?ride.destinationLongitude:ride.longitude}&travelmode=driving`}>{ride.status==='InProgress'?'فتح الملاحة إلى الوجهة':'التوجه إلى الزبون · فتح الملاحة'}</a>}</>}
      {['Accepted','DriverArriving','Arrived','InProgress'].includes(ride.status)&&<div className="space-y-2 border-t pt-3"><p><strong>العميل:</strong> {ride.fullName||'غير مسجل'}</p>{ride.phone&&<a className="block text-blue-700 underline" href={`tel:${ride.phone}`}><bdi>{ride.phone}</bdi></a>}<p><strong>العنوان:</strong> {[ride.addressText,ride.neighborhood,ride.street].filter(Boolean).join(' · ')||ride.pickup}</p>{ride.notes&&<p><strong>ملاحظات:</strong> {ride.notes}</p>}{ride.latitude!=null&&ride.longitude!=null&&<a target="_blank" rel="noopener noreferrer" className="block text-blue-700 underline" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${ride.latitude},${ride.longitude}`)}`}>فتح الموقع</a>}</div>}
      <div className="flex flex-wrap gap-2">{ride.status==='Assigned'?<><button className={`${button} flex-1 bg-emerald-700 text-white`} disabled={busy||!connected||!!ride.offerExpiresAt&&Date.parse(ride.offerExpiresAt)<=now} onClick={()=>void mutate(()=>api.transition(ride,'Accepted'))}>قبول</button><button className={button} disabled={busy||!connected||!!ride.offerExpiresAt&&Date.parse(ride.offerExpiresAt)<=now} onClick={()=>void mutate(()=>api.reject(ride))}>رفض</button></>:<button className={`${button} w-full bg-emerald-700 text-white`} disabled={busy||!connected} onClick={()=>void mutate(()=>api.transition(ride,ride.status==='Accepted'?'DriverArriving':ride.status==='DriverArriving'?'Arrived':ride.status==='Arrived'?'InProgress':'Completed'))}>{ride.status==='Accepted'?'في الطريق':ride.status==='DriverArriving'?'وصلت':ride.status==='Arrived'?'بدء الرحلة':'إنهاء الرحلة'}</button>}</div>
    </article>)}{!rides.length&&<p className="rounded-xl border bg-white p-6">{connected?(profile.status==='Available'?'بانتظار طلب جديد':'فعّل متاح لاستقبال الطلبات'):'جارٍ استعادة حالة الطلبات…'}</p>}</section>}
    {tab==='history'&&<section className="space-y-3"><h2 className="font-bold">سجل الرحلات</h2>{!history?<p role="status">جارٍ التحميل…</p>:<>{history.items.map(ride=><article className="rounded-xl border bg-white p-4" key={ride.id}><p>{statusLabel[ride.status]} · <bdi>{ride.id.slice(0,8)}</bdi></p><p>{ride.pickup} ← {ride.destination||'غير محددة'}</p><time>{new Date(ride.createdAt).toLocaleString('ar')}</time></article>)}{!history.items.length&&<p>لا توجد رحلات سابقة.</p>}<div className="flex gap-3"><button className={button} disabled={page===1||!connected} onClick={()=>setPage(p=>p-1)}>السابق</button><span>صفحة {page}</span><button className={button} disabled={page*20>=history.total||!connected} onClick={()=>setPage(p=>p+1)}>التالي</button></div></>}</section>}
    {tab==='notifications'&&<section className="space-y-3"><h2 className="font-bold">الإشعارات</h2><button className={button} onClick={()=>void enableBrowserNotifications().then(result=>setNotificationPermission(result==='granted'?'تم تفعيل إشعارات المتصفح':result==='denied'?'اسمح بالإشعارات من إعدادات المتصفح':'الإشعارات داخل التطبيق متاحة'))}>تفعيل إشعارات المتصفح</button>{notificationPermission&&<p role="status">{notificationPermission}</p>}<p className="text-sm text-slate-600">أبقِ التطبيق مفتوحًا أثناء العمل لاستقبال الطلبات. عند العودة يُستعاد آخر تحديث تلقائيًا.</p><button className={button} onClick={()=>setRead(snapshot?.notices.map(n=>n.id)??[])}>تعليم الكل كمقروء</button>{snapshot?.notices.map(notice=><article key={notice.id} className={`rounded-xl border p-3 ${read.includes(notice.id)?'bg-white':'bg-blue-50'}`}><p>{noticeLabel(notice.action)} · <bdi>{notice.entityId.slice(0,8)}</bdi></p><time>{new Date(notice.createdAt).toLocaleString('ar')}</time></article>)}</section>}
  </div></main>;
}
