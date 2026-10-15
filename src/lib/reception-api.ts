import type { ReceptionBackend } from './reception-backend';
import type { Ride, Driver, Vehicle, Shift } from './types';
import type { QueueEntry } from './driver-queue';
import type { CallEvent } from './call-events';
import type { ApiCustomer, CustomerPlace, SavedAddress } from './customer-places';

export type ReceptionSnapshot = { rides: Ride[]; drivers: Driver[]; vehicles: Vehicle[]; shifts: Shift[]; queue: QueueEntry[]; queueLocations?: import('./office').QueueLocation[]; latest: CallEvent | null };
export class ReceptionApiError extends Error { status:number;sessionInvalid:boolean;constructor(status: number, message: string, sessionInvalid = status === 401) { super(message);this.status=status;this.sessionInvalid=sessionInvalid; } }
export type OfficeAuthState = { authReady:boolean; authenticated:boolean; tenant:string; tenantId?:string; userId?:string };
const dates = ['createdAt', 'updatedAt', 'scheduledTime', 'assignedAt', 'pickedUpAt', 'droppedOffAt', 'cancelledAt', 'completionTime', 'startTime', 'endTime'];
export function decodeReceptionSnapshot(input: ReceptionSnapshot): ReceptionSnapshot {
  const convert = <T>(row: T): T => {
    const result = { ...row } as Record<string, unknown>;
    for (const key of dates) if (typeof result[key] === 'string') result[key] = new Date(result[key] as string);
    return result as T;
  };
  return { ...input, rides: input.rides.map(convert), vehicles: input.vehicles.map(convert), shifts: input.shifts.map(convert) };
}

