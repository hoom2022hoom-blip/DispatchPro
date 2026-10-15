"use client";
import {receptionError} from '@/lib/reception-feedback';

import {useEffect,useRef,useState} from 'react';
import {apiReceptionBackend} from '@/lib/reception-api';
import type {DriverJob,DriverJobAction} from '@/lib/driver-jobs';
import type {Ride} from '@/lib/types';

export function OfficeDriverJobs({rides,drivers,refresh}:{rides:Ride[];drivers:{id:string;fullName:string;active:boolean;status:string}[];refresh:()=>Promise<void>}) {
 const [jobs,setJobs]=useState<DriverJob[]>([]),[driverId,setDriverId]=useState(''),[rideId,setRideId]=useState(''),[error,setError]=useState(''),[pending,setPending]=useState(false);
 const lock=useRef(false);
 useEffect(()=>{let live=true;let timer:ReturnType<typeof setTimeout>;async function poll(){try{const data=await apiReceptionBackend.jobs();if(live)setJobs(data);}catch(e){if(live)setError(receptionError(e));}if(live)timer=setTimeout(poll,2000);}void poll();return()=>{live=false;clearTimeout(timer);};},[]);
 async function mutate(action:DriverJobAction){if(lock.current)return;lock.current=true;setPending(true);setError('');try{await apiReceptionBackend.changeJob(action);setJobs(await apiReceptionBackend.jobs());await refresh();setRideId('');}catch(e){setError(receptionError(e));try{setJobs(await apiReceptionBackend.jobs());await refresh();}catch{}}finally{lock.current=false;setPending(false);}}
 const eligible=drivers.filter(d=>d.active&&['Available','Busy'].includes(d.status));
 const rows=jobs.filter(j=>j.driverId===driverId).sort((a,b)=>a.position-b.position);
 const candidates=rides.filter(r=>r.backendRideId&&r.rideVersion&&!r.receptionPending&&['pending','waiting'].includes(r.status)&&!jobs.some(j=>j.rideId===r.backendRideId));
 return <section dir="rtl" aria-label="طابور رحلات السائق" className="max-h-[45vh] shrink-0 space-y-2 overflow-auto border-t bg-slate-50 p-3">
  <h2 className="font-bold">طابور رحلات السائق</h2><p className="text-sm">الطلبات المنتظرة تُرسل بالترتيب بعد إنهاء الطلب الحالي. إزالة الطلب من الطابور تعيده للمكتب دون إلغائه.</p>
  {error&&<p role="alert" className="text-red-700">{error}</p>}
  <div className="flex flex-wrap gap-2"><select aria-label="سائق طابور الرحلات" className="min-h-11 max-w-full rounded border p-2" value={driverId} onChange={e=>setDriverId(e.target.value)}><option value="">اختر السائق</option>{drivers.map(d=><option key={d.id} value={d.id}>{d.fullName} · {d.status==='Busy'?'مشغول':d.status==='Available'?'متاح':'غير متاح'} ({jobs.filter(j=>j.driverId===d.id).length})</option>)}</select>
  <select aria-label="طلب لإضافته للطابور" className="min-h-11 max-w-full rounded border p-2" value={rideId} onChange={e=>setRideId(e.target.value)}><option value="">اختر طلبًا منتظرًا</option>{candidates.map(r=><option key={r.id} value={r.backendRideId}>#{r.orderNumber} · {r.passengerName} · {r.pickup.name}</option>)}</select>
  <button className="min-h-11 rounded border px-4 disabled:opacity-40" disabled={pending||!rideId||!eligible.some(d=>d.id===driverId)} onClick={()=>{const ride=candidates.find(r=>r.backendRideId===rideId);if(ride)void mutate({type:'add',rideId,driverId,version:ride.rideVersion!});}}>إضافة للطابور</button></div>
  <ol className="space-y-2">{rows.map((job,index)=><li key={job.id} className="flex flex-wrap items-center gap-2 rounded border bg-white p-2"><span>{index+1}. {job.pickup} ← {job.destination||'غير محددة'}</span>
  <button aria-label={`تقديم الطلب ${index+1}`} className="min-h-11 min-w-11 rounded border" disabled={pending||index===0} onClick={()=>void mutate({type:'move',rideId:job.rideId,version:job.version,driverId,position:index})}>↑</button>
  <button aria-label={`تأخير الطلب ${index+1}`} className="min-h-11 min-w-11 rounded border" disabled={pending||index===rows.length-1} onClick={()=>void mutate({type:'move',rideId:job.rideId,version:job.version,driverId,position:index+2})}>↓</button>
  <select aria-label={`نقل الطلب ${index+1} إلى سائق`} className="min-h-11 rounded border p-2" disabled={pending} value="" onChange={e=>{if(e.target.value)void mutate({type:'move',rideId:job.rideId,version:job.version,driverId:e.target.value});}}><option value="">نقل إلى سائق…</option>{eligible.filter(d=>d.id!==driverId).map(d=><option key={d.id} value={d.id}>{d.fullName}</option>)}</select>
  <button className="min-h-11 rounded border px-3" disabled={pending} onClick={()=>void mutate({type:'remove',rideId:job.rideId,version:job.version})}>إزالة من الطابور</button></li>)}</ol>
  {driverId&&!rows.length&&<p>لا توجد رحلات منتظرة لهذا السائق.</p>}
 </section>;
}
