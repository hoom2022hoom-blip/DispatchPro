import type { ReceptionBackend } from './reception-backend';
import type { Ride, Driver, Vehicle, Shift } from './types';
import type { QueueEntry } from './driver-queue';
import type { CallEvent } from './call-events';
import type { ApiCustomer, CustomerPlace, SavedAddress } from './customer-places';

export type ReceptionSnapshot = { rides: Ride[]; drivers: Driver[]; vehicles: Vehicle[]; shifts: Shift[]; queue: QueueEntry[]; queueLocations?: import('./office').QueueLocation[]; latest: CallEvent | null };
const dates = ['createdAt', 'updatedAt', 'scheduledTime', 'assignedAt', 'pickedUpAt', 'droppedOffAt', 'cancelledAt', 'completionTime', 'startTime', 'endTime'];
export function decodeReceptionSnapshot(input: ReceptionSnapshot): ReceptionSnapshot {
  const convert = <T>(row: T): T => {
    const result = { ...row } as Record<string, unknown>;
    for (const key of dates) if (typeof result[key] === 'string') result[key] = new Date(result[key] as string);
    return result as T;
  };
  return { ...input, rides: input.rides.map(convert), vehicles: input.vehicles.map(convert), shifts: input.shifts.map(convert) };
}

export function createApiReceptionBackend(fetchImpl: typeof fetch = (...args) => fetch(...args)) {
  let token: string | null = null;
  let sessionTenant = '';
  const sessionKey = 'dispatchpro.external-office-session';
  const externalSession = () => typeof window !== 'undefined' && window.location?.protocol === 'https:' && !['localhost','127.0.0.1','[::1]'].includes(window.location.hostname);
  function clearSession() {
    token = null; sessionTenant = '';
    if (externalSession()) try { window.sessionStorage.removeItem(sessionKey); } catch { /* Storage may be disabled. */ }
  }
  function restoreSession() {
    if (!externalSession()) return;
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(sessionKey) || 'null');
      if (!saved) return;
      const payload = JSON.parse(atob(saved.token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
      if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) { clearSession(); return; }
      token = saved.token; sessionTenant = saved.tenant;
    } catch { clearSession(); }
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
  async function request(path: string, method = 'GET', body?: unknown, extraHeaders?: Record<string, string>, signal?: AbortSignal) {
    if (!token && path !== 'auth/login') restoreSession();
    if (!token && path !== 'auth/login') throw new Error('سجّل الدخول إلى مكتب API أولًا');
    const requestToken = token;
    const response = await fetchImpl(`/api/reception/${path}`, {
      method, cache: 'no-store', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(35000)]) : AbortSignal.timeout(15000),
    });
    if (response.status === 304) return response;
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      if (response.status === 401 && path !== 'auth/login' && token === requestToken) clearSession();
      throw new Error(response.status === 401 ? (path === 'auth/login' ? 'بيانات الدخول أو معرف المكتب غير صحيحة' : 'انتهت جلسة API؛ أعد تسجيل الدخول') : detail.detail ?? detail.error ?? `API ${response.status}`);
    }
    return response;
  }
  const backend: ReceptionBackend = {
    async receiveCall(event) { const session = epoch; await request('reception/calls', 'POST', event); if (session === epoch) await refreshCall(); },
    async saveRide(ride) { await request(`reception/rides/${encodeURIComponent(ride.id)}`, 'PUT', ride); },
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
    ...backend,
    async dispatchPolicy():Promise<import('../components/dispatch-monitor').DispatchPolicy>{return (await request('dispatch/policy')).json();},
    async saveDispatchPolicy(value:import('../components/dispatch-monitor').DispatchPolicy):Promise<import('../components/dispatch-monitor').DispatchPolicy>{return (await request('dispatch/policy','PUT',value)).json();},
    async dispatchRides():Promise<import('../components/dispatch-monitor').DispatchRow[]>{return (await request('dispatch/rides')).json();},
    async dispatchMode(id:string,mode:string,version:number){return (await request(`dispatch/rides/${id}/mode`,'PUT',{mode,version})).json();},
    externalSession,
    session() { restoreSession(); return token ? { tenant: sessionTenant } : null; },
    async notificationUpdates(cursor: string, signal: AbortSignal): Promise<{cursor:string;data:import('./driver-api').Notice[]}> { return (await request(`notifications/updates?cursor=${encodeURIComponent(cursor)}`, 'GET', undefined, undefined, signal)).json(); },
    async reportDrivers(search = '', page = 1): Promise<{id:string;fullName:string;phone?:string}[]> { return (await request(`reception/reports/drivers?search=${encodeURIComponent(search)}&page=${page}`)).json(); },
    async administration<T>(path:string, method='GET', body?:unknown):Promise<T> { const response=await request(path,method,body);const text=await response.text();return (text?JSON.parse(text):undefined) as T; },
    async reportHistory(filters: {driverId?:string;customerId?:string;from?:string;to?:string;page:number;sort?:string;kind?:'orders';search?:string;status?:string;source?:string}): Promise<{total:number;page:number;pageSize:number;items:Record<string,unknown>[];summary?:Record<'statuses'|'sources'|'drivers'|'areas',{key:string;count:number}[]>}> {
      const params = new URLSearchParams(); for (const [key,value] of Object.entries(filters)) if(value) params.set(key,String(value));
      return (await request(`reception/reports/history?${params}`)).json();
    },
    async saveOfficeMessaging(officeWhatsAppNumber: string) { await request('office/messaging-settings', 'PUT', { officeWhatsAppNumber }); },
    async office(): Promise<import('./office').OfficeData> { return (await request('office')).json(); },
    async driverAssignments(id: string): Promise<import('./office').VehicleAssignment[]> { return (await request(`office/drivers/${id}/assignments`)).json(); },
    async driverQueue(value: import('./office').DriverQueueMutation) { await request('office/queue', 'POST', value); },
    async saveQueueLocation(value: { id?: string; name: string; isActive: boolean; sortOrder: number }) { return (await request(`office/queue-locations${value.id ? `/${value.id}` : ''}`, value.id ? 'PUT' : 'POST', value)).json(); },
    async saveOfficeRecord(kind: 'drivers' | 'vehicles', value: Record<string, unknown> & { id?: string }) { return (await request(`office/${kind}${value.id ? `/${value.id}` : ''}`, value.id ? 'PUT' : 'POST', value)).json(); },
    async queueOfficeDriver(id: string, vehicleId: string) { await request(`office/drivers/${id}/queue`, 'POST', { vehicleId }); },
    async customers(search = '', paging?:{page:number;limit:number}): Promise<ApiCustomer[]> { const params=new URLSearchParams({search});if(paging){params.set('page',String(paging.page));params.set('limit',String(paging.limit));}return (await request(`customers?${params}`)).json(); },
    async customer(id: string): Promise<ApiCustomer> { return (await request(`customers/${encodeURIComponent(id)}`)).json(); },
    async createCustomer(fullName: string, phone: string, details: Partial<ApiCustomer> = {}): Promise<ApiCustomer> { return (await request('customers', 'POST', { fullName, phone, ...details })).json(); },
    async saveCustomer(value: ApiCustomer): Promise<ApiCustomer> { return (await request(`customers/${encodeURIComponent(value.id)}`, 'PUT', value)).json(); },
    async places(search = '', customerId?: string): Promise<CustomerPlace[]> { const params=new URLSearchParams();if(search)params.set('search',search);if(customerId)params.set('customerId',customerId);return (await request(`saved-addresses?${params}`)).json(); },
    async savePlace(value: Omit<SavedAddress, 'id'> & { id?: string }): Promise<SavedAddress> { return (await request(`saved-addresses${value.id ? `/${value.id}` : ''}`, value.id ? 'PUT' : 'POST', value)).json(); },
    async deletePlace(value: SavedAddress) { await request(`saved-addresses/${value.id}?version=${value.version}`, 'DELETE'); },
    getLatestCall: () => latest,
    subscribeLatest(listener: () => void) { callListeners.add(listener); return () => { callListeners.delete(listener); }; },
    watchLatest(onError: (error: Error) => void) {
      let stopped = false; let timer: ReturnType<typeof setTimeout>; const session = epoch;
      async function poll() { try { await refreshCall(); } catch (e) { if (!stopped && session === epoch) onError(e as Error); } if (!stopped && session === epoch) timer = setTimeout(poll, 1000); }
      void poll(); return () => { stopped = true; clearTimeout(timer); };
    },
    async login(tenant: string, username: string, password: string) {
      clearSession(); const loginEpoch = ++epoch; publishCall(null);
      const result = await (await request('auth/login', 'POST', { tenant: tenant.trim(), username: username.trim(), password })).json();
      if (loginEpoch !== epoch) throw new Error('أُغلقت جلسة الدخول');
      token = result.accessToken;
      sessionTenant = tenant.trim();
      if (externalSession()) try { window.sessionStorage.setItem(sessionKey, JSON.stringify({ token, tenant: sessionTenant })); } catch { /* Retain memory session if storage is unavailable. */ }
    },
    logout() { clearSession(); epoch++; publishCall(null); },
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
export const apiReceptionBackend = createApiReceptionBackend();
