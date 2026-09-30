"use client";
import { DispatchMonitor } from './dispatch-monitor';
import { FloatingQueueWindow } from './floating-queue-window';
import { v4 as uuidv4 } from 'uuid';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { findCustomerByPhone, locationFromPlace, type CustomerPlace, type RequestLocation } from '@/lib/customer-places';
import { LocationFields } from './location-fields';
const CustomerPlacesMap = dynamic(() => import('./customer-places-map').then(m => m.CustomerPlacesMap), { ssr: false });

const empty: ReceptionSnapshot = { rides: [], drivers: [], vehicles: [], shifts: [], queue: [], latest: null };
const backend = getReceptionBackend(false, true);

// Reuses the existing reception forms, table, queue and drag/drop; all reads and writes use one provider.
export function ApiReception({ initialShowPlaces = false, officeTenant }: { initialShowPlaces?: boolean; officeTenant?: string }) {
  const [connected, setConnected] = useState(!!officeTenant);
  const [data, setData] = useState(empty);
  const [customers,setCustomers]=useState<import('@/lib/customer-places').ApiCustomer[]>([]);const [customerPlaces,setCustomerPlaces]=useState<CustomerPlace[]>([]);
  const [officeData, setOfficeData] = useState<OfficeData | null>(null);

  const [error, setError] = useState('');
  const [tenant, setTenant] = useState(officeTenant ?? ''); const [username, setUsername] = useState(''); const [password, setPassword] = useState('');
  const actionLock=useRef(false);const assignmentLocks=useRef(new Set<string>());
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Ride | null>(null); const [adding, setAdding] = useState(false);

  const [queueWindow,setQueueWindow] = useState(false);
  const searchParams=useSearchParams();
  const [showPlaces, setShowPlaces] = useState(initialShowPlaces);
  const [location, setLocation] = useState<RequestLocation>({ addressText: '', latitude: null, longitude: null, locationSource: 'MANUAL_TEXT' });
  const [selectedPlace, setSelectedPlace] = useState<CustomerPlace | null>(null);
  const [requestCustomer,setRequestCustomer]=useState<import('@/lib/customer-places').ApiCustomer|null>(null);
  const selectCustomerPlace = useCallback((place: CustomerPlace) => { setSelectedPlace(place); setRequestCustomer(customers.find(c=>c.id===place.address.customerId)??null); setLocation(locationFromPlace(place)); }, [customers]);
  useEffect(() => { if (!connected) return; return apiReceptionBackend.watchLatest(failure => setError(failure.message)); }, [connected]);
  useEffect(() => {
    if (!connected) return;
    return apiReceptionBackend.subscribe(next => { setData(next); setError(''); }, failure => setError(failure.message));
  }, [connected]);
  async function refreshOffice() { const next = await apiReceptionBackend.office(); setOfficeData(next); setData(decodeReceptionSnapshot(next.reception)); }
  useEffect(() => {
    if (!connected) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    async function poll() { try { const next = await apiReceptionBackend.office(); if (!stopped) { setOfficeData(next); setError(''); } } catch (e) { if (!stopped) setError((e as Error).message); } if (!stopped) timer = setTimeout(poll, 2000); }
    void poll(); return () => { stopped = true; clearTimeout(timer); };
  }, [connected]);
  const lookupCustomer=useCallback(async(phone:string)=>{
    const customer=findCustomerByPhone(await apiReceptionBackend.customers(phone),phone)??null;
    return {customer,places:customer?await apiReceptionBackend.places('',customer.id):[]};
  },[]);
  useEffect(()=>{if(!connected||!searchParams.get('customerId'))return;let stopped=false;const customerId=searchParams.get('customerId')!;void Promise.all([apiReceptionBackend.customer(customerId),apiReceptionBackend.places('',customerId)]).then(([c,ps])=>{if(!stopped){const place=ps.find(x=>x.address.id===searchParams.get('addressId'))??ps.find(x=>x.address.isDefault)??ps[0];setRequestCustomer(c);setSelectedPlace(place??null);setLocation(place?locationFromPlace(place):{addressText:'',latitude:null,longitude:null,locationSource:'MANUAL_TEXT'});setAdding(true);}}).catch(e=>{if(!stopped)setError((e as Error).message);});return()=>{stopped=true;};},[connected,searchParams]);
  useEffect(() => () => { if (!officeTenant) apiReceptionBackend.logout(); }, [officeTenant]);
  const choices = useMemo(() => (officeData?.drivers??[]).filter(d=>d.active&&d.status!=='Suspended').map(d=>({id:d.id,driverId:d.id,label:d.fullName,searchText:`${d.phoneLocal??d.phone} ${officeData?.vehicles.find(v=>v.id===d.currentVehicleId)?.plate??''}`,disabled:d.status==='Busy'||data.rides.some(r=>r.driverId===d.id&&activeRideStatuses.includes(r.status)),queuePosition:data.queue.find(q=>q.driverId===d.id)?.position})).sort((a,b)=>(a.queuePosition??Infinity)-(b.queuePosition??Infinity)),[data,officeData]);
  async function run(action: () => Promise<void>) { if (actionLock.current) return; actionLock.current=true; setBusy(true); setError(''); try { await action(); await refreshOffice(); } catch (failure) { setError((failure as Error).message); } finally { actionLock.current=false; setBusy(false); } }
  async function save(ride: Ride) { await backend.saveRide(ride); await refreshOffice(); setEditing(null); setAdding(false); setRequestCustomer(null); }
  async function add(input: Omit<Ride, 'id' | 'status' | 'driverId' | 'createdAt' | 'updatedAt' | 'isNew'> & { id?: string; status?: RideStatus; driverId?: string | null }) {
    const selectedFields:RequestLocation & {customerId?:string;savedAddressId?:string|null}=input.savedAddressId?{customerId:input.customerId,savedAddressId:input.savedAddressId,addressText:input.addressText??input.pickup.name,neighborhood:input.neighborhood,street:input.street,latitude:input.latitude??null,longitude:input.longitude??null,locationSource:input.locationSource??'SAVED_ADDRESS',notes:input.notes}:{...location,locationSource:location.locationSource==='SAVED_ADDRESS'?'MANUAL_TEXT':location.locationSource};
    const addressText=!location.addressText&&location.latitude!=null&&input.pickup.name==='موقع محدد على الخريطة'?'':input.pickup.name;
    const changedAddress=addressText!==(selectedFields.addressText??'');
    await save({ ...input, ...selectedFields, savedAddressId:!changedAddress&&selectedFields.locationSource==='SAVED_ADDRESS'?selectedFields.savedAddressId??selectedPlace?.address.id:null, locationSource:changedAddress?'MANUAL_TEXT':selectedFields.locationSource, addressText, pickup:{name:addressText,coords:{x:selectedFields.latitude??0,y:selectedFields.longitude??0}},notes:input.notes||selectedFields.notes,id:input.id??uuidv4(),status:input.status??'pending',driverId:input.driverId??null,createdAt:new Date(),updatedAt:new Date() });
  }
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
  if (!connected) return <form dir="rtl" className="mx-auto mt-12 max-w-md space-y-4 p-4" onSubmit={event => { event.preventDefault(); void run(async () => { await apiReceptionBackend.login(tenant, username, password); setPassword(''); setData(empty); setConnected(true); }); }}>
    <h1 className="text-xl font-bold">تسجيل الدخول إلى مكتب الاستقبال</h1>
    <Input aria-label="معرف المكتب" placeholder="معرف المكتب" value={tenant} onChange={e => setTenant(e.target.value)} required autoComplete="organization" />
    <Input aria-label="اسم المستخدم" placeholder="اسم المستخدم" value={username} onChange={e => setUsername(e.target.value)} required autoComplete="username" />
    <Input aria-label="كلمة المرور" placeholder="كلمة المرور" type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" />
    <Button disabled={busy}>دخول</Button>{error && <p role="alert">{error}</p>}
  </form>;
  return <DragDropContext onDragEnd={drag}><div dir="rtl" className="flex h-full min-h-0 flex-col overflow-hidden bg-secondary/50">
    <DispatchMonitor />
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-card px-2 py-1 [&_button]:h-8"><Button onClick={() => { setSelectedPlace(null); setLocation({ addressText: '', latitude: null, longitude: null, locationSource: 'MANUAL_TEXT' }); setAdding(true); }}>طلب جديد</Button>
      <Button disabled={busy} onClick={()=>void run(async()=>{const now=new Date();await backend.saveRide({id:uuidv4(),passengerName:'أرضي',passengerPhone:'0000',pickup:{name:'',coords:{x:0,y:0}},addressText:'',locationSource:'MANUAL_TEXT',latitude:null,longitude:null,status:'pending',dispatchStatus:'PENDING',driverId:null,totalFare:0,movingFee:false,source:'MANUAL',receptionPending:false,createdAt:now,updatedAt:now});})}>أرضي</Button>
      <Button variant="outline" onClick={() => setShowPlaces(value => !value)}>أماكن الزبائن المحفوظة</Button>
      <Button variant="outline" onClick={()=>setQueueWindow(true)}>فتح الدور</Button><span role="status">{error || 'متصل بخادم المكتب'}</span>
    </div>
    <FloatingQueueWindow open={queueWindow} onClose={()=>setQueueWindow(false)}>{officeData&&<OfficeQueuePanel data={officeData} refresh={refreshOffice} embedded queueId="driver-queue-floating"/>}</FloatingQueueWindow>
    {showPlaces && <div className="max-h-[35vh] shrink-0 overflow-auto"><CustomerPlacesMap onRequest={place => { setSelectedPlace(place); setLocation(locationFromPlace(place)); setAdding(true); }} onLocation={value => { setSelectedPlace(null); setLocation(value); setAdding(true); }} /></div>}
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
      <OfficeReceptionTable rides={data.rides} drivers={data.drivers} choices={choices} onEdit={setEditing} onAssign={assign} onSave={save} onDuplicate={async ride=>{await backend.saveRide(ride);await refreshOffice();}} />
      {officeData && <OfficeQueuePanel data={officeData} refresh={refreshOffice} embedded/>}
    </div>
    <ResponsiveDialog open={adding || !!editing} onOpenChange={open => { if (!open) { setAdding(false); setEditing(null); } }} title={editing ? 'تعديل الطلب' : 'طلب جديد'}>
      {editing ? <ReceptionEditForm optionalAddress key={editing.id} ride={editing} onSave={save} onCancel={()=>setEditing(null)} /> : <CallLoggerForm optionalAddress key={selectedPlace?.address.id ?? requestCustomer?.id ?? 'manual'} initialSavedAddressId={selectedPlace?.address.id} lookupCustomer={lookupCustomer} initialAddress={location.addressText || (location.latitude != null ? 'موقع محدد على الخريطة' : '')} initialPhone={selectedPlace?.phone??requestCustomer?.phone} initialName={selectedPlace?.customerName??requestCustomer?.fullName} onAddRide={add} onEditRide={save} shifts={choices} customers={customers} customerPlaces={customerPlaces} locationTools={<LocationFields compact value={location} onChange={setLocation} onSelectSaved={selectCustomerPlace} />} onCancel={()=>{setAdding(false);setSelectedPlace(null);setRequestCustomer(null);}} onQuickCreateCustomer={async(fullName,phone)=>{const customer=await apiReceptionBackend.createCustomer(fullName,phone);setCustomers(current=>[...current,customer]);return customer;}} />}
    </ResponsiveDialog>
    <div className="shrink-0"><ReceptionFooter total={data.rides.length} /></div>
  </div></DragDropContext>;
}
