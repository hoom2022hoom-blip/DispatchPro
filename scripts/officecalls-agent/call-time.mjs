export const CALL_TIME_ZONE = 'Asia/Hebron';
const formatter = new Intl.DateTimeFormat('en-GB', {
 timeZone: CALL_TIME_ZONE, year:'numeric',month:'2-digit',day:'2-digit',
 hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
});
export function formatCallTime(timestamp) {
 if(!Number.isSafeInteger(timestamp)||timestamp<=0)return '—';
 const p=Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map(p=>[p.type,p.value]));
 return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}
