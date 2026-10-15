"use client";
import {receptionTime} from '@/lib/reception-display';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DragDropContext, Draggable, type DropResult } from '@hello-pangea/dnd';
import { StrictModeDroppable } from './strict-mode-droppable';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useOffice } from './office-workspace';
import { apiReceptionBackend as api } from '@/lib/reception-api';
import { officeDriverStatus, type OfficeData, type QueueLocation } from '@/lib/office';

export async function reorderOfficeQueue(result: DropResult, data: OfficeData, refresh: () => Promise<void>) {
  if (!result.destination || !['driver-queue','driver-queue-floating'].includes(result.destination.droppableId)) return;
  const entries = [...data.reception.queue].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const current = entries.find(q => q.driverId === result.draggableId.replace(/^queue(?:-floating)?:/, ''));
  if (!current?.driverId) return;
  const remaining = entries.filter(q => q !== current);
  await api.driverQueue({ type: 'move', driverId: current.driverId, queueLocationId: current.queueLocationId ?? null, beforeDriverId: remaining[result.destination.index]?.driverId });
  await refresh();
}

export function OfficeQueuePanel({ data, refresh, embedded = false, queueId = 'driver-queue' }: { data: OfficeData; refresh: () => Promise<void>; embedded?: boolean; queueId?: string }) {
  const sizeKey='dispatchpro.queue.sizes.v1';
  const [columns,setColumns]=useState([28,100,80,52]);const [panelWidth,setPanelWidth]=useState(280);const [sizesLoaded,setSizesLoaded]=useState(false);
  const sizing=useRef<{index:number;start:number;width:number}|null>(null);
  useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem(sizeKey)??'null');if(saved){if(Array.isArray(saved.columns)&&saved.columns.length===4)setColumns(saved.columns.map((v:number,i:number)=>Math.max([24,60,50,42][i],Math.min([45,300,240,100][i],Number(v)||[28,100,80,52][i]))));setPanelWidth(Math.max(240,Math.min(640,Number(saved.width)||280)));}}catch{}setSizesLoaded(true);},[]);
  useEffect(()=>{if(sizesLoaded)try{localStorage.setItem(sizeKey,JSON.stringify({columns,width:panelWidth}));}catch{}},[columns,panelWidth,sizesLoaded]);
  const resize=(event:React.PointerEvent<HTMLElement>)=>{const active=sizing.current;if(!active)return;const width=active.width+(active.index===-1?event.clientX-active.start:active.start-event.clientX);if(active.index===-1)setPanelWidth(Math.max(240,Math.min(640,width)));else setColumns(old=>old.map((v,i)=>i===active.index?Math.max([24,60,50,42][i],Math.min([45,300,240,100][i],width)):v));};
  const gridStyle={gridTemplateColumns:columns.map(v=>v+'px').join(' '),minWidth:columns.reduce((a,b)=>a+b,0)+28};
  const mutationLock=useRef(false);
  const [highlight,setHighlight]=useState(0);
  const locationSelect=useRef<HTMLSelectElement>(null);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [selectedQueueDriver, setSelectedQueueDriver] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<{ id?: string; name: string; isActive: boolean; sortOrder: number }>({ name: '', isActive: true, sortOrder: 0 });
  const locations = data.reception.queueLocations ?? [];
  const entries = [...data.reception.queue].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const activeLocations = locations.filter(location => location.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
  const drivers = useMemo(() => data.drivers.filter(driver => {
    if (!driver.active || driver.status === 'Busy' || driver.status === 'Suspended' || officeDriverStatus(driver, data) === 'BUSY' || entries.some(entry => entry.driverId === driver.id)) return false;
    const plate = data.vehicles.find(vehicle => vehicle.id === driver.currentVehicleId)?.plate ?? '';
    return `${driver.fullName} ${driver.phoneLocal ?? driver.phone} ${plate}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  }), [data, search, entries]);
  useEffect(()=>{if(selectedDriver)locationSelect.current?.focus();},[selectedDriver]);
  const selectedEntry = entries.find(entry => entry.driverId === selectedQueueDriver);
  const selectedPosition = selectedEntry?.position ?? 0;
  const run = async (fn: () => Promise<void>) => {
    if (mutationLock.current) return;mutationLock.current=true;
    setPending(true); setError('');
    try { await fn(); await refresh(); }
    catch (failure) { setError((failure as Error).message); }
    finally { mutationLock.current=false;setPending(false); }
  };
  const chooseDriver = (id: string) => { setSelectedDriver(id); setSearch(''); setSearchOpen(false); setNewLocation(''); };
  const addDriver = () => void run(async () => {
    if (!selectedDriver || !newLocation || entries.some(entry => entry.driverId === selectedDriver)) return;
    await api.driverQueue({ type: 'add', driverId: selectedDriver, queueLocationId: newLocation });
    setSelectedDriver(''); setNewLocation(''); setSearch(''); setSearchOpen(false);
  });
  const mutateSelected = (type: 'up' | 'down' | 'remove') => {
    if (!selectedEntry?.driverId) return;
    void run(() => api.driverQueue({ type, driverId: selectedEntry.driverId!, queueLocationId: selectedEntry.queueLocationId ?? null }));
  };
  const changeSelectedLocation = (queueLocationId: string) => {
    if (!selectedEntry?.driverId || !queueLocationId || queueLocationId === selectedEntry.queueLocationId) return;
    void run(() => api.driverQueue({ type: 'transfer', driverId: selectedEntry.driverId!, queueLocationId, confirmTransfer: true, fromLocationId: selectedEntry.queueLocationId ?? null }));
  };
  const editLocation = (location?: QueueLocation) => setDraft(location ? { ...location } : { name: '', isActive: true, sortOrder: locations.length });

  return <aside style={embedded&&queueId==='driver-queue'?{width:panelWidth,maxWidth:'60vw'}:undefined} dir="rtl" aria-label="دور السائقين الموحد" className={`${embedded ? 'flex h-full min-h-0 w-full shrink-0 flex-col overflow-hidden lg:min-w-[240px]' : 'w-full max-w-3xl'} relative space-y-1.5 rounded-lg border bg-white p-2 [&_button]:h-7 [&_input]:h-8 [&_select]:h-8`}>
    <div className="flex items-center justify-between"><h2 className="font-bold">دور السائقين</h2><span className="text-xs text-slate-500">{entries.length} سائق</span></div>
    <div className="grid grid-cols-3 gap-1" aria-label="التحكم بالدور">
      <Button type="button" variant="outline" disabled={pending || !selectedEntry || selectedPosition <= 1} onClick={() => mutateSelected('up')}>↑ رفع</Button>
      <Button type="button" variant="outline" disabled={pending || !selectedEntry || selectedPosition >= entries.length} onClick={() => mutateSelected('down')}>↓ تنزيل</Button>
      <Button type="button" variant="outline" disabled={pending || !selectedEntry} onClick={() => mutateSelected('remove')}>إزالة</Button>
    </div>
    {selectedEntry && <div className="space-y-1">
      <label className="text-xs text-slate-600" htmlFor={`${queueId}-selected-location`}>تغيير موقع السائق المحدد</label>
      <select id={`${queueId}-selected-location`} aria-label="تغيير موقع السائق المحدد" className="h-9 w-full rounded border bg-white px-2 text-sm" disabled={pending} value={selectedEntry.queueLocationId ?? ''} onChange={event => changeSelectedLocation(event.target.value)}>
        <option value="">اختر الموقع</option>{activeLocations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
      </select>
    </div>}
    <div className="relative space-y-2">
      <Input role="combobox" aria-expanded={searchOpen} aria-controls={`${queueId}-options`} aria-activedescendant={searchOpen&&drivers[highlight]?`${queueId}-option-${highlight}`:undefined} aria-label="بحث السائقين للدور" placeholder="ابحث بالاسم أو الهاتف أو اللوحة" value={selectedDriver ? data.drivers.find(driver => driver.id === selectedDriver)?.fullName ?? '' : search} disabled={pending} onFocus={() => setSearchOpen(true)} onChange={event => { setSelectedDriver(''); setSearch(event.target.value);setHighlight(0); setSearchOpen(true); }} onKeyDown={event => { if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setSearchOpen(false);}else if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setSearchOpen(true);setHighlight(i=>Math.max(0,Math.min(drivers.length-1,i+(event.key==='ArrowDown'?1:-1))));}else if(event.key==='Enter'&&searchOpen){event.preventDefault();if(!event.repeat&&drivers[highlight])chooseDriver(drivers[highlight].id);}else if(event.key==='Tab')setSearchOpen(false); }} />
      {searchOpen && <div id={`${queueId}-options`} role="listbox" aria-label="السائقون المتاحون" className="absolute inset-x-0 top-full z-20 max-h-48 overflow-y-auto rounded border bg-white shadow-lg">
        <div className="sticky top-0 flex justify-end bg-white px-1"><button type="button" aria-label="إغلاق بحث السائقين" className="h-5 w-5 text-xs text-slate-500" onClick={() => setSearchOpen(false)}>X</button></div>
        {drivers.length ? drivers.map((driver,index) => <button type="button" role="option" id={`${queueId}-option-${index}`} tabIndex={-1} aria-selected={highlight === index} key={driver.id} className={`block min-h-10 w-full px-3 text-right text-sm hover:bg-slate-100 ${highlight===index?'bg-blue-50 ring-2 ring-inset ring-blue-600':''}`} onMouseDown={event => event.preventDefault()} onClick={() => chooseDriver(driver.id)}>{driver.fullName} · {driver.phoneLocal || driver.phone || '—'} · {data.vehicles.find(vehicle => vehicle.id === driver.currentVehicleId)?.plate ?? '—'}</button>) : <p className="p-3 text-sm text-slate-500">لا يوجد سائق مطابق</p>}
      </div>}
      {selectedDriver && <>
        <select ref={locationSelect} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();if(!event.repeat)(event.currentTarget.nextElementSibling as HTMLButtonElement|null)?.focus();}}} aria-label="موقع السائق" className="h-9 w-full rounded border bg-white px-2 text-sm" required disabled={pending} value={newLocation} onChange={event => setNewLocation(event.target.value)}>
          <option value="">اختر الموقع</option>{activeLocations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
        <Button type="button" className="w-full" disabled={pending || !newLocation || entries.some(entry => entry.driverId === selectedDriver)} onClick={addDriver}>إضافة للدور</Button>
      </>}
    </div>
    {!activeLocations.length && <a className="block text-sm text-primary" href="/office/queue">أضف موقعًا من إدارة الدور</a>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

    <StrictModeDroppable droppableId={queueId} type="QUEUE_DRIVER" isDropDisabled={pending}>{provided => <div ref={provided.innerRef} {...provided.droppableProps} className={`${embedded ? 'min-h-0 flex-1 overflow-auto' : 'min-h-12'} space-y-1`}><div style={gridStyle} className="sticky top-0 z-10 grid gap-1 bg-white px-2 text-xs text-slate-500">{['#','\u0627\u0644\u0633\u0627\u0626\u0642','\u0627\u0644\u0645\u0648\u0642\u0639','\u0627\u0644\u0648\u0642\u062a'].map((label,index)=><span key={label} className="relative py-1">{label}<span role="separator" aria-label={`Queue column ${index+1} width`} aria-orientation="vertical" className="absolute inset-y-0 left-0 w-2 cursor-col-resize touch-none border-l border-slate-300" onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);sizing.current={index,start:event.clientX,width:columns[index]};}} onPointerMove={resize} onPointerUp={event=>{resize(event);sizing.current=null;}} onLostPointerCapture={()=>{sizing.current=null;}}/></span>)}</div>
      {entries.map((entry, index) => {
        const driver = data.drivers.find(item => item.id === entry.driverId);
        const selected = entry.driverId === selectedQueueDriver;
        return <Draggable key={entry.driverId} draggableId={`${queueId==='driver-queue'?'queue':'queue-floating'}:${entry.driverId}`} index={index} isDragDisabled={pending}>{(drag,snapshot) => <div ref={drag.innerRef} {...drag.draggableProps} {...drag.dragHandleProps} style={{...gridStyle,...drag.draggableProps.style,opacity:snapshot?.isDragging?0.7:1}} role="button" tabIndex={0} aria-pressed={selected} aria-label={`اختيار ${driver?.fullName ?? 'سائق'}`} onClick={() => setSelectedQueueDriver(entry.driverId ?? '')} onKeyDown={event => { if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const rows=Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="button"]')??[]);rows[index+(event.key==='ArrowDown'?1:-1)]?.focus();return;}if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedQueueDriver(entry.driverId ?? ''); } }} className={`grid h-9 cursor-pointer  items-center gap-1 rounded border px-2 text-xs ${selected ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-400' : 'bg-slate-50 hover:bg-slate-100'}`}>
          <span className="font-bold">{entry.position}</span><span className="truncate text-sm" title={driver ? ({AVAILABLE:'متاح',BUSY:'مشغول',OFFLINE:'غير متصل',SUSPENDED:'موقوف'}[officeDriverStatus(driver,data)]) : 'غير متاح'}>{driver?.fullName ?? '—'}<small className="block truncate text-[10px] leading-3 text-slate-500">{driver ? ({AVAILABLE:'متاح',BUSY:'مشغول',OFFLINE:'غير متصل',SUSPENDED:'موقوف'}[officeDriverStatus(driver,data)]) : 'غير متاح'}</small></span><span className="truncate">{locations.find(location => location.id === entry.queueLocationId)?.name ?? '—'}</span><time>{receptionTime(entry.enteredAt ?? entry.joinedAt)}</time>
        </div>}</Draggable>;
      })}
      {provided.placeholder}{!entries.length && <p className="p-5 text-center text-sm text-slate-500">الدور فارغ</p>}
    </div>}</StrictModeDroppable>
    <div className="flex shrink-0 justify-end"><Button size="sm" variant="ghost" aria-label="Reset queue sizes" onClick={()=>{setColumns([28,100,80,52]);setPanelWidth(280);}}>Reset</Button></div>
    {embedded&&queueId==='driver-queue'&&<span role="separator" aria-label="Queue panel width" aria-orientation="vertical" className="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none" onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);sizing.current={index:-1,start:event.clientX,width:panelWidth};}} onPointerMove={resize} onPointerUp={event=>{resize(event);sizing.current=null;}} onLostPointerCapture={()=>{sizing.current=null;}}/>}
    {!embedded && <details className="rounded border p-3"><summary className="cursor-pointer font-medium">إدارة المواقع</summary><div className="my-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => editLocation()}>موقع جديد</Button>{locations.map(location => <Button key={location.id} size="sm" variant="ghost" onClick={() => editLocation(location)}>{location.name} · تعديل</Button>)}</div><form className="flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); void run(async () => { await api.saveQueueLocation(draft); editLocation(); }); }}><Input aria-label="اسم الموقع" className="max-w-xs" required maxLength={120} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /><Input aria-label="ترتيب عرض المواقع" className="w-20" type="number" min={0} value={draft.sortOrder} onChange={event => setDraft({ ...draft, sortOrder: Number(event.target.value) })} /><label><input type="checkbox" checked={draft.isActive} onChange={event => setDraft({ ...draft, isActive: event.target.checked })} /> مفعّل</label><Button disabled={pending}>حفظ الموقع</Button></form></details>}
  </aside>;
}

export function OfficeQueuePage() {
  const { data, refresh } = useOffice(); const [error, setError] = useState('');
  if (!data) return null;
  return <div className="space-y-3 p-5"><h1 className="text-xl font-bold">الدور الموحد وإدارة المواقع</h1>{error && <p role="alert" className="text-destructive">{error}</p>}<DragDropContext onDragEnd={result => { setError(''); void reorderOfficeQueue(result, data, refresh).catch(failure => setError(failure.message)); }}><OfficeQueuePanel data={data} refresh={refresh} /></DragDropContext></div>;
}
