export type DriverRide = { id: string; status: 'Pending'|'Assigned'|'Accepted'|'DriverArriving'|'Rejected'|'Arrived'|'InProgress'|'Completed'|'Cancelled'; version: number; pickup: string; destination: string; notes?: string; fullName?: string; phone?: string; addressText?: string; neighborhood?: string; street?: string; latitude?: number; longitude?: number; destinationLatitude?: number; destinationLongitude?: number; offerDistanceMeters?:number|null; offerExpiresAt?:string|null };
export type DriverProfile = { id:string; fullName:string; status:'Offline'|'Available'|'Busy'|'Suspended'; currentVehicleId:string|null; locationStatus?:'READY'|'NO_LOCATION'|'STALE_LOCATION'|'POOR_ACCURACY'; locationUpdatedAt?:string|null };
export type Notice = { id:string; action:string; entityId:string; createdAt:string };
export type DriverSnapshot = { driver:DriverProfile; rides:DriverRide[]; notices:Notice[] };
export type RideHistory = { page:number; total:number; items:(DriverRide & {createdAt:string})[] };
export class DriverApiError extends Error { status:number; serverTime?:string; constructor(status:number, message:string, serverTime?:string) { super(message); this.status=status; this.serverTime=serverTime; } }
export function createDriverApi(fetchImpl: typeof fetch = (...args) => fetch(...args)) {
  let token:string|null=null;
  let session=0;
  let locationClockOffset=0;
  let offerClock: {server:number; received:number}|null=null;
  async function request<T>(path:string, method='GET', body?:unknown, signal?:AbortSignal):Promise<T> {
    if (!token && path!=='auth/login') throw new DriverApiError(401,'سجّل الدخول أولًا');
    const response=await fetchImpl(`/api/reception/${path}`, {method,cache:'no-store',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(35000)]):AbortSignal.timeout(15000)});
    if(!response.ok){const detail=await response.json().catch(()=>({}));throw new DriverApiError(response.status,response.status===401?'انتهت الجلسة؛ سجّل الدخول مجددًا':response.status===403?'حساب السائق غير متاح أو لا يملك الصلاحية':response.status===409?(detail.error??detail.detail??'تغيّر الطلب؛ تم تحديث البيانات، راجع الحالة قبل المحاولة'):detail.error??detail.detail??'تعذر الاتصال بالمكتب',detail.serverTime);}
    return response.json();
  }
  return {
    async login(tenant:string,username:string,password:string) { token=null;const current=++session;const login=await request<{accessToken:string}>('auth/login','POST',{tenant,username,password});if(current!==session)throw new DriverApiError(401,'أُغلقت الجلسة');token=login.accessToken;try{return await request<DriverProfile>('driver/me');}catch(e){token=null;throw e;} },
    logout(){token=null;session++;offerClock=null;},
    offerNow(){return offerClock?offerClock.server+performance.now()-offerClock.received:Date.now();},
    async updates(cursor='',signal?:AbortSignal){
      const current=session;
      const update=await request<{cursor:string;data:DriverSnapshot;serverTime?:string}>(`driver/updates?cursor=${encodeURIComponent(cursor)}`,'GET',undefined,signal);
      const server=Date.parse(update.serverTime??'');
      // Do not use the request midpoint: updates can long-poll for 25 seconds.
      // Monotonic elapsed time also survives changes to the phone's wall clock.
      if(current===session&&Number.isFinite(server))offerClock={server,received:performance.now()};
      return update;
    },
    ride(id:string){return request<DriverRide>(`driver/rides/${id}`);},
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
    availability(status:'Available'|'Offline'){return request('driver/availability','PUT',{status});},
    transition(ride:DriverRide,status:DriverRide['status']){return request(`rides/${ride.id}/status`,'PUT',{status,version:ride.version});},
    reject(ride:DriverRide){return request(`driver/rides/${ride.id}/reject`,'PUT',{version:ride.version});},
    history(page=1){return request<RideHistory>(`driver/history?page=${page}`);},
  };
}
export const noticeLabel=(action:string)=>({Assigned:'طلب جديد',Accepted:'تم قبول الطلب',DriverArriving:'السائق في الطريق',Rejected:'تم رفض الطلب وإعادته للمكتب',Arrived:'وصل السائق',InProgress:'بدأت الرحلة',Completed:'انتهت الرحلة',Cancelled:'أُلغي الطلب',Removed:'تم سحب الطلب من السائق',Pending:'تحديث الطلب',Available:'السائق متاح',Offline:'السائق غير متاح'}[action.split('.').at(-1)!]??'تحديث الطلب');
