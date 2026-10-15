import type { EarningsSummary, DriverEarnings } from '@/lib/driver-api';

const amount = (value:number,currency:string) => `${new Intl.NumberFormat('ar', {maximumFractionDigits:2}).format(value)} ${currency==='ILS'?'₪':currency}`;
export function EarningsCards({summary}:{summary?:EarningsSummary}) {
  const period=summary?.date.includes('→');
  return <section aria-label={period?'ملخص الفترة':'ملخص اليوم'} className="space-y-2">
    <div className="grid grid-cols-2 gap-3">
      <article className="rounded-2xl border bg-white p-4"><h2 className="text-sm text-slate-600">{period?'رحلات الفترة':'رحلات اليوم'}</h2><p className="mt-1 text-2xl font-bold tabular-nums">{summary?summary.completedTrips:'—'}</p></article>
      <article className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><h2 className="text-sm text-emerald-800">{period?'أرباح الفترة':'أرباح اليوم'}</h2><div className="mt-1 text-2xl font-bold tabular-nums text-emerald-950">{!summary?'—':summary.totals.length?summary.totals.map(t=><p key={t.currency}><bdi>{amount(t.amount,t.currency)}</bdi></p>):summary.completedTrips?'السعر غير متوفر':'لا توجد أرباح'}</div></article>
    </div>
    {summary&&<p className="text-xs text-slate-600">{summary.date} · {summary.timeZone} · الرحلات المكتملة فقط</p>}
    {!!summary?.missingFareTrips&&<p className="text-sm text-amber-800">{summary.missingFareTrips} رحلة مكتملة دون سعر نهائي؛ لم تدخل في مجموع الأرباح.</p>}
  </section>;
}
export function EarningsPage({data,failed,retry,page,setPage,connected}:{data:DriverEarnings|null;failed:boolean;retry:()=>void;page:number;setPage:(page:number)=>void;connected:boolean}) {
  return <section className="space-y-4"><h2 className="text-xl font-bold">الأرباح</h2><EarningsCards summary={data?.summary}/><p className="text-sm text-slate-600">مجموع أسعار الرحلات النهائية المسجلة. كل عملة تُعرض بشكل مستقل.</p>
    {!data?(failed?<div role="alert">تعذر تحميل الأرباح.<button className="min-h-12 rounded-xl border bg-white px-4" onClick={retry}>إعادة المحاولة</button></div>:<p role="status">جارٍ تحميل الأرباح…</p>):<><h3 className="font-bold">الرحلات المكتملة ({data.total})</h3>{data.items.map(ride=><article key={ride.id} className="space-y-2 rounded-xl border bg-white p-4"><p>{ride.pickup} ← {ride.destination||'الوجهة غير محددة'}</p><p className="font-bold">{ride.finalFare==null?'السعر النهائي غير متوفر':amount(ride.finalFare,ride.currency??'ILS')}</p><p className="text-sm text-slate-600">{{OFFICE_MANUAL:'المكتب',OFFICE_OVERRIDE:'تعديل المكتب',DRIVER_MANUAL:'السائق',GPS_METER:'عداد GPS'}[ride.fareSource??ride.fareMode??'']??'مصدر السعر غير مسجل'}</p><time className="text-sm">{ride.completedAt?new Date(ride.completedAt).toLocaleString('ar',{timeZone:data.summary.timeZone}):'وقت الإكمال غير مسجل'}</time></article>)}{!data.total&&<p>لا توجد رحلات مكتملة بعد.</p>}<div className="flex items-center gap-3"><button className="min-h-12 rounded-xl border bg-white px-4" disabled={page===1||!connected} onClick={()=>setPage(page-1)}>السابق</button><span>صفحة {page}</span><button className="min-h-12 rounded-xl border bg-white px-4" disabled={page*20>=data.total||!connected} onClick={()=>setPage(page+1)}>التالي</button></div></>}
  </section>;
}
