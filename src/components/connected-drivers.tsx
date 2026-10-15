"use client";
import {useState} from 'react';
import type {OfficeDriver} from '@/lib/office';
import type {Ride} from '@/lib/types';
import {driverGroups,driverPresentation} from '@/lib/driver-presentation';

export function ConnectedDrivers({drivers,rides}:{drivers:OfficeDriver[];rides:Ride[]}) {
 const [search,setSearch]=useState('');
 const [offlineExpanded,setOfflineExpanded]=useState<boolean|null>(null);
 const groups=driverGroups.map(group=>({...group,title:group.label}));
 const rows=drivers.map(driver=>{const presentation=driverPresentation(driver,rides);return {driver,rank:presentation.driverGroup,waiting:presentation.waitingCount};}).sort((a,b)=>a.rank-b.rank||a.driver.id.localeCompare(b.driver.id));
 const visible=rows.filter(({driver})=>(driver.fullName+' '+(driver.phoneLocal??driver.phone??'')).includes(search.trim()));
 return <aside dir="rtl" aria-label="السائقون المتصلون" className="reception-drivers flex min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border bg-white">
 <div className="shrink-0 space-y-2 border-b p-2"><h2 className="flex justify-between gap-1 text-sm font-bold">السائقون المتصلون <span className="text-slate-500">{rows.filter(row=>row.rank!==3).length}</span></h2><input type="search" aria-label="بحث السائقين المتصلين" placeholder="بحث بالاسم أو الهاتف" value={search} onChange={e=>setSearch(e.target.value)} className="h-8 w-full rounded-md border border-slate-300 px-2 text-sm"/></div>
 <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">{groups.map((group,rank)=><section key={group.title} aria-label={group.title} className="mb-2"><h3 className={'sticky top-0 z-10 flex items-center justify-between rounded px-2 py-1.5 text-xs font-bold '+group.color}><button type="button" tabIndex={rank===3?0:-1} className="flex w-full justify-between" aria-expanded={rank===3?(!!search.trim()||(offlineExpanded??rows.filter(row=>row.rank===3).length<=5)):undefined} onClick={()=>{if(rank===3)setOfflineExpanded(!(offlineExpanded??rows.filter(row=>row.rank===3).length<=5));}}><span>{rank===3?'▾ ':''}{group.title}</span><span>{visible.filter(row=>row.rank===rank).length}</span></button></h3><ul hidden={rank===3&&!search.trim()&&!(offlineExpanded??rows.filter(row=>row.rank===3).length<=5)}>{visible.filter(row=>row.rank===rank).map(({driver,waiting})=><li key={driver.id} title={driver.fullName} className="flex min-h-9 items-center justify-between gap-2 border-b border-slate-100 px-2 py-1"><span className="truncate font-medium">{driver.fullName}</span>{(rank===2||waiting>0)&&<span className="shrink-0 rounded bg-slate-100 px-1.5 text-xs text-slate-600">انتظار {waiting}</span>}</li>)}</ul></section>)}{!visible.length&&<p className="p-3 text-center text-sm text-slate-500">{search?'لا يوجد سائق مطابق للبحث':'لا يوجد سائقون لعرضهم'}</p>}</div>
 </aside>;
}
