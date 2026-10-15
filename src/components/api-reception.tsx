"use client";
import {Sheet,SheetContent,SheetTitle,SheetTrigger} from './ui/sheet';
import {Tabs,TabsList,TabsTrigger,TabsContent} from './ui/tabs';
import {LoginForm} from './login-form';
import {OfficeStatusCards} from './office-status-cards';
import {useOfficeAuth} from "@/hooks/use-office-auth";
import {receptionError} from '@/lib/reception-feedback';
import {whatsappLink} from '@/lib/whatsapp-link';

import {driverPresentation} from '@/lib/driver-presentation';
import {useOffice} from './office-workspace';
import {ConnectedDrivers} from './connected-drivers';
import {OfficeDriverJobs} from './office-driver-jobs';
import {receptionShortcut} from '@/lib/reception-keyboard';
import { FloatingQueueWindow } from './floating-queue-window';
import { v4 as uuidv4 } from 'uuid';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import { apiReceptionBackend, decodeReceptionSnapshot, type ReceptionSnapshot } from '@/lib/reception-api';
import { getReceptionBackend } from '@/lib/reception-backend';
import { activeRideStatuses } from '@/lib/ride-status';
import type { Ride, RideStatus } from '@/lib/types';
import { OfficeReceptionTable } from './office-reception-table';
import { ReceptionEditForm } from './reception-edit-form';
import { ReceptionFooter } from './reception-footer';
import { OfficeQueuePanel, reorderOfficeQueue } from './office-queue';
import { type OfficeData } from '@/lib/office';
import { CallLoggerForm } from './call-logger-form';
import { ResponsiveDialog } from './responsive-dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Phone } from 'lucide-react';
import { OfficeLiveNotifications } from './office-live-notifications';

import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { findCustomerByPhone, locationFromPlace, type CustomerPlace, type RequestLocation } from '@/lib/customer-places';
import { LocationFields } from './location-fields';
const CustomerPlacesMap = dynamic(() => import('./customer-places-map').then(m => m.CustomerPlacesMap), { ssr: false });

const empty: ReceptionSnapshot = { rides: [], drivers: [], vehicles: [], shifts: [], queue: [], latest: null };
const backend = getReceptionBackend(false, true);
const loadSuggestedPlaces=()=>apiReceptionBackend.administration<import('./ride-location-editor').SuggestedPlace[]>('office/suggested-places');

