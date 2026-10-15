export const reportStatusLabels:Record<string,string>={pending:'بانتظار سائق',waiting:'انتظار',assigned:'تم الإرسال','driver-accepted':'مقبول','driver-arriving':'في الطريق',arrived:'وصل','in-progress':'الرحلة جارية',completed:'مكتمل',cancelled:'ملغي',active:'نشط'};
export const reportSourceLabels:Record<string,string>={DRIVER_STREET:'راكب أو طلب من الشارع',MANUAL:'المكتب',CUSTOMER_APP:'تطبيق الزبون',WHATSAPP:'واتساب',LANDLINE_ICALL:'الهاتف الأرضي',LANDLINE:'الهاتف الأرضي'};
export const reportFareLabels:Record<string,string>={OFFICE_MANUAL:'المكتب',OFFICE_OVERRIDE:'المكتب',DRIVER_MANUAL:'السائق',GPS_METER:'GPS'};
export function reportDate(value:unknown):string{if(!value)return '';const date=new Date(String(value));return Number.isNaN(date.getTime())?'':new Intl.DateTimeFormat('ar-PS',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',year:'numeric',hour:'numeric',minute:'2-digit'}).format(date);}
const label=(labels:Record<string,string>,value:unknown)=>labels[String(value)]??'غير محدد';
export const orderColumns=['رقم الطلب','التاريخ والوقت','الزبون','الهاتف','العنوان','الوجهة','السائق','الحالة','السعر','مصدر السعر'];
export function orderCells(row:Record<string,unknown>):string[]{const fare=row.finalFare??(Number(row.totalFare)>0?row.totalFare:null);return [row.orderNumber??row.id,reportDate(row.createdAt),row.passengerName,row.passengerPhone,row.addressText??(row.pickup as {name?:string}|undefined)?.name,(row.dropoff as {name?:string}|undefined)?.name||row.destination,row.driverName,label(reportStatusLabels,row.status),fare!=null?`${fare} ${!row.currency||row.currency==='ILS'?'شيكل':row.currency}`:'لم يحدد بعد',fare!=null?label(reportFareLabels,row.fareSource??'OFFICE_MANUAL'):'—'].map(v=>v==null?'':String(v));}
export const reportColumns=[...orderColumns,'مصدر الطلب','وقت القبول','في الطريق','وقت الوصول','بدء الرحلة','إنهاء الرحلة','ملاحظات','المسافة (كم)','المدة (ثانية)','طريقة التسعير','سعر العداد'];
export function reportCells(row:Record<string,unknown>):string[]{return [...orderCells(row),label(reportSourceLabels,row.source),reportDate(row.acceptedAt),reportDate(row.arrivingAt),reportDate(row.arrivedAt),reportDate(row.startedAt),reportDate(row.completedAt),row.notes,row.distanceKm,row.durationSeconds,label(reportFareLabels,row.fareMode),row.meterCalculatedFare].map(v=>v==null?'':String(v));}
export function reportCsv(rows:Record<string,unknown>[]):string{
 const cell=(v:string)=>'"'+(/^\s*[=+\-@\t\r]/.test(v)?"'"+v:v).replace(/"/g,'""')+'"';
 return '\uFEFF'+[reportColumns,...rows.map(reportCells)].map(r=>r.map(cell).join(',')).join('\r\n');
}
export function downloadReportPage(rows:Record<string,unknown>[]){const url=URL.createObjectURL(new Blob([reportCsv(rows)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='DispatchPro-report-page.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function printReportPage(rows:Record<string,unknown>[],total:number){
 const escape=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const popup=window.open('','_blank','width=1100,height=800');if(!popup)return false;
 popup.document.write(`<html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>تقرير DispatchPro</title><style>body{font:14px Arial}table{border-collapse:collapse;width:100%}td,th{border:1px solid #aaa;padding:8px}</style></head><body><h1>تقرير DispatchPro</h1><p>الصفحة الحالية: ${rows.length} · إجمالي النتائج: ${total}</p><table><thead><tr>${reportColumns.map(c=>'<th>'+escape(c)+'</th>').join('')}</tr></thead><tbody>${rows.map(r=>'<tr>'+reportCells(r).map(c=>'<td>'+escape(c)+'</td>').join('')+'</tr>').join('')}</tbody></table></body></html>`);
 popup.document.close();popup.focus();popup.print();return true;
}
