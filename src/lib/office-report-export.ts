export const reportColumns=['العدد','التاريخ والوقت','الزبون','الهاتف','العنوان','الحالة','المصدر'];
export function reportCells(row:Record<string,unknown>):string[]{return [row.orderNumber,row.createdAt,row.passengerName,row.passengerPhone,row.addressText??(row.pickup as {name?:string}|undefined)?.name,row.status,row.source].map(v=>v==null?'':String(v));}
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