export function createApiReceptionBackend(fetchImpl: typeof fetch = (...args) => fetch(...args), restoreCookie=false) {
  let token: string | null = null;
  let sessionTenant = '';
  let renewable=false;
  let renewalTask:Promise<boolean>|null=null;
  let renewalTimer:ReturnType<typeof setTimeout>|undefined;
  const renewableKey='dispatchpro.office.renewable';
  let serverClockOffset = 0;
  const sessionNow = () => Date.now() + serverClockOffset;
  function syncSessionClock(response:Response) {
    const serverDate = Date.parse(response.headers.get('date') || '');
    if(Number.isFinite(serverDate))serverClockOffset=serverDate-Date.now();
  }
  const sessionKey = 'dispatchpro.external-office-session';
  const signedOutKey = 'dispatchpro.office.signed-out';
  let logoutTask:Promise<unknown> = Promise.resolve();
  const signedOut = () => { try { return typeof window !== 'undefined' && window.localStorage?.getItem(signedOutKey) === '1'; } catch { return false; } };
  let authState:OfficeAuthState = {authReady:false,authenticated:false,tenant:''};
  const authListeners = new Set<()=>void>();
  let bootstrapTask:Promise<void>|null=null;
  let validationTask:Promise<boolean>|null=null;
  const diagnostics:{method:string;path:string;status:number;authorizationPresent:boolean;authReady:boolean;jwtPresent:boolean;sessionInvalid?:boolean}[]=[];
  const publishAuth = (ready=true) => {
    let claims:Record<string,unknown>={};
    if(token)try{claims=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));}catch{}
    authState={authReady:ready,authenticated:!!token||renewable,tenant:sessionTenant,tenantId:typeof claims.tenant==='string'?claims.tenant:undefined,userId:typeof claims.sub==='string'?claims.sub:undefined};
    authListeners.forEach(listener=>listener());
  };
  const externalSession = () => typeof window !== 'undefined' && window.location?.protocol === 'https:' && !['localhost','127.0.0.1','[::1]'].includes(window.location.hostname);
  function clearSession() {
    token = null; sessionTenant = '';renewable=false;clearTimeout(renewalTimer);
    if(typeof window!=='undefined')try{window.localStorage?.removeItem(renewableKey);}catch{}
    if (typeof window !== "undefined") try { window.sessionStorage.removeItem(sessionKey); } catch { /* Storage may be disabled. */ }
    publishAuth();
  }
  function restoreSession() {
    if (typeof window === "undefined") return;
    if (signedOut()) return;
    if(restoreCookie)try{const hint=JSON.parse(window.localStorage?.getItem(renewableKey)||'null');if(hint){renewable=true;sessionTenant=hint.tenant||'';}}catch{}
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(sessionKey) || 'null');
      if (!saved) return;
      serverClockOffset=typeof saved.serverClockOffset==='number'&&Number.isFinite(saved.serverClockOffset)?saved.serverClockOffset:0;
      const payload = JSON.parse(atob(saved.token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
      if (typeof payload.exp !== 'number' || payload.exp * 1000 <= sessionNow()) { if(!renewable)clearSession(); return; }
      token = saved.token; sessionTenant = saved.tenant;
    } catch { clearSession(); }
  }
  function bootstrap() {
    if(!bootstrapTask)bootstrapTask=Promise.resolve().then(async()=>{if(!authState.authReady){restoreSession();
      if(restoreCookie&&signedOut())logoutTask=fetchImpl('/api/reception/auth/session',{method:'DELETE',signal:AbortSignal.timeout(15000)}).catch(()=>{});
      const restoreEpoch=epoch;
      if(restoreCookie&&!signedOut()&&typeof window!=='undefined')await renewSession();
      publishAuth();}});
    return bootstrapTask;
  }
  function expireIfNeeded() {
    if(!token)return;
    try{const claims=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));if(typeof claims.exp==='number'&&claims.exp*1000<=sessionNow()&&!renewable){clearSession();epoch++;}}catch{/* The server still validates newly issued tokens. */}
  }
  function persistSession(){
    if(typeof window!=='undefined')try{window.sessionStorage.setItem(sessionKey,JSON.stringify({token,tenant:sessionTenant,serverClockOffset}));if(renewable)window.localStorage?.setItem(renewableKey,JSON.stringify({tenant:sessionTenant}));}catch{}
  }
  function scheduleRenewal(delay=20*60*1000){clearTimeout(renewalTimer);if(renewable&&typeof window!=='undefined'){renewalTimer=setTimeout(()=>{void renewSession();},delay);(renewalTimer as unknown as {unref?:()=>void}).unref?.();}}
  async function renewSession():Promise<boolean>{
    if(signedOut())return false;
    if(renewalTask)return renewalTask;
    const owner=epoch;
    renewalTask=(async()=>{try{
      const response=await fetchImpl('/api/reception/auth/session',{method:'POST',cache:'no-store',headers:token?{Authorization:`Bearer ${token}`}:{},signal:AbortSignal.timeout(15000)});
      if(owner!==epoch||signedOut())return false;
      if(response.status===401){clearSession();epoch++;return false;}
      if(!response.ok){scheduleRenewal(10000);return false;}
      const saved=await response.json();if(owner!==epoch||signedOut()||!saved.accessToken)return false;
      syncSessionClock(response);token=saved.accessToken;sessionTenant=saved.tenant||sessionTenant;renewable=!!saved.renewable;
      persistSession();publishAuth();scheduleRenewal();return true;
    }catch{scheduleRenewal(10000);return false;}finally{renewalTask=null;}})();
    return renewalTask;
  }
  if(restoreCookie&&typeof window!=='undefined'){
    window.addEventListener?.('online',()=>{if(signedOut())logoutTask=fetchImpl('/api/reception/auth/session',{method:'DELETE',signal:AbortSignal.timeout(15000)}).catch(()=>{});else if(renewable)void renewSession();});
    window.addEventListener?.('focus',()=>{if(renewable)void renewSession();});
  }
  // A subordinate 401 is not proof that the shared JWT is invalid.
  async function validatePrimary(requestToken:string,requestEpoch:number) {
    if(!validationTask){const task=(async()=>{
      try{const response=await fetchImpl('/api/reception/office',{method:'GET',cache:'no-store',headers:{Authorization:`Bearer ${requestToken}`},signal:AbortSignal.timeout(15000)});
        if(response.status===401&&token===requestToken&&epoch===requestEpoch){clearSession();epoch++;return false;}
        return true;
      }catch{return true;}
    })();validationTask=task;void task.finally(()=>{if(validationTask===task)validationTask=null;});}
    return validationTask;
  }
  let epoch = 0;
  let latest: CallEvent | null = null;
  let callRevision = 0;
  const callListeners = new Set<() => void>();
  function publishCall(event: CallEvent | null) {
    if (event && latest && (Date.parse(event.timestamp) < Date.parse(latest.timestamp) || (event.timestamp === latest.timestamp && event.eventId < latest.eventId))) return;
    if (JSON.stringify(latest) === JSON.stringify(event)) return;
    latest = event ? { ...event } : null;
    callListeners.forEach(listener => listener());
  }
  async function request(path: string, method = 'GET', body?: unknown, extraHeaders?: Record<string, string>, signal?: AbortSignal, renewedRetry=false):Promise<Response> {
    if (path !== 'auth/login') { await bootstrap();
      if(renewable){let due=!token;try{due=due||JSON.parse(atob(token!.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).exp*1000<=sessionNow()+60000;}catch{due=true;}if(due&&!await renewSession())throw new ReceptionApiError(renewable?503:401,renewable?'تعذر الاتصال؛ ستُستعاد الجلسة تلقائيًا':'انتهت صلاحية تجديد الجلسة',!renewable);}
      expireIfNeeded(); }
    if (!token && path !== 'auth/login') throw new ReceptionApiError(401,'سجّل الدخول إلى مكتب API أولًا');
    const requestToken = token;
    const requestEpoch = epoch;
    let response = await fetchImpl(`/api/reception/${path}`, {
      method, cache: 'no-store', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(35000)]) : AbortSignal.timeout(15000),
    });
    if(response.status===401&&renewable&&path!=='auth/login'){
      if(renewedRetry)throw new ReceptionApiError(401,'تعذر تفويض الطلب بعد تجديد الجلسة',false);
      if(await renewSession()){if(method==='GET')return request(path,method,body,extraHeaders,signal,true);throw new ReceptionApiError(409,'تم تجديد الجلسة؛ أعد تنفيذ الإجراء',false);}
      if(renewable)throw new ReceptionApiError(503,'تعذر التجديد مؤقتًا؛ بقيت الجلسة محفوظة',false);
    }
    const diagnostic={method,path,status:response.status,authorizationPresent:!!requestToken,authReady:authState.authReady,jwtPresent:!!token,sessionInvalid:false};
    diagnostics.push(diagnostic);
    if(diagnostics.length>100)diagnostics.shift();
    if (response.status === 304) return response;
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      let invalid=false;
      if(response.status===401&&path!=='auth/login'&&token===requestToken&&epoch===requestEpoch){
        if(path==='office'){clearSession();epoch++;invalid=true;}
        else {const valid=await validatePrimary(requestToken!,requestEpoch);invalid=!valid&&epoch===requestEpoch+1&&!token;}
      }
      diagnostic.sessionInvalid=invalid;
      if(response.status===401)console.warn('[office-auth]',{method,path,status:401,authorizationPresent:!!requestToken,authReady:authState.authReady,sessionInvalid:invalid});
      throw new ReceptionApiError(response.status, response.status === 401 ? (path === 'auth/login' ? 'بيانات الدخول غير صحيحة' : invalid?'انتهت جلسة API؛ أعد تسجيل الدخول':'تعذر تفويض هذا الطلب؛ الجلسة العامة لم تُلغَ. أعد المحاولة.') : response.status === 403 ? 'ليس لديك صلاحية للوصول إلى هذه الصفحة' : detail.detail ?? detail.error ?? `API ${response.status}`,invalid);
    }
    return response;
  }
  const backend: ReceptionBackend = {
    async receiveCall(event) { const session = epoch; await request('reception/calls', 'POST', event); if (session === epoch) await refreshCall(); },
    async saveRide(ride) { const pickup=ride.pickup;await request(`reception/rides/${encodeURIComponent(ride.id)}`, 'PUT', {...ride,pickup:{...pickup,...(pickup.coords?.x===0&&pickup.coords?.y===0?{coords:null}:{})}}); },
    async ensureRideNumber() { /* API numbers orders atomically on creation. */ },
    async changeQueue(action) { await request('reception/queue', 'POST', action); },
  };
  async function refreshCall() {
    const session = epoch;
    const revision = ++callRevision;
    const event = await (await request('reception/latest-call')).json();
    if (session === epoch && revision === callRevision) publishCall(event);
  }
  return {
    async officeCalls<T>(path:string,method='GET',body?:unknown):Promise<T>{const response=await request('officecalls/admin/'+path,method,body);return response.status===204?undefined as T:response.text().then(text=>text?JSON.parse(text):undefined);},
    async voice<T>(path:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{return (await request(path,method,body,undefined,signal)).json();},
    subscribeDriverMap(next:(data:import('./office-driver-map').DriverMapData)=>void,error:(e:Error)=>void){let stopped=false,busy=false,etag:string|undefined;const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;async function poll(){if(stopped||busy)return;clearTimeout(timer);if(document.visibilityState==='hidden'){timer=setTimeout(poll,5000);return;}busy=true;let delay=100;try{const r=await request('office/driver-map?wait=true','GET',undefined,etag?{'If-None-Match':etag}:undefined,controller.signal);if(!stopped&&r.status!==304){etag=r.headers.get('etag')??undefined;next(await r.json());}}catch(e){if(!stopped)error(e as Error);delay=3000;}finally{busy=false;}if(!stopped)timer=setTimeout(poll,delay);}const visibility=()=>{if(document.visibilityState==='visible')void poll();};document.addEventListener('visibilitychange',visibility);void poll();return()=>{stopped=true;controller.abort();clearTimeout(timer);document.removeEventListener('visibilitychange',visibility);};},
    async fareSettings():Promise<{rule:Record<string,number>|null;currency:string;allowDriverManual:boolean}>{return (await request('fare/settings')).json();},
    async saveFareSettings(input:unknown){return (await request('fare/settings','PUT',input)).json();},
    async saveFare(id:string,input:unknown){return (await request(`rides/${id}/fare`,'PUT',input)).json();},
    ...backend,
    async jobs():Promise<import('./driver-jobs').DriverJob[]> { return (await request('reception/jobs')).json(); },
    async changeJob(action:import('./driver-jobs').DriverJobAction) { await request('reception/jobs','POST',action); },

    async dispatchPolicy():Promise<import('../components/dispatch-monitor').DispatchPolicy>{return (await request('dispatch/policy')).json();},
    async saveDispatchPolicy(value:import('../components/dispatch-monitor').DispatchPolicy):Promise<import('../components/dispatch-monitor').DispatchPolicy>{return (await request('dispatch/policy','PUT',value)).json();},
    async dispatchRides():Promise<import('../components/dispatch-monitor').DispatchRow[]>{return (await request('dispatch/rides')).json();},
    async dispatchMode(id:string,mode:string,version:number){return (await request(`dispatch/rides/${id}/mode`,'PUT',{mode,version})).json();},
    externalSession,
    bootstrap,
    authSnapshot:()=>authState,
    requestDiagnostics:()=>diagnostics.map(row=>({...row})),
    subscribeAuth(listener:()=>void){authListeners.add(listener);return()=>{authListeners.delete(listener);};},
    session() { if(!authState.authReady){restoreSession();publishAuth();}expireIfNeeded();return token||renewable ? { tenant: sessionTenant } : null; },
    async notificationUpdates(cursor: string, signal: AbortSignal): Promise<{cursor:string;data:import('./driver-api').Notice[]}> { return (await request(`notifications/updates?cursor=${encodeURIComponent(cursor)}`, 'GET', undefined, undefined, signal)).json(); },
    async reportDrivers(search = '', page = 1): Promise<{id:string;fullName:string;phone?:string}[]> { return (await request(`reception/reports/drivers?search=${encodeURIComponent(search)}&page=${page}`)).json(); },
    async administration<T>(path:string, method='GET', body?:unknown):Promise<T> { const response=await request(path,method,body);const text=await response.text();return (text?JSON.parse(text):undefined) as T; },
    async reportHistory(filters: {driverId?:string;customerId?:string;from?:string;to?:string;page:number;sort?:string;kind?:'orders';search?:string;status?:string;source?:string;fareMode?:string;fareSource?:string}): Promise<{total:number;totalOrders?:number;page:number;pageSize:number;items:Record<string,unknown>[];fareTotals?:{mode:string;currency:string;count:number;value:number;distanceKm:number}[];driverTotals?:{driverId:string;mode:string;currency:string;count:number;value:number;distanceKm:number}[];summary?:Record<'statuses'|'sources'|'drivers'|'areas',{key:string;count:number}[]>}> {
      const params = new URLSearchParams(); for (const [key,value] of Object.entries(filters)) if(value) params.set(key,String(value));
      return (await request(`reception/reports/history?${params}`)).json();
    },
    async saveOfficeMessaging(officeWhatsAppNumber: string) { await request('office/messaging-settings', 'PUT', { officeWhatsAppNumber }); },
    async driverMap(signal?:AbortSignal):Promise<import('./office-driver-map').DriverMapData>{return (await request('office/driver-map','GET',undefined,undefined,signal)).json();},
    async driverRoute(id:string,filters:{rideId?:string;from?:string;to?:string;after?:string;afterId?:string},signal?:AbortSignal):Promise<import('./office-driver-map').GpsRoute>{const params=new URLSearchParams(Object.entries(filters).filter((entry):entry is [string,string]=>!!entry[1]));return (await request(`office/driver-map/${id}/route?${params}`,'GET',undefined,undefined,signal)).json();},
    async office(): Promise<import('./office').OfficeData> { return (await request('office')).json(); },
    async driverAssignments(id: string): Promise<import('./office').VehicleAssignment[]> { return (await request(`office/drivers/${id}/assignments`)).json(); },
    async driverQueue(value: import('./office').DriverQueueMutation) { await request('office/queue', 'POST', value); },
    async saveQueueLocation(value: { id?: string; name: string; isActive: boolean; sortOrder: number }) { return (await request(`office/queue-locations${value.id ? `/${value.id}` : ''}`, value.id ? 'PUT' : 'POST', value)).json(); },
    async saveOfficeRecord(kind: 'drivers' | 'vehicles', value: Record<string, unknown> & { id?: string }) { return (await request(`office/${kind}${value.id ? `/${value.id}` : ''}`, value.id ? 'PUT' : 'POST', value)).json(); },
    async queueOfficeDriver(id: string, vehicleId: string) { await request(`office/drivers/${id}/queue`, 'POST', { vehicleId }); },
    async customers(search = '', paging?:{page:number;limit:number}): Promise<ApiCustomer[]> { const params=new URLSearchParams({search});if(paging){params.set('page',String(paging.page));params.set('limit',String(paging.limit));}return (await request(`customers?${params}`)).json(); },
    async customer(id: string): Promise<ApiCustomer> { return (await request(`customers/${encodeURIComponent(id)}`)).json(); },
    async customerHistory(id:string,kind:'orders'|'calls'|'activity',page=1,orderId?:string):Promise<import('./customer-history').CustomerHistory> { const params=new URLSearchParams({kind,page:String(page)});if(orderId)params.set('orderId',orderId);return (await request(`customers/${encodeURIComponent(id)}/history?${params}`)).json(); },
    async customerPage(search = '', page = 1, limit = 50): Promise<{items:ApiCustomer[];total:number;totalCustomers:number;page:number;pageSize:number}> { const params=new URLSearchParams({search,page:String(page),limit:String(limit),paged:'true'});return (await request(`customers?${params}`)).json(); },
    async createCustomer(fullName: string, phone: string, details: Partial<ApiCustomer> = {}): Promise<ApiCustomer> { return (await request('customers', 'POST', { fullName, phone, ...details })).json(); },
    async saveCustomer(value: ApiCustomer): Promise<ApiCustomer> { return (await request(`customers/${encodeURIComponent(value.id)}`, 'PUT', value)).json(); },
    async places(search = '', customerId?: string): Promise<CustomerPlace[]> { const params=new URLSearchParams();if(search)params.set('search',search);if(customerId)params.set('customerId',customerId);return (await request(`saved-addresses?${params}`)).json(); },
    async savePlace(value: Omit<SavedAddress, 'id'> & { id?: string }): Promise<SavedAddress> { return (await request(`saved-addresses${value.id ? `/${value.id}` : ''}`, value.id ? 'PUT' : 'POST', value)).json(); },
    async deletePlace(value: SavedAddress) { await request(`saved-addresses/${value.id}?version=${value.version}`, 'DELETE'); },
    getLatestCall: () => latest,
    subscribeLatest(listener: () => void) { callListeners.add(listener); return () => { callListeners.delete(listener); }; },
    watchLatest(onError: (error: Error) => void) {
      let stopped = false, cursor = '', failures = 0;
      let timer: ReturnType<typeof setTimeout>; const session = epoch;
      const controller = new AbortController();
      async function poll() {
        let wait = 100;
        try {
          const response = await request(`reception/call-updates?cursor=${encodeURIComponent(cursor)}`, 'GET', undefined, undefined, controller.signal);
          const update: {cursor:string;data:CallEvent|null} = await response.json();
          if (typeof update.cursor !== 'string' || !Object.prototype.hasOwnProperty.call(update, 'data')) throw new Error('Invalid central call state');
          if (!stopped && session === epoch) { cursor = update.cursor; publishCall(update.data); }
          failures = 0;
        } catch (cause) {
          if (!stopped && session === epoch) onError(cause as Error);
          wait = Math.min(30000, 1000 * 2 ** Math.min(++failures, 5));
        }
        if (!stopped && session === epoch && token) timer = setTimeout(poll, wait);
      }
      void poll(); return () => { stopped = true; controller.abort(); clearTimeout(timer); };
    },
    async login(tenant: string, username: string, password: string, rememberMe?:boolean) {
      await logoutTask;
      await bootstrap(); clearSession(); const loginEpoch = ++epoch; publishCall(null);
      const response = await request('auth/login', 'POST', { tenant: tenant.trim(), username: username.trim(), password,...(rememberMe===undefined?{}:{rememberMe}) });
      const result = await response.json();
      if (loginEpoch !== epoch) throw new Error('أُغلقت جلسة الدخول');
      syncSessionClock(response);
      token = result.accessToken;renewable=!!result.renewable;
      sessionTenant = result.tenant || tenant.trim();
      if (typeof window !== 'undefined') try { window.localStorage?.removeItem(signedOutKey); } catch {}
      if (typeof window !== "undefined") try { window.sessionStorage.setItem(sessionKey, JSON.stringify({ token, tenant: sessionTenant, serverClockOffset })); } catch { /* Retain memory session if storage is unavailable. */ }
      persistSession();scheduleRenewal();publishAuth();
    },
    logout() { clearSession(); epoch++; publishCall(null);if(typeof window!=='undefined')try{window.localStorage?.setItem(signedOutKey,'1');}catch{}logoutTask=fetchImpl('/api/reception/auth/session',{method:'DELETE',signal:AbortSignal.timeout(15000)}).catch(()=>{}); },
    async startShift(driverId: string, vehicleId: string) { await request('reception/shifts', 'POST', { driverId, vehicleId }); },
    async endShift(id: string) { await request(`reception/shifts/${encodeURIComponent(id)}/end`, 'POST'); },
    subscribe(next: (data: ReceptionSnapshot) => void, error: (error: Error) => void) {
      let stopped = false, etag: string | null = null;
      const session = epoch;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout>;
      async function poll() {
        let delay = 200;
        try {
          const response = await request('reception/snapshot?wait=true', 'GET', undefined, etag ? { 'If-None-Match': etag } : {}, controller.signal);
          if (response.status !== 304) {
            const data = decodeReceptionSnapshot(await response.json());
            if (!stopped && session === epoch) { etag = response.headers.get('etag'); next(data); }
          }
        } catch (cause) { if (!stopped && session === epoch) error(cause as Error); delay = 5000; }
        if (!stopped && session === epoch) timer = setTimeout(poll, delay);
      }
      void poll();
      return () => { stopped = true; controller.abort(); clearTimeout(timer); };
    },
  };
}
export const apiReceptionBackend = createApiReceptionBackend(undefined,true);
