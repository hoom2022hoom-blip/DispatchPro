import {browserUuid} from './browser-id.js';
import {normalizeDriverRide,normalizeDriverProfile,normalizeDriverSnapshot} from './driver-payload.js';
import {driverTrace} from './driver-runtime-diagnostics.js';
import {qaConnectionFailure,qaHttpFailure} from './qa-connection-error.js';
export function driverDeviceId(){try{let id=localStorage.getItem('dispatchpro.driver.device');if(!id){id=browserUuid();localStorage.setItem('dispatchpro.driver.device',id);}return id;}catch{return browserUuid();}}
export type DriverRide = { source?:string; startedAt?:string; completedAt?:string; fareMode?:string; fareSource?:string|null; finalFare?:number|null; meterCalculatedFare?:number|null; currency?:string; distanceKm?:number|null; durationSeconds?:number|null; waitingSeconds?:number|null; meterStartedAt?:string|null; id: string; status: 'Pending'|'Assigned'|'Accepted'|'DriverArriving'|'Rejected'|'Arrived'|'InProgress'|'Completed'|'Cancelled'; version: number; pickup: string; destination: string; notes?: string; fullName?: string; phone?: string; addressText?: string; neighborhood?: string; street?: string; latitude?: number; longitude?: number; destinationLatitude?: number; destinationLongitude?: number; offerDistanceMeters?:number|null; offerEtaSeconds?:number|null; estimatedPrice?:number|null; offerExpiresAt?:string|null };
export type DriverProfile = {gpsEnabled?:boolean;driverAppEnabled?:boolean; vehicleNumber?:string;plate?:string; allowDriverManualFare?:boolean; id:string; fullName:string; status:'Offline'|'Available'|'Busy'|'Suspended'; currentVehicleId:string|null; locationStatus?:'READY'|'NO_LOCATION'|'STALE_LOCATION'|'POOR_ACCURACY'; locationUpdatedAt?:string|null; locationLatitude?:number|null; locationLongitude?:number|null; locationAccuracy?:number|null };
export type Notice = { id:string; action:string; entityId:string; createdAt:string };
export type EarningsSummary = {date:string;timeZone:string;completedTrips:number;missingFareTrips:number;totals:{currency:string;amount:number}[]};
export type DriverEarnings = {summary:EarningsSummary;page:number;total:number;items:Pick<DriverRide,'id'|'pickup'|'destination'|'completedAt'|'finalFare'|'currency'|'fareMode'|'fareSource'>[]};
export type DriverSnapshot = { earnings?:EarningsSummary; driver:DriverProfile; rides:DriverRide[]; notices:Notice[]; jobs?:import('./driver-jobs').DriverJob[] };
export type StreetRideInput = {id:string;destination:NonNullable<import('../components/ride-location-editor').LocationUpdate['destination']>;pickup?:NonNullable<import('../components/ride-location-editor').LocationUpdate['pickup']>;notes?:string;fareMode:'DRIVER_MANUAL'|'GPS_METER';destinationPlaceId?:string;pickupPlaceId?:string};
export type RideHistory = { page:number; total:number; items:(DriverRide & {createdAt:string})[] };
type PendingDriverAction={id:string;path:string;body:unknown;createdAt:number;rideId?:string;version?:number;status?:string};
export type DriverSession = {outbox?:PendingDriverAction[];snapshot?:DriverSnapshot;token:string;refreshToken?:string;tenant:string;profile:DriverProfile};
export type DriverSessionStorage = {load:()=>Promise<DriverSession|null>;save:(value:DriverSession|null,remember?:boolean)=>Promise<void>};
const driverSessionKey="dispatchpro.driver.session.v1";
const browserSessionStorage:DriverSessionStorage={async load(){try{return JSON.parse(globalThis.localStorage?.getItem(driverSessionKey)??"null");}catch{return null;}},async save(value){try{if(value)globalThis.localStorage?.setItem(driverSessionKey,JSON.stringify(value));else globalThis.localStorage?.removeItem(driverSessionKey);}catch{}}};
export class DriverApiError extends Error { sessionInvalid=false; status:number; serverTime?:string; code?:string; constructor(status:number, message:string, serverTime?:string, code?:string) { super(message); this.status=status; this.serverTime=serverTime; this.code=code; } }
export function createDriverApi(fetchImpl: typeof fetch = (...args) => fetch(...args), storage:DriverSessionStorage = browserSessionStorage) {
  let token:string|null=null;
  let session=0;
  let identity:DriverSession|null=null;
  let ready=false;
  let persist=true;
  let bootstrapTask:Promise<DriverProfile|null>|null=null;
  let validationTask:Promise<boolean>|null=null;
  let primaryCheck:{token:string;task:Promise<number>}|null=null;
  let renewal:Promise<boolean>|null=null;
  const native=!!(globalThis as typeof globalThis&{dispatchProDriverStorage?:DriverSessionStorage}).dispatchProDriverStorage;
  async function renew(){if(!renewal){const previous=session;renewal=(async()=>{const r=await fetchImpl('/api/reception/auth/driver-refresh',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',...(native?{'X-Driver-Session':'native'}:{})},body:JSON.stringify(native?{refreshToken:identity?.refreshToken}:{}),signal:AbortSignal.timeout(15000)});if(previous!==session)return false;if(r.status===401){const detail=await r.json().catch(()=>({}));await clear();if(detail.code==='SESSION_REPLACED'){const error=new DriverApiError(401,'تم تسجيل الدخول إلى حسابك من جهاز آخر',undefined,detail.code);error.sessionInvalid=true;throw error;}return false;}if(!r.ok)throw new DriverApiError(0,'جاري إعادة الاتصال');const value=await r.json();token=value.accessToken;if(identity){identity={...identity,token:token!,...(value.refreshToken?{refreshToken:value.refreshToken}:{})};if(persist||native)await storage.save(identity,persist);}return true;})().finally(()=>{renewal=null;});}return renewal;}

  async function clear(){token=null;identity=null;session++;await storage.save(null);}
  async function primaryStatus(currentToken:string){
    if(!primaryCheck||primaryCheck.token!==currentToken){const task=fetchImpl('/api/reception/driver/me',{method:'GET',cache:'no-store',headers:{Authorization:'Bearer '+currentToken},signal:AbortSignal.timeout(15000)}).then(r=>r.status).catch(()=>0);primaryCheck={token:currentToken,task};void task.finally(()=>{if(primaryCheck?.task===task)primaryCheck=null;});}
    return primaryCheck.task;
  }
  async function validatePrimary(currentToken:string,currentSession:number){
    if(!validationTask){const task=(async()=>{try{const r=await fetchImpl('/api/reception/driver/me',{method:'GET',cache:'no-store',headers:{Authorization:'Bearer '+currentToken},signal:AbortSignal.timeout(15000)});if([401,403].includes(r.status)&&token===currentToken&&session===currentSession){await clear();return false;}return true;}catch{return true;}})();validationTask=task;void task.finally(()=>{if(validationTask===task)validationTask=null;});}
    return validationTask;
  }
  async function bootstrap(cachedOnly=false){
    if(ready)return identity?.profile??null;
    if(!bootstrapTask)bootstrapTask=(async()=>{
      const current=session;const saved=await storage.load();
      if(current!==session)return identity?.profile??null;
      if(!saved?.token||!saved.tenant||!saved.profile?.id){ready=true;return null;}
      const savedProfile=normalizeDriverProfile(saved.profile);
      token=saved.token;identity={...saved,profile:savedProfile};
      if(saved.snapshot){try{identity.snapshot=normalizeDriverSnapshot(saved.snapshot);}catch{delete identity.snapshot;}}
      if(cachedOnly){ready=true;return identity.profile;}
      try{const profile=await request<DriverProfile>('driver/me','GET',undefined,undefined,true);if(current!==session)return null;if(profile.id!==saved.profile.id){await clear();return null;}identity={...(identity??saved),token:token!,profile};if(persist||native)await storage.save(identity,persist);return profile;}
      catch(e){if(e instanceof DriverApiError&&e.sessionInvalid)return null;if(e instanceof DriverApiError&&e.status===403)throw e;return saved.profile;}
      finally{ready=true;}
    })().finally(()=>{bootstrapTask=null;});
    return bootstrapTask;
  }
  const retryable=(status:number)=>status===0||status===429||status>=500&&status<=599;
  let flushing:Promise<void>|null=null;
  async function persistIdentity(){if((persist||native)&&identity)await storage.save(identity,persist);}
  async function action(path:string,body:unknown,ride?:DriverRide,status?:string){
    const current=session;
    try{return await request(path,'PUT',body);}
    catch(e){
      if(!(e instanceof DriverApiError)||!retryable(e.status)||!identity||current!==session)throw e;
      const queue=identity.outbox??=[];
      const existing=queue.find(a=>a.path===path&&(!ride||a.version===ride.version));
      if(!existing){if(queue.length>=20)throw e;queue.push({id:browserUuid(),path,body,createdAt:Date.now(),...(ride?{rideId:ride.id,version:ride.version}:{}),status});await persistIdentity();}
      throw new DriverApiError(0,'حُفظ الإجراء؛ سيُرسل بعد عودة الاتصال والتحقق من الطلب');
    }
  }
  async function flush(){
    if(flushing)return flushing;
    flushing=(async()=>{const current=session;
      for(const action of [...identity?.outbox??[]]){
        if(current!==session||!identity)return;
        try{
          let valid=Date.now()-action.createdAt<=120000;
          if(valid&&action.rideId){const ride=await request<DriverRide>(`driver/rides/${action.rideId}`);valid=ride.version===action.version&&!(ride.status==='Assigned'&&ride.offerExpiresAt&&Date.parse(ride.offerExpiresAt)<=Date.now());}
          if(valid)await request(action.path,'PUT',action.body);
        }catch(e){if(!(e instanceof DriverApiError)||retryable(e.status))throw e;if(e.sessionInvalid)throw e;}
        if(current!==session||!identity)return;
        identity.outbox=(identity.outbox??[]).filter(a=>a.id!==action.id);await persistIdentity();
      }
    })().finally(()=>{flushing=null;});return flushing;
  }
  let locationClockOffset=0;
  let offerClock: {server:number; received:number}|null=null;
  async function request<T>(path:string, method='GET', body?:unknown, signal?:AbortSignal,restoring=false,retried=false):Promise<T> {
    if(!["auth/login","auth/driver-login"].includes(path)&&!restoring)await bootstrap();
    const requestToken=token,currentSession=session;
    if (!token && !['auth/login','auth/driver-login'].includes(path)) throw new DriverApiError(401,'سجّل الدخول أولًا');
    const response=await fetchImpl(`/api/reception/${path}`, {method,cache:'no-store',headers:{...(path==='auth/driver-login'&&native?{'X-Driver-Session':'native'}:{}),...(token?{Authorization:`Bearer ${token}`} : {}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(35000)]):AbortSignal.timeout(15000)}).catch(e=>{if(signal?.aborted)throw e;if((globalThis as any).dispatchProDriverQa){const classified=qaConnectionFailure(e,globalThis.navigator?.onLine!==false);throw new DriverApiError(0,classified.message,undefined,classified.code);}throw new DriverApiError(0,'تعذر الاتصال بالمكتب. تحقق من الإنترنت وأعد المحاولة.');});
    if(!response.ok&&path.endsWith('/status'))driverTrace('transition-http',{http:response.status});
    if(response.status===401){const detail=await response.clone().json().catch(()=>({}));if(detail.code==='SESSION_REPLACED'&&session===currentSession){await clear();const error=new DriverApiError(401,'تم تسجيل الدخول إلى حسابك من جهاز آخر',undefined,detail.code);error.sessionInvalid=true;throw error;}}
    if(response.status===401&&!['auth/login','auth/driver-login'].includes(path)&&!retried&&session===currentSession){
      // An optional endpoint's 401 does not prove the account has expired.
      // Verify the primary identity before renewing or removing durable credentials.
      if(path!=='driver/me'&&token===requestToken){
        const status=await primaryStatus(requestToken!);
        if(session!==currentSession)throw new DriverApiError(0,'تغيّرت الجلسة؛ أعد المحاولة');
        if(status===200)throw new DriverApiError(401,'تعذر تفويض هذا الطلب؛ أعد المحاولة');
        if(status===403){await clear();const denied=new DriverApiError(403,'حساب السائق غير متاح أو لا يملك الصلاحية');denied.sessionInvalid=true;throw denied;}
        if(status!==401)throw new DriverApiError(0,'جاري إعادة الاتصال');
      }
      if(token!==requestToken&&token||await renew())return request<T>(path,method,body,signal,true,true);const expired=new DriverApiError(401,'انتهت صلاحية الجلسة');expired.sessionInvalid=true;throw expired;
    }
    if(!response.ok){const detail=await response.json().catch(()=>({}));let invalid=false;
      if((globalThis as any).dispatchProDriverQa&&response.status>=500){const classified=qaHttpFailure(response.status,detail);if(classified)throw new DriverApiError(response.status,classified.message,detail.serverTime,classified.code);}
      if(response.status===403&&path==='driver/me'&&token===requestToken&&session===currentSession){await clear();invalid=true;}
      else if(response.status===403&&path.startsWith('driver/updates')&&token===requestToken&&session===currentSession)invalid=!(await validatePrimary(requestToken!,currentSession));
      if(response.status===401&&!['auth/login','auth/driver-login'].includes(path)&&token===requestToken&&session===currentSession){if(path==='driver/me'){await clear();invalid=true;}else invalid=!(await validatePrimary(requestToken!,currentSession));}
      const error=new DriverApiError(response.status,response.status===401?(['auth/login','auth/driver-login'].includes(path)?'بيانات الدخول غير صحيحة':invalid?'انتهت الجلسة؛ سجّل الدخول مجددًا':'تعذر تفويض هذا الطلب؛ أعد المحاولة'):response.status===403?'حساب السائق غير متاح أو لا يملك الصلاحية':response.status===409?(detail.error??detail.detail??'تغيّر الطلب؛ تم تحديث البيانات، راجع الحالة قبل المحاولة'):detail.error??detail.detail??'تعذر الاتصال بالمكتب',detail.serverTime,detail.code);error.sessionInvalid=invalid;throw error;}
    if(path!=='auth/login'&&currentSession!==session)throw new DriverApiError(0,'تغيّرت الجلسة؛ أعد المحاولة');
    if(process.env.NODE_ENV==='development'&&(globalThis as typeof globalThis&{dispatchProDevelopment?:boolean}).dispatchProDevelopment)performance.mark('driver-backend-response');
    if(path.endsWith('/status'))driverTrace('transition-http',{http:response.status});
    return response.json();
  }
  return {
    chat<T>(path:string,method='GET',body?:unknown,signal?:AbortSignal){return request<T>('driver/'+path,method,body,signal);},
    voice<T>(path:string,method='GET',body?:unknown,signal?:AbortSignal){return request<T>(path,method,body,signal);},
    bootstrap,
    cachedSnapshot(){return identity?.snapshot??null;},
    pendingCount(){return identity?.outbox?.length??0;},
    authenticated(){return !!token;},
    sessionIdentity(){return identity?{tenant:identity.tenant,driverId:identity.profile.id}:null;},
    async login(tenant:string,username:string,password:string,rememberMe=true) {const clearing=clear(),current=session;await clearing;if(current!==session)throw new DriverApiError(0,'تغيّرت جلسة الدخول');persist=rememberMe;ready=true;const login=await request<{accessToken:string;refreshToken?:string;tenant?:string}>('auth/driver-login','POST',{tenant:tenant.trim(),username:username.trim(),password,deviceId:driverDeviceId()});if(current!==session)throw new DriverApiError(401,'أُغلقت الجلسة');token=login.accessToken;try{const profile=await request<DriverProfile>('driver/me');if(current!==session)throw new DriverApiError(401,'أُغلقت الجلسة');identity={token:token!,...(login.refreshToken?{refreshToken:login.refreshToken}:{}),tenant:login.tenant||tenant.trim(),profile};if(persist||native)await storage.save(identity,persist);if(current!==session)throw new DriverApiError(0,'تغيّرت جلسة الدخول');return profile;}catch(e){if(current===session)await clear();throw e;} },
    logout(){void fetchImpl('/api/reception/auth/driver-logout',{method:'POST',headers:{'Content-Type':'application/json',...(native?{'X-Driver-Session':'native'}:{})},body:JSON.stringify(native?{refreshToken:identity?.refreshToken}:{}),signal:AbortSignal.timeout(15000)}).catch(()=>{});void clear();ready=true;offerClock=null;},
    offerNow(){return offerClock?offerClock.server+performance.now()-offerClock.received:Date.now();},
    async updates(cursor='',signal?:AbortSignal,options?:{reconcileOnly?:boolean}){
      if(!options?.reconcileOnly)await flush();
      const current=session;
      const response=await request<{cursor:string;data:DriverSnapshot;serverTime?:string}>(`driver/updates?cursor=${encodeURIComponent(cursor)}`,'GET',undefined,signal);
      const update={...response,data:normalizeDriverSnapshot(response?.data)};
      const server=Date.parse(update.serverTime??'');
      // Do not use the request midpoint: updates can long-poll for 25 seconds.
      // Monotonic elapsed time also survives changes to the phone's wall clock.
      if(current===session&&Number.isFinite(server))offerClock={server,received:performance.now()};
      if(identity&&current===session){const changed=JSON.stringify(identity.snapshot)!==JSON.stringify(update.data);identity.snapshot=update.data;identity.profile=update.data.driver;if(changed)await persistIdentity();}
      return update;
    },
    async ride(id:string,signal?:AbortSignal){const ride=normalizeDriverRide(await request<DriverRide>(`driver/rides/${id}`,'GET',undefined,signal));if(ride.id!==id)throw new DriverApiError(502,'تعذر التحقق من الرحلة؛ أعد المحاولة');return ride;},
    async location(input:{latitude:number;longitude:number;accuracy:number;capturedAt:string}){
      const captured=Date.parse(input.capturedAt),started=Date.now(),current=session;
      const send=()=>request('driver/location','PUT',{...input,capturedAt:new Date(captured+locationClockOffset).toISOString()});
      try{return await send();}catch(error){
        const finished=Date.now();
        const server=error instanceof DriverApiError?Date.parse(error.serverTime??''):NaN;
        // Translate the original fix into server time; never replace it with "now".
        // Only a fresh local fix and a short round trip may correct clock skew once.
        if(current!==session||!(error instanceof DriverApiError)||error.status!==400||!['FUTURE_LOCATION','STALE_LOCATION'].includes(error.message)||!Number.isFinite(server)||finished-started>10000||finished<started||finished-captured>60000||captured>started+10000)throw error;
        locationClockOffset=server-(started+finished)/2;
        return send();
      }
    },
    availability(status:'Available'|'Offline'){return action('driver/availability',{status});},
    streetRide(input:StreetRideInput){return request<{id:string;status:DriverRide['status'];version:number}>('driver/street-rides','POST',input);},
    async transition(ride:DriverRide,status:DriverRide['status'],collectedFare?:number){
      driverTrace('transition-start',{status});
      const committed=await action(`rides/${ride.id}/status`,{status,version:ride.version,...(collectedFare!==undefined?{collectedFare}:{})},ride,status) as Partial<DriverRide>;
      driverTrace('transition-committed',{status});
      // A mutation response is an entity, not the driver's complete presentation.
      // Re-read the authorized current ride, including customer/meter fields.
      try {
        const fresh=normalizeDriverRide(await request<DriverRide>(`driver/rides/${ride.id}`));
        if(fresh.id!==ride.id)throw new DriverApiError(502,'تعذر التحقق من الرحلة؛ أعد المحاولة');
        driverTrace('transition-hydrated',{status:fresh.status});return fresh;
      } catch(error) {
        // A confirmed mutation remains confirmed when a later read loses network.
        // Never synthesize success from a timeout or an unverified mutation body.
        if(error instanceof DriverApiError&&!error.sessionInvalid&&retryable(error.status)&&committed?.id===ride.id&&committed.status===status&&Number.isSafeInteger(committed.version)&&committed.version!>ride.version){
          driverTrace('transition-confirmed-read-pending',{status});
          return normalizeDriverRide({...ride,...committed} as DriverRide);
        }
        throw error;
      }
    },
    reject(ride:DriverRide){return action(`driver/rides/${ride.id}/reject`,{version:ride.version},ride,'Rejected');},
    fare(ride:DriverRide,amount:number){return request(`rides/${ride.id}/fare`,'PUT',{mode:'DRIVER_MANUAL',amount,version:ride.version});},
    places(){return request<import('../components/ride-location-editor').SuggestedPlace[]>('driver/places');},
    locations(ride:DriverRide,input:import('../components/ride-location-editor').LocationUpdate){return request(`rides/${ride.id}/locations`,'PUT',input);},
    history(page=1){return request<RideHistory>(`driver/history?page=${page}`);},
    earnings(page=1,period='today'){return request<DriverEarnings>(`driver/earnings?page=${page}&period=${period}`);},
  };
}
export const noticeLabel=(action:string)=>({Assigned:'طلب جديد',Accepted:'تم قبول الطلب',DriverArriving:'السائق في الطريق',Rejected:'تم رفض الطلب وإعادته للمكتب',Arrived:'وصل السائق',InProgress:'بدأت الرحلة',Completed:'انتهت الرحلة',Cancelled:'أُلغي الطلب',Removed:'تم سحب الطلب من السائق',Pending:'تحديث الطلب',Available:'السائق متاح',Offline:'السائق غير متاح'}[action.split('.').at(-1)!]??'تحديث الطلب');