// Reuses the existing reception forms, table, queue and drag/drop; all reads and writes use one provider.
export function ApiReception({ initialShowPlaces = false, officeTenant }: { initialShowPlaces?: boolean; officeTenant?: string }) {
  const latestCall=useSyncExternalStore(apiReceptionBackend.subscribeLatest,apiReceptionBackend.getLatestCall,()=>null);
  const auth=useOfficeAuth();
  const connected=auth.authReady&&auth.authenticated;
  const [data, setData] = useState(empty);
  const [customers,setCustomers]=useState<import('@/lib/customer-places').ApiCustomer[]>([]);const [customerPlaces,setCustomerPlaces]=useState<CustomerPlace[]>([]);
  const [officeData, setOfficeData] = useState<OfficeData | null>(null);

  const [driversPanel,setDriversPanel]=useState(false);
  const [error, setError] = useState('');
  const [tenant, setTenant] = useState(officeTenant ?? ''); const [username, setUsername] = useState(''); const [password, setPassword] = useState('');
  useEffect(() => {
    if(auth.authenticated)setTenant(auth.tenant);
  }, [auth.authenticated,auth.tenant]);
  const actionLock=useRef(false);const assignmentLocks=useRef(new Set<string>());
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Ride | null>(null); const [adding, setAdding] = useState(false);

  const {data:sharedOfficeData,openQueueWindow,registerReceptionDrop}=useOffice();
  const hasSharedOffice=!!sharedOfficeData;
  useEffect(()=>{
    if(!sharedOfficeData)return;
    setOfficeData(sharedOfficeData);
    // Office already fetched this tenant's authenticated reception snapshot.
    // Render it even while the independent last-call poll is pending or retrying.
    setData(decodeReceptionSnapshot(sharedOfficeData.reception));
  },[sharedOfficeData]);
  const [queueWindow,setQueueWindow]=useState(false);
  const searchParams=useSearchParams();
  const router=useRouter();
  const [showPlaces, setShowPlaces] = useState(initialShowPlaces);
  const [location, setLocation] = useState<RequestLocation>({ addressText: '', latitude: null, longitude: null, locationSource: 'MANUAL_TEXT' });
  const [selectedPlace, setSelectedPlace] = useState<CustomerPlace | null>(null);
  const [requestCustomer,setRequestCustomer]=useState<import('@/lib/customer-places').ApiCustomer|null>(null);
  const selectCustomerPlace = useCallback((place: CustomerPlace) => { setSelectedPlace(place); setRequestCustomer(customers.find(c=>c.id===place.address.customerId)??null); setLocation(locationFromPlace(place)); }, [customers]);
  useEffect(() => { if (!connected) return; return apiReceptionBackend.watchLatest(failure => setError(receptionError(failure))); }, [connected]);
  useEffect(() => {
    if (!connected) return;
    return apiReceptionBackend.subscribe(next => { setData(next); setError(''); }, failure => setError(receptionError(failure)));
  }, [connected]);
  async function openLatestCall() {
    const call=latestCall??data.latest;
    if(!call)return;
    await run(async()=>{
      let ride=data.rides.find(r=>r.callEventId===call.eventId);
      if(!ride){
        await backend.receiveCall(call);
        const next=await apiReceptionBackend.office();
        setOfficeData(next);const snapshot=decodeReceptionSnapshot(next.reception);setData(snapshot);
        ride=snapshot.rides.find(r=>r.callEventId===call.eventId);
      }
      if(ride)setEditing(ride);
      else throw new Error('الطلب قيد الاستقبال. حاول فتحه مجددًا بعد لحظات.');
    });
  }
  async function refreshOffice() { const next = await apiReceptionBackend.office(); setOfficeData(next); setData(decodeReceptionSnapshot(next.reception)); }
  useEffect(() => {
    if (!connected || hasSharedOffice) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    async function poll() { try { const next = await apiReceptionBackend.office(); if (!stopped) { setOfficeData(next); setError(''); } } catch (e) { if (!stopped) setError(receptionError(e)); } if (!stopped) timer = setTimeout(poll, 2000); }
    void poll(); return () => { stopped = true; clearTimeout(timer); };
  }, [connected, hasSharedOffice]);
  const lookupCustomer=useCallback(async(phone:string)=>{
    const customer=findCustomerByPhone(await apiReceptionBackend.customers(phone),phone)??null;
    return {customer,places:customer?await apiReceptionBackend.places('',customer.id):[]};
  },[]);
  useEffect(()=>{if(!connected||!searchParams.get('customerId'))return;let stopped=false;const customerId=searchParams.get('customerId')!;void Promise.all([apiReceptionBackend.customer(customerId),apiReceptionBackend.places('',customerId)]).then(([c,ps])=>{if(!stopped){const place=ps.find(x=>x.address.id===searchParams.get('addressId'))??ps.find(x=>x.address.isDefault)??ps[0];setRequestCustomer(c);setSelectedPlace(place??null);setLocation(place?locationFromPlace(place):{addressText:'',latitude:null,longitude:null,locationSource:'MANUAL_TEXT'});setAdding(true);}}).catch(e=>{if(!stopped)setError(receptionError(e));});return()=>{stopped=true;};},[connected,searchParams]);
  // Navigation and Strict Mode cleanup do not own the shared authenticated session.
  // Polling effects above clean up their subscriptions; logout remains explicit.
  const choices = useMemo(() => (officeData?.drivers??[]).map(d=>({id:d.id,driverId:d.id,label:d.fullName,...driverPresentation(d,data.rides),searchText:`${d.phoneLocal??d.phone} ${officeData?.vehicles.find(v=>v.id===d.currentVehicleId)?.plate??''}`,disabled:!d.active||d.status==='Suspended'||d.status==='Busy'||data.rides.some(r=>r.driverId===d.id&&activeRideStatuses.includes(r.status)),queuePosition:data.queue.find(q=>q.driverId===d.id)?.position})).sort((a,b)=>a.driverGroup-b.driverGroup||a.id.localeCompare(b.id)),[data,officeData]);
  async function run(action: () => Promise<void>) { if (actionLock.current) return; actionLock.current=true; setBusy(true); setError(''); try { await action(); await refreshOffice(); } catch (failure) { setError(receptionError(failure)); } finally { actionLock.current=false; setBusy(false); } }
  async function save(ride: Ride) { await backend.saveRide(ride); await refreshOffice(); setEditing(null); setAdding(false); setRequestCustomer(null); }
  async function saveInlineFare(ride:Ride,amount:number) {
    if(!ride.backendRideId||ride.rideVersion==null)throw new Error('أكمل عنوان الطلب أولًا');
    const result=await apiReceptionBackend.saveFare(ride.backendRideId,{mode:'OFFICE_MANUAL',amount,version:ride.rideVersion});
    setData(current=>({...current,rides:current.rides.map(row=>row.id===ride.id?{...row,finalFare:result.finalFare,totalFare:result.finalFare,fareSource:result.fareSource,fareMode:result.fareMode,currency:result.currency,rideVersion:result.version}:row)}));
    void refreshOffice().catch(failure=>setError(receptionError(failure)));
  }
  async function add(input: Omit<Ride, 'id' | 'status' | 'driverId' | 'createdAt' | 'updatedAt' | 'isNew'> & { id?: string; status?: RideStatus; driverId?: string | null }) {
    const selectedFields:RequestLocation & {customerId?:string;savedAddressId?:string|null}=input.locationSource==='MAP_PIN'&&input.latitude!=null&&input.longitude!=null?{addressText:input.pickup.name,latitude:input.latitude,longitude:input.longitude,locationSource:'MAP_PIN'}:input.savedAddressId?{customerId:input.customerId,savedAddressId:input.savedAddressId,addressText:input.addressText??input.pickup.name,neighborhood:input.neighborhood,street:input.street,latitude:input.latitude??null,longitude:input.longitude??null,locationSource:input.locationSource??'SAVED_ADDRESS',notes:input.notes}:{...location,locationSource:location.locationSource==='SAVED_ADDRESS'?'MANUAL_TEXT':location.locationSource};
    const addressText=!location.addressText&&location.latitude!=null&&input.pickup.name==='موقع محدد على الخريطة'?'':input.pickup.name;
    const changedAddress=addressText!==(selectedFields.addressText??'');
    const id=input.id??uuidv4();
    const existing=decodeReceptionSnapshot((await apiReceptionBackend.office()).reception).rides.find(r=>r.id===id);
    if(!existing)await backend.saveRide({ ...input, ...selectedFields, savedAddressId:!changedAddress&&selectedFields.locationSource==='SAVED_ADDRESS'?selectedFields.savedAddressId??selectedPlace?.address.id:null, locationSource:changedAddress?'MANUAL_TEXT':selectedFields.locationSource,...(changedAddress?{latitude:null,longitude:null}:{}), addressText, pickup:{name:addressText,coords:{x:selectedFields.latitude??0,y:selectedFields.longitude??0}},notes:input.notes||selectedFields.notes,id,status:input.driverId?'pending':input.status??'pending',shiftId:null,driverId:null,createdAt:new Date(),updatedAt:new Date() });
    if(input.driverId){
      const ride=existing??decodeReceptionSnapshot((await apiReceptionBackend.office()).reception).rides.find(r=>r.id===id);
      if(!ride?.backendRideId||!ride.rideVersion)throw new Error('أكمل عنوان الطلب أولًا');
      if((ride.queuedDriverId&&ride.queuedDriverId!==input.driverId)||(activeRideStatuses.includes(ride.status)&&ride.driverId!==input.driverId))throw new Error('تغيّر سائق الطلب؛ راجع التعيين الحالي في الجدول');
      if(!ride.queuedDriverId&&!activeRideStatuses.includes(ride.status))await apiReceptionBackend.changeJob({type:'send',rideId:ride.backendRideId,version:ride.rideVersion,driverId:input.driverId});
    }
    await refreshOffice();setAdding(false);setRequestCustomer(null);
  }
  async function send(id: string, driverId: string, shareCustomerPhone = true) {
    if (assignmentLocks.current.has(id)) return;
    assignmentLocks.current.add(id);
    try {
      const ride=data.rides.find(r=>r.id===id);
      if (!ride?.backendRideId || !ride.rideVersion) throw new Error('أكمل عنوان الطلب أولًا');
      await apiReceptionBackend.changeJob({type:'send',rideId:ride.backendRideId,version:ride.rideVersion,driverId,shareCustomerPhone});
    } finally { try { await refreshOffice(); } finally { assignmentLocks.current.delete(id); } }
  }
  const sendChoices=(officeData?.drivers??[]).map(d=>({id:d.id,driverId:d.id,label:d.fullName,...driverPresentation(d,data.rides),searchText:`${d.phoneLocal??d.phone??''} ${officeData?.vehicles.find(v=>v.id===d.currentVehicleId)?.plate??''}`,disabled:!d.active||!['Available','Busy'].includes(d.status)})).sort((a,b)=>a.driverGroup-b.driverGroup||a.id.localeCompare(b.id));
  async function assign(id: string, driverId: string, fromQueue = false) {
    if(assignmentLocks.current.has(id))throw new Error('جارٍ تعيين السائق لهذا الطلب');assignmentLocks.current.add(id);try{
    const ride=data.rides.find(r=>r.id===id); if(!ride)throw new Error('الطلب غير متاح');
    const state=ride.dispatchStatus??({assigned:'SENT','driver-accepted':'ACCEPTED','driver-arriving':'ACCEPTED',arrived:'ARRIVED','in-progress':'STARTED',completed:'COMPLETED',cancelled:'CANCELLED'} as Record<string,string>)[ride.status]??'PENDING';
    if(['COMPLETED','CANCELLED'].includes(state))throw new Error('الطلب مغلق نهائيًا');
    if((ride.driverId??'')===(driverId||''))return;
    const previous=officeData?.drivers.find(d=>d.id===ride.driverId);
    const next=officeData?.drivers.find(d=>d.id===driverId);
    const reassignment={previousDriverId:ride.driverId??null,previousDriverName:previous?.fullName??null,newDriverId:driverId||null,newDriverName:next?.fullName??null,user:tenant||'مستخدم المكتب',at:new Date().toISOString(),afterSend:['SENT','ACCEPTED','REJECTED','ARRIVING','ARRIVED','STARTED'].includes(state),statusAfterReassignment:['SENT','ACCEPTED','REJECTED','ARRIVING','ARRIVED','STARTED'].includes(state)?'PENDING':state};
    await backend.saveRide({...ride,driverId:driverId||null,shiftId:null,dispatchStatus:reassignment.afterSend?'PENDING':ride.dispatchStatus,reassignmentLog:[...(Array.isArray((ride as Ride & {reassignmentLog?:unknown[]}).reassignmentLog)?(ride as Ride & {reassignmentLog:unknown[]}).reassignmentLog:[]),reassignment]} as Ride);
    try {
      if(fromQueue && !ride.driverId && driverId) await apiReceptionBackend.driverQueue({type:'remove',driverId,queueLocationId:null});
    } finally { await refreshOffice(); }
    }finally{assignmentLocks.current.delete(id);}
  }
  function drag(result: DropResult) {
    if (!result.destination) return;
    const shiftId = result.draggableId.replace(/^queue(?:-floating)?:/, '');
    const destination = result.destination;
    void run(async () => {
      if (destination.droppableId.startsWith('ride:')) await assign(destination.droppableId.slice(5), shiftId, true);
      else if (['driver-queue','driver-queue-floating'].includes(destination.droppableId) && officeData) await reorderOfficeQueue(result, officeData, refreshOffice);
    });
  }
  useEffect(()=>{registerReceptionDrop?.(drag);return()=>registerReceptionDrop?.(null);});
  if (!auth.authReady) return <div role="status" className="p-12 text-center">جارٍ استعادة جلسة المكتب…</div>;
  if (!connected) return <LoginForm/>;
  const call=latestCall??data.latest;
  const callWhatsApp=whatsappLink(call?.phone,'تكسي نابلس والمهندس — كيف يمكننا مساعدتك؟');
  const content = <div dir="rtl" className="reception-workspace flex h-full min-h-0 flex-col overflow-hidden bg-slate-50" onKeyDown={event=>{if(event.defaultPrevented)return;const action=receptionShortcut(event);if(action==='active'||action==='app'){event.preventDefault();const tab=event.currentTarget.querySelector<HTMLButtonElement>(`[data-filter="${action}"]`);tab?.click();tab?.focus();}if(action==='new'){event.preventDefault();setSelectedPlace(null);setLocation({addressText:'',latitude:null,longitude:null,locationSource:'MANUAL_TEXT'});setAdding(true);}if(action==='queue'){event.preventDefault();openQueueWindow?openQueueWindow():setQueueWindow(true);}}}>
    <OfficeStatusCards data={sharedOfficeData||officeData}/><div aria-label="أدوات الاستقبال" className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b bg-card px-2 py-1 [&_button]:h-11 sm:[&_button]:h-8"><Button title="طلب جديد (Alt+N)" onClick={() => { setSelectedPlace(null); setLocation({ addressText: '', latitude: null, longitude: null, locationSource: 'MANUAL_TEXT' }); setAdding(true); }}>طلب جديد</Button>
      <Button variant="outline" disabled={busy} onClick={()=>{const now=new Date();setEditing({id:uuidv4(),passengerName:'أرضي',passengerPhone:'0000',pickup:{name:'',coords:{x:0,y:0}},addressText:'',locationSource:'MANUAL_TEXT',latitude:null,longitude:null,status:'pending',dispatchStatus:'PENDING',driverId:null,totalFare:null,movingFee:false,source:'LANDLINE',receptionPending:false,createdAt:now,updatedAt:now});}}>أرضي</Button>
      <div className="flex max-w-full flex-wrap items-center gap-1.5 sm:border-r sm:border-slate-200 sm:pr-2">
        <Sheet open={driversPanel} onOpenChange={setDriversPanel}><SheetTrigger asChild><Button variant="outline" aria-label="المتصلون والدور">المتصلون / الدور</Button></SheetTrigger><SheetContent side="left" dir="rtl" className="office-theme reception-driver-panel flex w-[min(92vw,540px)] max-w-none flex-col overflow-hidden sm:max-w-xl"><SheetTitle>المتصلون والدور</SheetTitle><Tabs defaultValue="connected" className="flex min-h-0 flex-1 flex-col"><TabsList className="grid grid-cols-2"><TabsTrigger value="connected">المتصلون</TabsTrigger><TabsTrigger value="queue">الدور</TabsTrigger></TabsList><TabsContent value="connected" className="min-h-0 flex-1 overflow-auto">{officeData&&<ConnectedDrivers drivers={officeData.drivers.filter(d=>d.active&&d.status!=='Offline')} rides={data.rides}/>}</TabsContent><TabsContent value="queue" className="min-h-0 flex-1 overflow-auto">{officeData&&<><OfficeQueuePanel data={officeData} refresh={refreshOffice} embedded queueId="driver-queue"/><OfficeDriverJobs rides={data.rides} drivers={officeData.drivers} refresh={refreshOffice}/></>}</TabsContent></Tabs></SheetContent></Sheet><Button title="قائمة الدور (Alt+Q)" variant="outline" onClick={()=>openQueueWindow?openQueueWindow():setQueueWindow(true)}>قائمة الدور</Button>
        <Button title="فتح صفحة كشف الزبون" variant="outline" onClick={() => router.push('/office/customer-history')}>كشف زبون</Button>
      </div>
      {!sharedOfficeData&&<OfficeLiveNotifications compact />}
      <section aria-label="آخر مكالمة" className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:ms-auto">
        <Button variant="outline" disabled={!call||busy} onClick={()=>void openLatestCall()} onDoubleClick={()=>void openLatestCall()} className="min-w-0 max-w-full gap-2 border-yellow-400 bg-yellow-100 px-3 text-sm text-yellow-950" aria-label={call?`فتح طلب آخر مكالمة: ${call.phone}`:'لا توجد مكالمة'} title={['فتح طلب المكالمة',call?.source,call?.line?`الخط: ${call.line}`:null].filter(Boolean).join(' · ')}>
          <Phone size={14} aria-hidden="true" className="shrink-0"/><span>آخر مكالمة:</span>
          <bdi dir="ltr" className="truncate font-bold tabular-nums">{call?.source==='WHATSAPP'&&<span aria-label="واتساب" className="font-bold text-green-800">W </span>}{call?.phone??'—'}</bdi>
        </Button>
        {callWhatsApp?<a className="inline-flex h-11 items-center rounded border px-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 sm:h-8" target="_blank" rel="noopener noreferrer" href={callWhatsApp} title="فتح واتساب">واتساب</a>:<Button variant="outline" disabled className="px-2 text-xs" title="لا يوجد رقم صالح لواتساب">واتساب</Button>}
        {busy&&<span role="status" className="sr-only">جارٍ تنفيذ العملية…</span>}
      </section>
    </div>
    {error&&<div role="alert" className="flex shrink-0 items-center gap-2 border-b border-red-200 bg-red-50 px-3 py-1 text-sm text-red-800">{error}<Button size="sm" variant="ghost" disabled={busy} onClick={()=>void run(refreshOffice)}>إعادة المحاولة</Button></div>}
    {!openQueueWindow&&<FloatingQueueWindow open={queueWindow} onClose={()=>setQueueWindow(false)}>{officeData&&<OfficeQueuePanel data={officeData} refresh={refreshOffice} embedded queueId="driver-queue-floating"/>}</FloatingQueueWindow>}
    {showPlaces && <div className="max-h-[35vh] shrink-0 overflow-auto"><CustomerPlacesMap onRequest={place => { setSelectedPlace(place); setLocation(locationFromPlace(place)); setAdding(true); }} onLocation={value => { setSelectedPlace(null); setLocation(value); setAdding(true); }} /></div>}
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2 xl:flex-row">
      <OfficeReceptionTable rides={data.rides} drivers={data.drivers} choices={choices} sendChoices={sendChoices} onSend={send} onWithdraw={async id=>{const ride=data.rides.find(r=>r.id===id);if(!ride?.backendRideId||ride.rideVersion==null)throw new Error('الطلب غير متاح');await apiReceptionBackend.changeJob({type:'withdraw',rideId:ride.backendRideId,version:ride.rideVersion});await refreshOffice();}} onFare={saveInlineFare} onEdit={setEditing} onAssign={assign} onSave={save} onDuplicate={async ride=>{await backend.saveRide(ride);await refreshOffice();}} />

    </div>
      <ResponsiveDialog open={adding || !!editing} onOpenChange={open => { if (!open) { setAdding(false); setEditing(null); } }} title={editing ? 'تعديل الطلب' : 'طلب جديد'}>
      {editing ? <ReceptionEditForm optionalAddress loadSuggestedPlaces={loadSuggestedPlaces} key={editing.id} ride={editing} onSave={save} onCancel={()=>setEditing(null)} /> : <CallLoggerForm optionalAddress loadSuggestedPlaces={loadSuggestedPlaces} key={selectedPlace?.address.id ?? requestCustomer?.id ?? 'manual'} initialSavedAddressId={selectedPlace?.address.id} lookupCustomer={lookupCustomer} initialAddress={location.addressText || (location.latitude != null ? 'موقع محدد على الخريطة' : '')} initialPhone={selectedPlace?.phone??requestCustomer?.phone} initialName={selectedPlace?.customerName??requestCustomer?.fullName} onAddRide={add} onEditRide={save} shifts={sendChoices} customers={customers} customerPlaces={customerPlaces} locationTools={<LocationFields compact value={location} onChange={setLocation} onSelectSaved={selectCustomerPlace} />} onCancel={()=>{setAdding(false);setSelectedPlace(null);setRequestCustomer(null);}} onQuickCreateCustomer={async(fullName,phone)=>{const customer=await apiReceptionBackend.createCustomer(fullName,phone);setCustomers(current=>[...current,customer]);return customer;}} />}
    </ResponsiveDialog>
    <div className="shrink-0"><ReceptionFooter total={data.rides.length} /></div>
  </div>;
  return openQueueWindow?content:<DragDropContext onDragEnd={drag}>{content}</DragDropContext>;
}
