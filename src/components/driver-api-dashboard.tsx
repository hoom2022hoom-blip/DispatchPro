"use client";
import {browserUuid} from '@/lib/browser-id.js';

import {Settings,Phone,Navigation} from 'lucide-react';
import {DriverOfferDetails} from './driver-offer-details';
import {driverConnectionLabel} from '@/lib/driver-ui-status';
import {driverTripMetrics} from '@/lib/driver-trip-metrics';
import {driverTrace} from '@/lib/driver-runtime-diagnostics.js';
import {DriverDiagnostics} from './driver-diagnostics';
import {RideChat} from './ride-chat';
import {RideCommunicationControl,RideCallButton} from './ride-communication';
import {TaxiTheme} from './taxi-theme';
import {DriverVoice} from './ptt-control';
import {DriverExternalPtt} from './driver-external-ptt';
import { RideLocationEditor } from './ride-location-editor';
import { EarningsCards, EarningsPage } from './driver-earnings';
import type { DriverEarnings } from '@/lib/driver-api';
import { DriverStreetRideForm } from './driver-street-ride-form';
import { streetRideLabel } from '@/lib/ride-source';
import { DriverJourneyMap } from './driver-journey-map';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { startDriverLocation } from '@/lib/driver-location';
import { useEffect, useRef, useState } from 'react';
import { createDriverApi, DriverApiError, noticeLabel, type DriverProfile, type DriverRide, type DriverSnapshot, type RideHistory } from '@/lib/driver-api';
import {createDriverOfferAlert} from '@/lib/driver-offer-alert';
import {isQaAudio,qaTone} from '@/lib/qa-audio.js';
import { enableBrowserNotifications, sendBrowserNotification, closeDriverOfferNotification } from '@/lib/notifications';

import {normalizePhone} from '@/lib/phone-normalization.js';
import {defaultDriverTones,previewDriverTone,toneChoices} from '@/lib/driver-tones.js';

const button='min-h-14 rounded-2xl border px-5 py-4 text-lg font-bold disabled:opacity-40';
const input='block w-full rounded-lg border p-3';
const statusLabel:Record<string,string>={Assigned:'طلب جديد',Accepted:'تم قبول الطلب',DriverArriving:'في الطريق إلى الزبون',Arrived:'وصلت للزبون',InProgress:'الرحلة جارية',Completed:'مكتملة',Cancelled:'ملغاة',Available:'متصل · متاح',Offline:'غير متصل',Busy:'مشغول'};

