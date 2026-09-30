"use client";

import { useEffect, useRef, useState } from 'react';
import { apiReceptionBackend as api } from '@/lib/reception-api';
import type { OfficeData } from '@/lib/office';
import type { ApiCustomer, CustomerPlace } from '@/lib/customer-places';
import {downloadReportPage,printReportPage} from '@/lib/office-report-export';

type Person = { id:string; fullName:string; phone?:string };
type History = Awaited<ReturnType<typeof api.reportHistory>>;
const display = (value:unknown):string => value == null || value === '' ? '—' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
const time = (value:unknown) => value ? new Date(String(value)).toLocaleString('ar', {timeZone:'Asia/Jerusalem'}) : '—';
const statuses:Record<string,string> = {pending:'معلقة',assigned:'مرسلة','driver-accepted':'مقبولة','driver-arriving':'مقبولة',waiting:'انتظار',arrived:'وصل', 'in-progress':'بدأت',completed:'مكتملة',cancelled:'ملغاة'};
const sources:Record<string,string> = {MANUAL:'يدوي',LANDLINE_ICALL:'LANDLINE',LANDLINE:'LANDLINE',WHATSAPP:'WHATSAPP'};
const detailLabels:Record<string,string> = {assignedAt:'وقت التعيين',sentAt:'وقت الإرسال',acceptedAt:'وقت القبول',completedAt:'وقت الإنهاء',completionTime:'وقت الإنهاء',pickedUpAt:'وقت الركوب',droppedOffAt:'وقت النزول',cancelledAt:'وقت الإلغاء',notes:'الملاحظات',reassignmentLog:'سجل تغيير السائق',dispatchHistory:'سجل الحالات',callTimestamp:'وقت الاتصال',updatedAt:'آخر تحديث',totalFare:'الأجرة',neighborhood:'الحي',street:'الشارع',latitude:'خط العرض',longitude:'خط الطول'};

