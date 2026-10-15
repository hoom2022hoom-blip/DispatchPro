import type {OfficeData} from '@/lib/office';
export function OfficeStatusCards({data}:{data:OfficeData|null}){
 const counts=[0,0,0,0];
 for(const driver of data?.drivers||[]){const rides=data!.reception.rides.filter(r=>r.driverId===driver.id);const group=!driver.active||['Offline','Suspended'].includes(driver.status)?3:rides.some(r=>r.status==='driver-arriving')?2:driver.status==='Busy'||rides.some(r=>['assigned','driver-accepted','arrived','in-progress'].includes(r.status))?1:0;counts[group]++;}
 return <section aria-label="حالات السائقين" className="grid shrink-0 grid-cols-4 gap-2 border-b px-3 py-2">{['متاح','مشغول','في الطريق','غير متصل'].map((label,i)=><article key={label} className="rounded-lg border bg-white px-3 py-2"><span className="text-xs text-slate-500">{label}</span><strong className="mr-2 text-lg tabular-nums">{data?counts[i]:'—'}</strong></article>)}</section>;
}