export function DriverApiDashboard({logoSrc='/customer-mobile/office-logo.webp',recoverFromBackend=false}:{logoSrc?:string;recoverFromBackend?:boolean}={}) {
  const [api]=useState(()=>createDriverApi(undefined,(globalThis as typeof globalThis & {dispatchProDriverStorage?:import("@/lib/driver-api").DriverSessionStorage}).dispatchProDriverStorage));
  useEffect(()=>{const bind=(event:Event)=>{if(!api.authenticated())return;const detail=(event as CustomEvent).detail;void api.voice<{recipient:string}>('driver/push-device','POST',detail).then(result=>{window.dispatchEvent(new CustomEvent('dispatchpro-driver-push-bound',{detail:result}));}).catch(()=>{});};window.addEventListener('dispatchpro-driver-push',bind);return()=>window.removeEventListener('dispatchpro-driver-push',bind);},[api]);
  const [authReady,setAuthReady]=useState(false);
  const [profile,setProfile]=useState<DriverProfile|null>(null);
  useEffect(()=>{if(profile)window.dispatchEvent(new Event('dispatchpro-driver-ready'));},[profile?.id]);
  const [snapshot,setSnapshot]=useState<DriverSnapshot|null>(null);
  const [rides,setRides]=useState<DriverRide[]>([]);
  const [remember,setRemember]=useState(true);
  const [tenant,setTenant]=useState(''),[username,setUsername]=useState(''),[password,setPassword]=useState('');
  const [driverPoint,setDriverPoint]=useState<{latitude:number;longitude:number;at:number}|undefined>();
  const receivedOffers=useRef(new Map<string,number>());
  const [gpsStatus,setGpsStatus]=useState(''),[gpsRetry,setGpsRetry]=useState(0);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[connection,setConnection]=useState('جارٍ الاتصال');
  const [connected,setConnected]=useState(false),[revision,setRevision]=useState(0);
  const [background,setBackground]=useState(false);
  const [foreground,setForeground]=useState(true);
  useEffect(()=>{const update=()=>{const visible=(globalThis as typeof globalThis&{dispatchProDriverNativeForeground?:boolean}).dispatchProDriverNativeForeground!==false;setForeground(visible);if(visible)setConnected(false);};window.addEventListener('dispatchpro-driver-foreground',update);return()=>window.removeEventListener('dispatchpro-driver-foreground',update);},[]);
  useEffect(()=>{const update=()=>setBackground(!!(globalThis as typeof globalThis&{dispatchProDriverBackground?:boolean}).dispatchProDriverBackground);window.addEventListener('dispatchpro-driver-service',update);update();return()=>window.removeEventListener('dispatchpro-driver-service',update);},[]);
  const [tab,setTab]=useState('rides'),[page,setPage]=useState(1),[history,setHistory]=useState<RideHistory|null>(null);
  const [officeUnread,setOfficeUnread]=useState(0);
  useEffect(()=>{if(!isQaAudio()||!profile)return;const badge=(event:Event)=>setOfficeUnread(Math.max(0,(event as CustomEvent).detail?.[profile.id]||0));window.addEventListener('dispatchpro-chat-unread',badge);return()=>window.removeEventListener('dispatchpro-chat-unread',badge);},[profile?.id]);
  useEffect(()=>{if(!isQaAudio()||!profile)return;const open=(event:Event)=>{if((event as CustomEvent).detail?.rideId===profile.id)setTab('office');};if((globalThis as any).dispatchProChatOpen===profile.id)setTab('office');window.addEventListener('dispatchpro-chat-open',open);return()=>window.removeEventListener('dispatchpro-chat-open',open);},[profile?.id]);
  useEffect(()=>{const state=globalThis as typeof globalThis&{dispatchProDriverOfferOpen?:boolean};const open=()=>{state.dispatchProDriverOfferOpen=false;setTab('rides');setRevision(n=>n+1);};window.addEventListener('dispatchpro-driver-open-offer',open);if(state.dispatchProDriverOfferOpen)open();return()=>window.removeEventListener('dispatchpro-driver-open-offer',open);},[]);
  const [earningsPeriod,setEarningsPeriod]=useState('today');
  const [earnings,setEarnings]=useState<DriverEarnings|null>(null),[earningsFailed,setEarningsFailed]=useState(false),[earningsPage,setEarningsPage]=useState(1);
  const [notificationPermission,setNotificationPermission]=useState(''),[read,setRead]=useState<string[]>([]);
  const seen=useRef<Set<string>|null>(null),generation=useRef(0);
  const details=useRef(new Map<string,DriverRide>());
  const [now,setNow]=useState(Date.now);
  const [editing,setEditing]=useState<DriverRide|null>(null);
  const [streetOpen,setStreetOpen]=useState(false);
  const [completing,setCompleting]=useState<DriverRide|null>(null),[collectedFare,setCollectedFare]=useState('');
  const mutationLock=useRef(false);
  const [radioOwner,setRadioOwner]=useState(()=>{try{return localStorage.getItem("nm.driver-radio-owner")!=="tnm";}catch{return true;}});
  const chooseRadioOwner=(driver:boolean)=>{const native=(globalThis as any).dispatchProCallNative;if(native)void native('external.configure',{action:'owner',owner:driver?'driver':'radio'}).then(()=>setRadioOwner(driver)).catch((e:Error)=>setError(e.message));else setRadioOwner(driver);};
  useEffect(()=>{const apply=(value:{owner?:string})=>{if(value.owner==='driver'||value.owner==='radio')setRadioOwner(value.owner==='driver');};const changed=(e:Event)=>apply((e as CustomEvent).detail);window.addEventListener('dispatchpro-external-key',changed);const native=(globalThis as any).dispatchProCallNative;if(native)void native('external.status').then(apply).catch(()=>{});return()=>window.removeEventListener('dispatchpro-external-key',changed);},[]);
  useEffect(()=>{try{localStorage.setItem("nm.driver-radio-owner",radioOwner?"driver":"tnm");}catch{}},[radioOwner]);
  const [preferences,setPreferences]=useState(()=>{try{return {...{...defaultDriverTones,notifications:true,sound:true,vibration:true},...JSON.parse(localStorage.getItem('driver.alert.preferences')||'{}')}}catch{return {...defaultDriverTones,notifications:true,sound:true,vibration:true}}});
  const preferenceRef=useRef(preferences);preferenceRef.current=preferences;
  const [alert]=useState(()=>createDriverOfferAlert({closeNotification:closeDriverOfferNotification,now:()=>api.offerNow(),refresh:()=>setRevision(n=>n+1),preferences:()=>preferenceRef.current}));
  useEffect(()=>{const unlock=()=>alert.unlock();window.addEventListener('pointerdown',unlock,{once:true});window.addEventListener('keydown',unlock,{once:true});return()=>{window.removeEventListener('pointerdown',unlock);window.removeEventListener('keydown',unlock);alert.dispose();};},[alert]);
  useEffect(()=>{try{localStorage.setItem('driver.alert.preferences',JSON.stringify(preferences));window.dispatchEvent(new CustomEvent('dispatchpro-driver-notification-settings',{detail:preferences}));}catch{}},[preferences]);
  useEffect(()=>{const offer=rides.find(r=>r.status==='Assigned'&&(!r.offerExpiresAt||Date.parse(r.offerExpiresAt)>now));if(offer){alert.offer({id:offer.id,expiresAt:offer.offerExpiresAt?Date.parse(offer.offerExpiresAt):null});window.dispatchEvent(new CustomEvent('dispatchpro-driver-offer',{detail:{rideId:offer.id,eventId:'',offerKey:offer.id+':'+(offer.offerExpiresAt||''),remaining:offer.offerExpiresAt?Date.parse(offer.offerExpiresAt)-api.offerNow():-1}}));}else alert.stop();},[rides,now,alert]);
  const hasOffer=rides.some(ride=>ride.status==='Assigned'&&ride.offerExpiresAt || ride.status==='InProgress');
  useEffect(()=>{if(!hasOffer)return;setNow(api.offerNow());const timer=setInterval(()=>setNow(api.offerNow()),1000);return()=>clearInterval(timer);},[api,hasOffer]);
  const clearSession=()=>{generation.current++;alert.stop();api.logout();setDriverPoint(undefined);receivedOffers.current.clear();setCompleting(null);setCollectedFare('');setStreetOpen(false);setProfile(null);setSnapshot(null);setRides([]);setHistory(null);setEarnings(null);setEarningsPage(1);setRead([]);seen.current=null;details.current.clear();setConnected(false);setPage(1);setTab('rides');};

  useEffect(()=>{let live=true;void (api.bootstrap?.(!recoverFromBackend)??Promise.resolve(null)).then(restored=>{if(live&&restored){setProfile(restored);setTenant(api.sessionIdentity?.()?.tenant??'');const cached=recoverFromBackend?null:api.cachedSnapshot?.();if(cached){setSnapshot(cached);setRides(cached.rides);}}}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setAuthReady(true);});return()=>{live=false;};},[api,recoverFromBackend]);
  const meterActive=rides.some(r=>r.fareMode==="GPS_METER"&&r.status==="InProgress");
  useEffect(()=>{window.dispatchEvent(new CustomEvent('dispatchpro-gps-access',{detail:{active:profile?.gpsEnabled!==false}}));},[profile?.gpsEnabled]);
  const locationActive = !!profile && (profile.status === 'Available' || rides.length > 0);
  useEffect(()=>{window.dispatchEvent(new CustomEvent('dispatchpro-driver-duty',{detail:{active:locationActive}}));},[locationActive]);
  useEffect(()=>{
    if (!locationActive || profile?.gpsEnabled===false) { setGpsStatus(profile?.gpsEnabled===false?'مشاركة الموقع موقوفة من المكتب':''); return; }
    return startDriverLocation(async value => {const result=await api.location(value);if(!(result&&typeof result==='object'&&'stored' in result&&result.stored===false))setDriverPoint({latitude:value.latitude,longitude:value.longitude,at:Date.parse(value.capturedAt)});return result;}, setGpsStatus,{meterActive});
  },[api,profile?.id,locationActive,gpsRetry,meterActive,profile?.gpsEnabled]);

  useEffect(()=>{
    const reconnect=()=>setRevision(r=>r+1);
    const resume=()=>{if(document.visibilityState==='visible')reconnect();};
    const offline=()=>{setConnected(false);setConnection('انقطع الإنترنت؛ الإجراءات متوقفة حتى إعادة الاتصال');};
    window.addEventListener('online',reconnect);window.addEventListener('offline',offline);
    if(typeof document!=='undefined')document.addEventListener('visibilitychange',resume);
    return()=>{window.removeEventListener('online',reconnect);window.removeEventListener('offline',offline);if(typeof document!=='undefined')document.removeEventListener('visibilitychange',resume);};
  },[]);
  useEffect(()=>{
    if(!authReady||!profile||!foreground)return;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;let cursor='';let retry=2000;
    const current=generation.current;
    const active=()=>!controller.signal.aborted&&current===generation.current;
    async function watch(){
      if(!navigator.onLine){if(active()){setConnected(false);setConnection('غير متصل بالإنترنت');timer=setTimeout(watch,30000);}return;}
      try {
        const update=await api.updates(cursor,controller.signal,{reconcileOnly:recoverFromBackend});
        if(!active())return;
        const data=update.data;
        // Sensitive details are fetched only for accepted rides; snapshots and notices never contain them.
        const next=await Promise.all(data.rides.map(async ride=>{
          if(ride.status==='Assigned')return ride;
          const cached=details.current.get(ride.id);
          return cached?.version===ride.version?{...cached,...ride}:api.ride(ride.id,controller.signal);
        }));
        if(!active())return;
        details.current=new Map(next.map(r=>[r.id,r]));
        const fresh=data.notices.filter(n=>seen.current?!seen.current.has(n.id):n.action.endsWith('.Assigned')&&data.rides.some(r=>r.id===n.entityId&&r.status==='Assigned'));
        for(const notice of fresh.slice(0,3)){
          const ride=data.rides.find(r=>r.id===notice.entityId);
          if(preferenceRef.current.notifications)void sendBrowserNotification(noticeLabel(notice.action),ride?`طلب جديد · ${ride.pickup}${ride.destination?' ← '+ride.destination:''}`:`تحديث الرحلة`,undefined,ride?.status==='Assigned'?'driver-offer-'+ride.id:undefined,notice.id);
        }
        seen.current=new Set(data.notices.map(n=>n.id));
        setNow(api.offerNow());for(const ride of next)if(ride.status==='Assigned'&&!receivedOffers.current.has(ride.id))receivedOffers.current.set(ride.id,api.offerNow());
        setSnapshot(data);setProfile(data.driver);setRides(next);setConnected(true);setConnection('متصل بالمكتب');
        driverTrace('snapshot-render',{status:next[0]?.status});
        cursor=update.cursor;retry=2000;
        timer=setTimeout(watch,0);
      }catch(e){
        if(!active())return;
        if(e instanceof DriverApiError&&e.sessionInvalid){setError(e.message);clearSession();return;}
        driverTrace('snapshot-failed',{kind:e instanceof Error?e.name:'Error'});
        setConnected(false);setConnection(isQaAudio()&&e instanceof Error?e.message:'جاري إعادة الاتصال');
        timer=setTimeout(watch,retry+Math.random()*500);retry=Math.min(retry*2,30000);
      }
    }
    void watch();return()=>{controller.abort();clearTimeout(timer);};
  // Profile changes are delivered by the same watch; only a new session/retry restarts it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[api,authReady,profile?.id,revision,foreground]);

  useEffect(()=>{
    if(!profile||tab!=='history')return;
    let live=true;setHistory(null);
    void api.history(page).then(data=>{if(live)setHistory(data);}).catch(e=>{if(live)setError(e.message);});
    return()=>{live=false;};
  },[api,profile?.id,tab,page,revision]);

  useEffect(()=>{
    setEarnings(null);setEarningsFailed(false);
    if(!profile||tab!=='earnings')return;
    let live=true;
    void api.earnings(earningsPage,earningsPeriod).then(data=>{if(live)setEarningsFailed(false);if(live)setEarnings(data);}).catch(e=>{if(live){setEarningsFailed(true);if(e instanceof DriverApiError&&e.sessionInvalid)clearSession();}});
    return()=>{live=false;};
  },[api,profile?.id,tab,earningsPage,earningsPeriod,revision,snapshot]);

  async function mutate(work:()=>Promise<unknown>){
    if(mutationLock.current||busy||!connected)return;
    mutationLock.current=true;
    alert.stop();const current=generation.current;setBusy(true);setError('');setConnected(false);
    try{await work();}catch(e){if(current===generation.current&&e instanceof DriverApiError&&e.code==='FINAL_FARE_REQUIRED'){setCompleting(rides.find(r=>r.status==='InProgress')??null);setCollectedFare('');}else if(current===generation.current)qaTone('error',browserUuid());if(current===generation.current)setError(/^[\u0600-\u06ff\s،؛؟.…0-9٠-٩()\-]+$/.test((e as Error).message)?(e as Error).message:'تعذر إكمال العملية، حاول مرة أخرى.');}
    finally{mutationLock.current=false;if(current===generation.current){setBusy(false);setRevision(r=>r+1);}}
  }
  async function progressRide(ride:DriverRide,status:DriverRide['status'],amount?:number){
    const current=generation.current;const fresh=await api.transition(ride,status,amount);
    if(current!==generation.current||!fresh)return;
    if(status==='Accepted'&&fresh.status==='Accepted')qaTone('accepted',ride.id);
    details.current.set(ride.id,fresh);
    setRides(old=>['Completed','Cancelled','Rejected'].includes(fresh.status)?old.filter(r=>r.id!==ride.id):old.map(r=>r.id===ride.id?fresh:r));
    driverTrace('ride-state-applied',{status:fresh.status});
  }

  if(!authReady)return <div role="status" className="p-12 text-center">جارٍ استعادة جلسة السائق…</div>;
  if(!profile)return <main dir="rtl" className="taxi-surface driver-theme h-full overflow-auto bg-slate-50 p-4" style={{paddingTop:"max(1rem, env(safe-area-inset-top))",paddingBottom:"max(1rem, env(safe-area-inset-bottom))"}}><form className="mx-auto my-8 max-w-md space-y-5 rounded-2xl border bg-white p-6" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{alert.unlock();const driver=await api.login(tenant.trim(),username.trim(),password,remember);setPassword('');setProfile(driver);setRevision(r=>r+1);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>
    <img src={logoSrc} width="88" height="88" alt="تكسي نابلس والمهندس"/><p className="text-sm">تكسي نابلس والمهندس · تطبيق السائق</p><h1 className="text-2xl font-bold">تسجيل دخول السائق</h1>
    <label className="block">اسم المستخدم<input className={input} required autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)}/></label>
    <label className="block">كلمة المرور<input className={input} required type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
    <label className="flex items-center gap-2"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/>حفظ تسجيل الدخول</label><TaxiTheme/>{error&&<p role="alert" className="text-red-700">{/^[\u0600-\u06ff\s،؛.!؟…«»]+$/.test(error)?error:'تعذر إكمال العملية. حاول مرة أخرى.'}</p>}<button className={`${button} w-full bg-yellow-400 text-black`} disabled={busy}>{busy?'جارٍ الدخول…':'دخول'}</button>
  </form></main>;

  const rideActions=(ride:DriverRide)=><div className="driver-ride-actions flex flex-wrap gap-2">{ride.status==='Assigned'?<><button className={`${button} flex-1 driver-accept`} disabled={busy||!connected||!!ride.offerExpiresAt&&Date.parse(ride.offerExpiresAt)<=now} onClick={()=>void mutate(()=>progressRide(ride,'Accepted'))}>قبول</button><button className={`${button} flex-1 driver-reject`} disabled={busy||!connected||!!ride.offerExpiresAt&&Date.parse(ride.offerExpiresAt)<=now} onClick={()=>void mutate(()=>api.reject(ride))}>رفض</button></>:<button className={`${button} w-full bg-yellow-400 text-black`} disabled={busy||!connected} onClick={()=>{if(ride.status==='InProgress'&&ride.finalFare==null&&!(ride.fareMode==='GPS_METER'&&ride.meterCalculatedFare!=null)){setCollectedFare('');setCompleting(ride);return;}void mutate(()=>progressRide(ride,ride.status==='Accepted'?'DriverArriving':ride.status==='DriverArriving'?'Arrived':ride.status==='Arrived'?'InProgress':'Completed'));}}>{ride.status==='Accepted'?'في الطريق إلى الزبون':ride.status==='DriverArriving'?'وصلت للزبون':ride.status==='Arrived'?'بدء الرحلة':'إنهاء الرحلة'}</button>}</div>;
  const rideFare=(ride:DriverRide)=><div className="trip-fare inline-flex flex-wrap items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-white">{ride.fareMode==='GPS_METER'&&ride.status==='InProgress'?<div role="status"><b>العداد يعمل</b><p>{driverTripMetrics(ride,now).distance} كم · {driverTripMetrics(ride,now).minutes} دقيقة</p><p className="text-base font-bold">السعر الحالي: {driverTripMetrics(ride,now).fare??'—'} {ride.currency==='ILS'||!ride.currency?'₪':ride.currency}</p></div>:<><p className="text-sm">السعر:</p><p className="text-base font-bold tabular-nums">{ride.finalFare!=null?`${ride.finalFare} ${!ride.currency||ride.currency==='ILS'?'₪':ride.currency}`:'السعر لم يحدد بعد'}</p>{ride.status==='InProgress'&&<p>{driverTripMetrics(ride,now).minutes} دقيقة</p>}</>}</div>;
  const nativeVersion=(globalThis as typeof globalThis&{dispatchProDriverAppVersion?:string}).dispatchProDriverAppVersion;
  return <main dir="rtl" className="taxi-surface driver-theme driver-main h-full bg-slate-50">{(globalThis as typeof globalThis&{dispatchProDriverQa?:boolean}).dispatchProDriverQa&&<div className="driver-qa-badge">QA · بيئة اختبار معزولة · لا طلبات تشغيل</div>}<div className="driver-workspace mx-auto max-w-xl space-y-2">
    <RideCommunicationControl request={api.chat} rides={isQaAudio()?[...rides,{id:profile.id,status:'Accepted'}]:rides}/>
    {isQaAudio()&&tab==='office'&&<section aria-label="اتصال مكتب الاختبار" className="rounded-xl border bg-white p-3"><button className={`${button} mb-3`} onClick={()=>setTab('rides')}>العودة للرحلة</button><RideCallButton rideId={profile.id} label="اتصال داخلي بمكتب QA"/><RideChat rideId={profile.id} request={api.chat} label="محادثة مكتب QA"/></section>}
    {streetOpen&&<DriverStreetRideForm initialPickup={driverPoint&&Date.now()-driverPoint.at<=120000?driverPoint:profile.locationStatus==='READY'&&profile.locationLatitude!=null&&profile.locationLongitude!=null?{latitude:profile.locationLatitude,longitude:profile.locationLongitude}:undefined} places={()=>api.places()} sendLocation={value=>api.location(value)} onClose={()=>setStreetOpen(false)} save={async value=>{if(mutationLock.current||!connected)throw Error('انتظر اتصال المكتب');if(rides.length>0)throw Error('أنهِ الرحلة الحالية أولا');mutationLock.current=true;try{await api.streetRide(value);setStreetOpen(false);}finally{mutationLock.current=false;setConnected(false);setRevision(r=>r+1);}}}/>}
    {editing&&<RideLocationEditor ride={editing} places={()=>api.places()} onClose={()=>setEditing(null)} save={async input=>{if(mutationLock.current||!connected)throw Error('انتظر تحديث بيانات الرحلة');mutationLock.current=true;try{await api.locations(editing,input);}finally{mutationLock.current=false;setConnected(false);setRevision(r=>r+1);}}}/>}
    <Dialog open={!!completing} onOpenChange={open=>{if(!open&&!busy)setCompleting(null);}}><DialogContent dir="rtl" className="max-w-sm"><DialogTitle>أدخل المبلغ الذي تم تحصيله من الزبون</DialogTitle><DialogDescription>لن تنتهي الرحلة قبل حفظ السعر النهائي.</DialogDescription><form className="space-y-4" onSubmit={event=>{event.preventDefault();const ride=rides.find(r=>r.id===completing?.id);const amount=Number(collectedFare);if(!ride||collectedFare.trim()===''||!Number.isFinite(amount)||amount<0)return;void mutate(async()=>{await progressRide(ride,'Completed',amount);setCompleting(null);setCollectedFare('');});}}><label>السعر (شيكل)<input autoFocus className={input} type="number" min="0" max="10000000" step="0.01" required value={collectedFare} onChange={event=>setCollectedFare(event.target.value)}/></label>{error&&<p role="alert" className="text-red-700">{/^[\u0600-\u06ff\s،؛.!؟…«»]+$/.test(error)?error:'تعذر إكمال العملية. حاول مرة أخرى.'}</p>}<button className={`${button} w-full bg-yellow-400 text-black`} disabled={busy||!connected}>تأكيد وإنهاء الرحلة</button></form></DialogContent></Dialog>
    <header data-driver-header className="sticky top-0 z-30 flex flex-wrap min-[375px]:flex-nowrap items-center justify-between gap-2 rounded-xl border bg-white px-3 py-2"><img className="shrink-0" src={logoSrc} width="40" height="40" alt="تكسي نابلس والمهندس"/><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold">تكسي نابلس والمهندس</p><h1 title={profile.fullName} className="truncate text-base font-bold">{profile.fullName}</h1></div><p role="status" className={'driver-connection order-last basis-full min-[375px]:order-none min-[375px]:basis-auto min-[375px]:max-w-[42%] shrink-0 text-xs '+(connected?'text-green-700':'text-amber-700')}>{isQaAudio()&&!connected?connection:driverConnectionLabel(connected,navigator.onLine)}</p>{isQaAudio()&&<button className="min-h-12 min-w-12 shrink-0 rounded-xl border px-2" onClick={()=>setTab(tab==='office'?'rides':'office')}>المكتب{officeUnread>0?` (${officeUnread})`:null}</button>}<button aria-label="إعدادات السائق" className="min-h-11 min-w-11 shrink-0 rounded-xl border" onClick={()=>setTab(tab==='settings'?'rides':'settings')}><Settings size={22} aria-hidden="true"/></button></header>
    {tab==='rides'&&<div className="driver-duty"><strong className={profile.status==='Available'?'available':profile.status==='Busy'?'busy':'offline'}>{profile.status==='Available'?'متاح':profile.status==='Busy'?'مشغول':'غير متصل'}</strong>{locationActive&&<span>{background?'وضع العمل بالخلفية فعال':(globalThis as typeof globalThis&{dispatchProDriverNative?:boolean}).dispatchProDriverNative?'فعّل صلاحية الموقع للعمل بالخلفية':'مشاركة الموقع أثناء فتح التطبيق'}</span>}</div>}
    {tab==='settings'&&<section aria-label="إعدادات السائق" className="space-y-4 rounded-xl border bg-white p-4"><h2 className="font-bold">الإعدادات</h2><label className="block text-sm">التطبيق المسؤول عن المخشير<select className="mt-1 min-h-12 w-full rounded border px-2" value={radioOwner?"driver":"tnm"} onChange={e=>chooseRadioOwner(e.target.value==="driver")}><option value="driver">NM Driver · يعمل بكل الوظائف وحده</option><option value="tnm">مخشير TNM المستقل</option></select></label>{radioOwner&&<DriverExternalPtt/>}{([['notifications','الإشعارات'],['sound','صوت التنبيهات'],['vibration','الاهتزاز']] as const).map(([key,label])=><label key={key} className="flex min-h-11 items-center justify-between">{label}<input type="checkbox" checked={preferences[key]} onChange={e=>{setPreferences((v:typeof preferences)=>({...v,[key]:e.target.checked}));if(key==='notifications'&&e.target.checked)void enableBrowserNotifications();}}/></label>)}<fieldset className="space-y-3"><legend className="font-bold">الصوت</legend>{([['orderTone','نغمة الطلب'],['publicTone','نغمة بدء العام'],['privateTone','نغمة الخاص'],['floorTone','نغمة تأكيد المخشيرة']] as const).map(([key,label])=><div key={key} className="flex flex-wrap items-center gap-2"><label className="flex-1">{label}<select className="min-h-12 w-full rounded-lg border px-3" value={preferences[key]} onChange={e=>setPreferences((v:typeof preferences)=>({...v,[key]:Number(e.target.value)}))}>{toneChoices.map(n=><option key={n} value={n}>نغمة {n}</option>)}</select></label><button type="button" className="min-h-12 rounded-lg border px-4" onClick={()=>previewDriverTone(preferences[key])}>تجربة</button></div>)}</fieldset><p>GPS: {gpsStatus|| (profile.locationStatus==='READY'?'مسموح':'بانتظار الإذن')}</p><p>الخدمة بالخلفية: {(globalThis as typeof globalThis&{dispatchProDriverBackground?:boolean}).dispatchProDriverBackground?'قيد التشغيل':'تحتاج تطبيق Android'}</p><DriverDiagnostics connected={connected} gpsFresh={profile.locationStatus==='READY'}/><p>إصدار التطبيق: {nativeVersion??((globalThis as typeof globalThis&{dispatchProDriverNative?:boolean}).dispatchProDriverNative?'غير متاح':'واجهة الويب')}</p><button className={button} onClick={clearSession}>تسجيل الخروج</button><button className={button} onClick={()=>setTab('rides')}>عودة للخريطة</button><details><summary className="min-h-11 cursor-pointer">رحلاتي</summary><div className="flex flex-wrap gap-2">{[['history','سجل الرحلات'],['earnings','الأرباح'],['notifications','الإشعارات']].map(([key,label])=><button className="min-h-11 rounded border px-3" key={key} onClick={()=>setTab(key)}>{label}</button>)}</div></details></section>}
    {tab!=='rides'&&tab!=='settings'&&<button className={button} onClick={()=>setTab('rides')}>عودة للخريطة</button>}
    {tab==='rides'&&<div className="driver-health" role="status"><span>{isQaAudio()&&!connected?connection:driverConnectionLabel(connected,navigator.onLine)}</span><span>GPS: {gpsStatus||(profile.locationStatus==='READY'?'جاهز':'بانتظار الموقع')}</span></div>}
    {tab==='rides'&&<DriverJourneyMap driver={driverPoint&&Date.now()-driverPoint.at<=120000?driverPoint:undefined} pickup={rides[0]?.latitude!=null&&rides[0]?.longitude!=null?{latitude:rides[0].latitude,longitude:rides[0].longitude}:undefined} destination={rides[0]?.destinationLatitude!=null&&rides[0]?.destinationLongitude!=null?{latitude:rides[0].destinationLatitude,longitude:rides[0].destinationLongitude}:undefined} compact active={!!rides.length} summary={rides[0]?.status==='Assigned'?<DriverOfferDetails ride={rides[0]} now={now}/>:rides[0]?<><div className="driver-summary-heading"><strong>{rides[0].fullName||"الزبون"}</strong><span>{statusLabel[rides[0].status]}</span></div><p>الانطلاق: {rides[0].pickup||"يحدده المكتب"}</p><p>الوجهة: {rides[0].destination?.trim()||"الوجهة غير محددة"}</p>{rides[0].finalFare!=null&&<p>السعر: {rides[0].finalFare} {rides[0].currency==='ILS'||!rides[0].currency?'₪':rides[0].currency}</p>}</>:undefined}/>}
    {tab==='rides'&&!rides.length&&<div className="flex gap-2"><button className={button+' flex-1 bg-green-100'} disabled={busy||!connected||profile.status==='Available'} onClick={()=>void mutate(()=>api.availability('Available'))}>متاح</button><button className={button+' flex-1'} disabled={busy||!connected||profile.status==='Offline'} onClick={()=>void mutate(()=>api.availability('Offline'))}>غير متاح</button></div>}

    {tab==='earnings'&&<div className="flex gap-2" aria-label="فترة الأرباح">{[['today','اليوم'],['week','هذا الأسبوع'],['month','هذا الشهر']].map(([period,label])=><button key={period} aria-pressed={earningsPeriod===period} className={earningsPeriod===period?'min-h-11 rounded-xl bg-yellow-400 px-4 text-black':'min-h-11 rounded-xl border px-4'} onClick={()=>{setEarningsPeriod(period);setEarningsPage(1);}}>{label}</button>)}</div>}{tab==='earnings'&&<EarningsPage data={earnings} failed={earningsFailed} retry={()=>setRevision(r=>r+1)} page={earningsPage} setPage={setEarningsPage} connected={connected}/>}
    {tab==='account'&&<section className="space-y-3 rounded-xl border bg-white p-4"><h2 className="text-xl font-bold">حسابي</h2><p>{profile.fullName}</p><button className={button} onClick={()=>setTab('notifications')}>الإشعارات ({snapshot?.notices.filter(n=>!read.includes(n.id)).length??0})</button></section>}
    {tab==='rides'&&!rides.length&&<div className="rounded-xl border bg-white p-2"><button className={`${button} w-full bg-yellow-400 text-black`} disabled={busy} onClick={()=>setStreetOpen(true)}>{streetRideLabel}</button><p className="mt-2 text-sm text-slate-600">تسجيل رحلة مباشرة</p></div>}
    {api.pendingCount?.()>0&&<p role="status">إجراء بانتظار عودة الاتصال</p>}
    {error&&<p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-red-800">{/^[\u0600-\u06ff\s،؛.!؟…«»]+$/.test(error)?error:'تعذر إكمال العملية. حاول مرة أخرى.'}</p>}
    {tab==='rides'&&<section aria-label="الطلب الحالي" className="driver-order-cards driver-trip-sheet relative space-y-3">{rides.map(ride=><article key={ride.id} className={`space-y-2 rounded-xl border p-3 ${ride.status==='Assigned'?'border-yellow-500 bg-yellow-50':'bg-white'}`}>
      {ride.source==='DRIVER_STREET'&&<p className="font-bold text-blue-700">{streetRideLabel}</p>}
      <div className="flex items-center justify-between gap-2"><h2 className="text-base font-bold">{statusLabel[ride.status]}</h2><span className="text-sm">{ride.status==='Assigned'?(profile.vehicleNumber||profile.plate||''):(ride.fullName||'الزبون')}</span></div>
      {['Accepted','DriverArriving','Arrived','InProgress'].includes(ride.status)&&<div className="trip-contact-actions flex flex-wrap gap-2"><RideCallButton rideId={ride.id} disabled={!connected||busy}/><RideChat rideId={ride.id} request={api.chat}/></div>}
      {ride.status!=='Assigned'&&ride.offerDistanceMeters!=null&&<p>المسافة إلى الزبون: {(ride.offerDistanceMeters/1000).toFixed(1)} كم تقريبًا</p>}

      {ride.status!=='Assigned'&&ride.status!=='InProgress'&&<p className="trip-address"><strong>الالتقاء:</strong> {ride.pickup||'يحدده المكتب'}</p>}{ride.status!=='Assigned'&&<p><strong>إلى:</strong> {ride.destination?.trim()||'الوجهة غير محددة'}</p>}
      {ride.status!=='Assigned'&&ride.fullName&&<p><strong>الراكب:</strong> {ride.fullName}</p>}{ride.notes&&<p><strong>ملاحظات:</strong> {ride.notes}</p>}
      {ride.status!=='Assigned'&&ride.phone&&<p className="nm-trip-phone"><bdi>{ride.phone}</bdi> · هاتف الزبون</p>}
      {ride.id!==rides[0]?.id&&rideActions(ride)}
      {ride.id!==rides[0]?.id&&rideFare(ride)}
      {profile.allowDriverManualFare&&ride.fareMode!=='GPS_METER'&&['Accepted','DriverArriving','Arrived','InProgress'].includes(ride.status)&&<form className="flex flex-wrap items-end gap-2" onSubmit={e=>{e.preventDefault();const amount=Number(new FormData(e.currentTarget).get('amount'));if(Number.isFinite(amount))void mutate(()=>api.fare(ride,amount));}}><label className="flex-1">تحديد سعر المشوار<input className={input} name="amount" type="number" min="0" max="10000000" step="0.01" required defaultValue={ride.finalFare??''}/></label><button className={button} disabled={busy||!connected}>حفظ السعر</button></form>}
      {ride.status==='Assigned'&&ride.latitude!=null&&ride.longitude!=null&&<a target="_blank" rel="noopener noreferrer" className="block text-blue-700 underline" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${ride.latitude},${ride.longitude}`)}`}>عرض الموقع على الخريطة</a>}

      {['Accepted','DriverArriving','Arrived','InProgress'].includes(ride.status)&&<>{(ride.status==='InProgress'?ride.destinationLatitude!=null&&ride.destinationLongitude!=null:ride.latitude!=null&&ride.longitude!=null)&&<a className="trip-navigation inline-flex min-h-12 items-center gap-2 rounded-xl border px-3 text-sm font-bold" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${ride.status==='InProgress'?ride.destinationLatitude:ride.latitude},${ride.status==='InProgress'?ride.destinationLongitude:ride.longitude}&travelmode=driving`}><Navigation size={18} aria-hidden="true"/>ملاحة</a>}</>}



      {['Accepted','DriverArriving','Arrived','InProgress'].includes(ride.status)&&<details><summary className="min-h-12 cursor-pointer">خيارات الرحلة</summary><button className={button} disabled={busy||!connected} onClick={()=>setEditing(ride)}>تعديل الوجهة</button>{ride.destinationLatitude!=null&&ride.destinationLongitude!=null&&<a target="_blank" rel="noopener noreferrer" className="block text-blue-700 underline" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${ride.destinationLatitude},${ride.destinationLongitude}`)}`}>الوجهة على الخريطة</a>}</details>}
      {['Accepted','DriverArriving','Arrived','InProgress'].includes(ride.status)&&<><details className="space-y-2 border-t pt-2"><summary className="min-h-12 cursor-pointer">بيانات الزبون</summary><p><strong>العميل:</strong> {ride.fullName||'غير مسجل'}</p>{ride.phone&&<p><bdi>{normalizePhone(ride.phone)}</bdi></p>}<p><strong>العنوان:</strong> {[ride.addressText,ride.neighborhood,ride.street].filter(Boolean).join(' · ')||ride.pickup}</p>{ride.notes&&<p><strong>ملاحظات:</strong> {ride.notes}</p>}{ride.latitude!=null&&ride.longitude!=null&&<a target="_blank" rel="noopener noreferrer" className="block text-blue-700 underline" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${ride.latitude},${ride.longitude}`)}`}>عرض الموقع على الخريطة</a>}</details></>}
    </article>)}{!rides.length&&<p className="rounded-xl border bg-white p-6">{connected?(profile.status==='Available'?'متاح · بانتظار طلب جديد':'فعّل متاح لاستقبال الطلبات'):'جارٍ استعادة حالة الطلبات…'}</p>}</section>}
    {tab==='rides'&&!!snapshot?.jobs?.length&&<section aria-label="الرحلات المنتظرة" className="space-y-3 rounded-xl border bg-white p-4"><h2 className="font-bold">الرحلات المنتظرة ({snapshot?.jobs?.length??0})</h2><p className="text-sm">يُرسل الطلب التالي بعد إنهاء الرحلة الحالية. الترتيب يحدده المكتب.</p><ol className="space-y-2">{snapshot?.jobs?.map((job,index)=><li key={job.id} className="break-words rounded-lg border p-3">{index+1}. {job.pickup} ← {job.destination||'غير محددة'}</li>)}</ol></section>}
    {tab==='history'&&<section className="space-y-3"><h2 className="font-bold">سجل الرحلات</h2>{!history?<p role="status">جارٍ التحميل…</p>:<>{history.items.map(ride=><article className="rounded-xl border bg-white p-4" key={ride.id}><p>{statusLabel[ride.status]}</p>{ride.source==='DRIVER_STREET'&&<p>{streetRideLabel}</p>}<p>{ride.pickup} ← {ride.destination?.trim()||'الوجهة غير محددة'}</p><p>{ride.finalFare!=null?`سعر المشوار: ${ride.finalFare} ${ride.currency??"ILS"}`:"السعر لم يحدد بعد"}</p><time>{new Date(ride.createdAt).toLocaleString('ar')}</time></article>)}{!history.items.length&&<p>لا توجد رحلات سابقة.</p>}<div className="flex gap-3"><button className={button} disabled={page===1||!connected} onClick={()=>setPage(p=>p-1)}>السابق</button><span>صفحة {page}</span><button className={button} disabled={page*20>=history.total||!connected} onClick={()=>setPage(p=>p+1)}>التالي</button></div></>}</section>}
    {tab==='notifications'&&<section className="space-y-3"><h2 className="font-bold">الإشعارات</h2><button className={button} onClick={()=>void enableBrowserNotifications().then(result=>setNotificationPermission(result==='granted'?'تم تفعيل إشعارات المتصفح':result==='denied'?'اسمح بالإشعارات من إعدادات المتصفح':'الإشعارات داخل التطبيق متاحة'))}>تفعيل إشعارات المتصفح</button>{notificationPermission&&<p role="status">{notificationPermission}</p>}<p className="text-sm text-slate-600">فعّل وضع العمل في تطبيق Android لاستقبال الطلبات بالخلفية. بعد العودة تتحدث حالة الرحلة تلقائيًا.</p><button className={button} onClick={()=>setRead(snapshot?.notices.map(n=>n.id)??[])}>تعليم الكل كمقروء</button>{snapshot?.notices.map(notice=><article key={notice.id} className={`rounded-xl border p-3 ${read.includes(notice.id)?'bg-white':'bg-yellow-50'}`}><p>{noticeLabel(notice.action)}</p><time>{new Date(notice.createdAt).toLocaleString('ar')}</time></article>)}</section>}

  </div>
    {tab==='rides'&&rides[0]&&<footer aria-label="إجراءات الطلب الحالي" className="driver-action-dock">{rideFare(rides[0])}{rideActions(rides[0])}</footer>}
    {radioOwner&&<><div className="driver-radio-space" aria-hidden="true"/><DriverVoice request={api.voice}/></>}
  </main>;
}