export function OfficeHistoryReport({data}:{data:OfficeData}) {
  const top=useRef<HTMLElement>(null); const results=useRef<HTMLDivElement>(null);
  const [kind,setKind]=useState<'driver'|'customer'>('driver');
  const [query,setQuery]=useState(''); const [open,setOpen]=useState(false);
  const [people,setPeople]=useState<Person[]>([]); const [selected,setSelected]=useState<Person|null>(null);
  const [searching,setSearching]=useState(true); const [searchPage,setSearchPage]=useState(1);
  const [sort,setSort]=useState('newest'); const [revision,setRevision]=useState(0);
  const defaultPeople=useRef<Partial<Record<'driver'|'customer',Person[]>>>({});
  const [places,setPlaces]=useState<CustomerPlace[]>([]);
  const [from,setFrom]=useState(''); const [to,setTo]=useState(''); const [page,setPage]=useState(1);
  const [history,setHistory]=useState<History|null>(null); const [error,setError]=useState(''); const [loading,setLoading]=useState(false);
  useEffect(()=>{
    let active=true; setSearching(true);
    const timer=setTimeout(()=>{void (kind==='driver'?api.reportDrivers(query,searchPage):api.customers(query,{page:searchPage,limit:50})).then(rows=>{if(active){setPeople(rows);if(!query&&searchPage===1)defaultPeople.current[kind]=rows;}}).catch(e=>{if(active){setPeople([]);setError(e.message);}}).finally(()=>{if(active)setSearching(false);});},query?180:0);
    return()=>{active=false;clearTimeout(timer);};
  },[kind,query,searchPage]);
  const openSearch=()=>{if(!open){setQuery('');setSearchPage(1);setPeople(defaultPeople.current[kind]??[]);setOpen(true);}};
  useEffect(()=>{
    setPlaces([]); if(kind!=='customer'||!selected)return; let active=true;
    void api.places('',selected.id).then(rows=>{if(active)setPlaces(rows);}).catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;};
  },[kind,selected]);
  useEffect(()=>{
    setHistory(null); if(!selected)return;
    if(from&&to&&from>to){setError('تاريخ البداية يجب أن يسبق تاريخ النهاية');setLoading(false);return;}
    let active=true;setLoading(true);setError('');
    void api.reportHistory({[kind==='driver'?'driverId':'customerId']:selected.id,from,to,page,sort}).then(result=>{if(active)setHistory(result);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[kind,selected,from,to,page,sort,revision]);
  return <section ref={top} aria-label="تقرير السائق والزبون" className="space-y-4 rounded-lg border bg-white p-4">
    <h1 className="text-xl font-bold">تقرير السائق والزبون</h1>
    <div className="flex gap-2">{(['driver','customer'] as const).map(k=><button type="button" key={k} aria-pressed={kind===k} className={`rounded border px-3 py-2 ${kind===k?'bg-slate-100 font-bold':''}`} onClick={()=>{setKind(k);setSelected(null);setQuery('');setSearchPage(1);setPeople(defaultPeople.current[k]??[]);setOpen(false);setHistory(null);setPage(1);setError('');}}>{k==='driver'?'تقرير السائق':'تقرير الزبون'}</button>)}</div>
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="relative"><label className="text-sm">{kind==='driver'?'اسم السائق أو الهاتف':'اسم الزبون أو الهاتف'}<input aria-label="بحث التقرير" role="combobox" aria-expanded={open} aria-controls="report-search-results" className="mt-1 h-10 w-full rounded border px-3 pl-8" value={query} placeholder={selected?.fullName??'اضغط للاختيار أو اكتب للتصفية'} onFocus={openSearch} onClick={openSearch} onChange={e=>{setQuery(e.target.value);setSearchPage(1);setOpen(true);setSearching(true);}} onKeyDown={e=>{if(e.key==='Escape')setOpen(false);}} /></label>
        <button type="button" aria-label="مسح بحث التقرير" className="absolute bottom-2 left-2 h-5 w-5 text-xs text-slate-500" onClick={()=>{setQuery('');setSearchPage(1);setOpen(false);setPeople(defaultPeople.current[kind]??[]);}}>X</button>
        {open&&<div id="report-search-results" role="listbox" aria-label="نتائج بحث التقرير" aria-busy={searching} className="absolute inset-x-0 top-full z-20 max-h-64 overflow-auto rounded border bg-white shadow">{searching&&<p role="status" className="p-2 text-sm">جارٍ البحث…</p>}{people.map(p=><button type="button" role="option" disabled={searching} aria-selected={selected?.id===p.id} key={p.id} className="block w-full p-2 text-right hover:bg-slate-100 disabled:opacity-50" onClick={()=>{setSelected(p);setOpen(false);setPage(1);}}>{p.fullName} {p.phone&&<bdi>{p.phone}</bdi>}</button>)}{!searching&&!people.length&&<p className="p-3 text-sm">لا توجد نتائج مطابقة للاسم أو الهاتف</p>}<div className="flex justify-between border-t p-2"><button type="button" disabled={searching||searchPage===1} onClick={()=>setSearchPage(p=>p-1)}>النتائج السابقة</button><button type="button" disabled={searching||people.length<50} onClick={()=>setSearchPage(p=>p+1)}>نتائج إضافية</button></div></div>}
      </div>
      <label className="text-sm">من تاريخ<input aria-label="من تاريخ التقرير" type="date" className="mt-1 h-10 w-full rounded border px-3" value={from} onChange={e=>{setFrom(e.target.value);setPage(1);}} /></label>
      <label className="text-sm">إلى تاريخ<input aria-label="إلى تاريخ التقرير" type="date" className="mt-1 h-10 w-full rounded border px-3" value={to} onChange={e=>{setTo(e.target.value);setPage(1);}} /></label>
    </div>
    <div className="flex gap-3"><button type="button" className="rounded bg-primary px-5 py-2 text-primary-foreground disabled:opacity-40" disabled={!selected||loading} onClick={()=>{setPage(1);setRevision(v=>v+1);}}>بحث</button><select aria-label="ترتيب نتائج التقرير" className="rounded border px-2" value={sort} onChange={e=>{setSort(e.target.value);setPage(1);}}><option value="newest">الأحدث أولًا</option><option value="oldest">الأقدم أولًا</option></select></div>
    {error&&<p role="alert" className="text-red-700">{error}</p>}
    {selected&&<div><h2 className="font-bold">{selected.fullName} <bdi>{selected.phone}</bdi></h2>{kind==='customer'&&<><p>العناوين المحفوظة:</p>{places.length?places.map(p=><p key={p.address.id}>{p.address.label}: {p.address.addressText||'—'} {p.address.notes}</p>):<p>لا توجد عناوين محفوظة</p>}{(selected as ApiCustomer).notes&&<p>{(selected as ApiCustomer).notes}</p>}</>}</div>}
    <div ref={results} aria-label="نتائج التقرير" className="scroll-mt-4" />
    {loading&&<p role="status">جارٍ تحميل التقرير…</p>}
    {history&&<><p className="font-bold" aria-label="إجمالي التقرير">{kind==='driver'?'إجمالي الطلبات التي عُيّن لها السائق':'إجمالي الطلبات والاتصالات'}: {history.total}</p>
      <div className="flex gap-3"><button type="button" onClick={()=>downloadReportPage(history.items)}>تصدير الصفحة CSV</button><button type="button" onClick={()=>{if(!printReportPage(history.items,history.total))setError('اسمح بفتح نافذة الطباعة');}}>طباعة الصفحة</button></div>
      <div className="max-h-[65vh] overflow-auto"><table className="w-full min-w-[900px] text-right text-sm"><thead><tr>{['العدد','التاريخ والوقت','الزبون','الهاتف','العنوان','السائق','الحالة','المصدر','التفاصيل'].map(h=><th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{history.items.map((r,i)=><tr key={String(r.id??i)} className="border-t">
        <td className="p-2">{display(r.orderNumber)}</td><td className="p-2">{time(r.createdAt)}</td><td className="p-2">{display(r.passengerName)}</td><td className="p-2"><bdi>{display(r.passengerPhone)}</bdi></td><td className="p-2">{display(r.addressText??(r.pickup as {name?:string}|undefined)?.name)}</td><td className="p-2">{data.drivers.find(d=>d.id===r.driverId)?.fullName??'—'}</td><td className="p-2">{r.recordType==='CALL'?'اتصال':statuses[String(r.status)]??display(r.dispatchStatus??r.status)}</td><td className="p-2">{sources[String(r.source)]??display(r.source)}</td>
        <td className="p-2"><details><summary className="cursor-pointer">فتح التفاصيل</summary><dl className="min-w-72 space-y-2 p-2">{Object.entries(r).map(([key,value])=><div key={key}><dt className="font-semibold">{detailLabels[key]??key}</dt><dd className="whitespace-pre-wrap break-words">{/(At|Time|Timestamp)$/.test(key)&&typeof value==='string'&&!Number.isNaN(Date.parse(value))?time(value):display(value)}</dd></div>)}</dl></details></td>
      </tr>)}</tbody></table></div>
      {!history.items.length&&<p>لا توجد سجلات في الفترة المحددة.</p>}
      <div className="flex items-center gap-3"><button type="button" disabled={page<=1||loading} className="rounded border px-3 py-1 disabled:opacity-40" onClick={()=>setPage(p=>p-1)}>السابق</button><span>صفحة {history.page} من {Math.max(1,Math.ceil(history.total/history.pageSize))}</span><button type="button" disabled={page*history.pageSize>=history.total||loading} className="rounded border px-3 py-1 disabled:opacity-40" onClick={()=>setPage(p=>p+1)}>التالي</button></div>
    </>}
    <div className="fixed bottom-4 left-4 z-30 flex gap-1"><button type="button" aria-label="النزول إلى نتائج التقرير" className="h-7 w-7 rounded border bg-white shadow" onClick={()=>results.current?.scrollIntoView({behavior:'smooth',block:'start'})}>↓</button><button type="button" aria-label="العودة لأعلى التقرير" className="h-7 w-7 rounded border bg-white shadow" onClick={()=>top.current?.scrollIntoView({behavior:'smooth',block:'start'})}>↑</button></div>
  </section>;
}
