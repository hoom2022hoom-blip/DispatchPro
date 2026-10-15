"use client";
import {useEffect,useState} from 'react';
import {apiReceptionBackend as api} from '@/lib/reception-api';
import {Button} from './ui/button';
import {QrCode,RefreshCw} from 'lucide-react';
type Device={id:string;name:string;kind:string;approved:boolean;revoked:boolean;lastSeen?:string};
export function OfficeCallsSettings(){
 const [devices,setDevices]=useState<Device[]>([]),[image,setImage]=useState(''),[qr,setQr]=useState(''),[expires,setExpires]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const refresh=async()=>{try{setDevices(await api.officeCalls<Device[]>('devices'));setError('');}catch(e){setError((e as Error).message);}};
 useEffect(()=>{let stopped=false;let timer:ReturnType<typeof setTimeout>;const poll=async()=>{if(document.visibilityState==='visible')await refresh();if(!stopped)timer=setTimeout(poll,5000);};void poll();return()=>{stopped=true;clearTimeout(timer);};},[]);
 async function pair(kind:string){setBusy(true);setError('');try{const result=await api.officeCalls<{qr:string;expiresAt:string}>('pairings?kind='+kind,'POST');const {toDataURL}=await import('qrcode');setImage(await toDataURL(result.qr,{width:320,margin:4,errorCorrectionLevel:'M'}));setQr(result.qr);setExpires(result.expiresAt);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function change(device:Device,revoke=false){setBusy(true);try{await api.officeCalls(`devices/${device.id}${revoke?'':'/approve'}`,revoke?'DELETE':'POST');await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const expired=expires && Date.parse(expires)<Date.now();
 return <section dir="rtl" className="m-4 space-y-4 rounded-xl border bg-card p-5 text-card-foreground" aria-labelledby="officecalls-title">
  <h2 id="officecalls-title" className="flex items-center gap-2 text-xl font-bold"><QrCode aria-hidden="true" size={22}/>مكالمات المكتب — OfficeCalls 3.0</h2>
  <p>ربط هاتف واتساب وWindows Agent بهذا المكتب. راجع اسم الجهاز قبل تأكيده. حفظ الحدث في الخادم وتسليمه لكل برنامج لهما حالتان منفصلتان.</p>
  <div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={()=>void pair('ANDROID')}>ربط هاتف QR</Button><Button variant="outline" disabled={busy} onClick={()=>void pair('WINDOWS')}>ربط Windows Agent</Button><Button variant="outline" disabled={busy} onClick={()=>void refresh()}><RefreshCw className="ml-2" size={16}/>تحديث الحالة</Button></div>
  {image&&!expired&&<div className="space-y-2"><img src={image} width={320} height={320} className="max-w-full rounded-lg bg-white" alt="رمز مؤقت لربط الجهاز بهذا المكتب"/><p>ينتهي {new Date(expires).toLocaleTimeString('ar-PS')}، ويستخدم مرة واحدة.</p><details><summary className="cursor-pointer">نص الربط لبرنامج Windows</summary><textarea readOnly aria-label="نص رمز الربط" dir="ltr" value={qr} className="mt-2 min-h-24 w-full rounded border bg-background p-3 text-sm"/></details></div>}
  {expired&&<p role="status">انتهى رمز الربط؛ أنشئ رمزاً جديداً.</p>}
  {error&&<p role="alert" className="text-destructive">{error}</p>}
  <div className="space-y-3">{devices.map(device=><article key={device.id} className="flex flex-wrap items-center justify-between gap-3 rounded border p-3"><div><strong>{device.name}</strong><p className="text-sm">{device.kind==='ANDROID'?'هاتف':'Windows Agent'} · {device.revoked?'ملغى':device.approved?'مصرح به':'بانتظار تأكيدك'} · آخر ظهور: {device.lastSeen?new Date(device.lastSeen).toLocaleString('ar-PS'):'لم يتصل بعد'}</p></div><div className="flex gap-2">{!device.revoked&&!device.approved&&<Button disabled={busy} onClick={()=>void change(device)}>تأكيد هذا الجهاز</Button>}{!device.revoked&&<Button disabled={busy} variant="outline" onClick={()=>void change(device,true)}>إلغاء صلاحية الجهاز</Button>}</div></article>)}</div>
  <p className="text-sm">تسليم UDP أو ACK من Receiver يؤكد مرحلة النقل. تأكيد ظهور الرقم داخل GRIDCMS يحتاج الاختبار الميداني.</p>
 </section>;
}
