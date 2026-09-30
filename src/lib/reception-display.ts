export function receptionTime(value: Date | string | number) {
 const date = new Date(value);
 return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Jerusalem',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date) : '—';
}
export function newestRequestFirst(a: {createdAt: Date|string|number;id:string}, b: {createdAt: Date|string|number;id:string}) {
 return (new Date(b.createdAt).getTime()||0)-(new Date(a.createdAt).getTime()||0)||b.id.localeCompare(a.id);
}

export function oldestRequestFirst(a: {createdAt: Date|string|number;id:string}, b: {createdAt: Date|string|number;id:string}) { return -newestRequestFirst(a,b); }
