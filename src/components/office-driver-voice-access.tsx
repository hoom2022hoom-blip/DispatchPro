"use client";
import {useEffect,useState} from 'react';
import {apiReceptionBackend as api} from '@/lib/reception-api';
import {defaultVoiceAccess,type VoiceAccess} from '@/lib/voice-client';
export function OfficeDriverVoiceAccess({driverId}:{driverId:string}){
 const [access,setAccess]=useState<VoiceAccess|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let live=true;setAccess(null);void api.driverMap().then(data=>{if(live)setAccess(data.drivers.find(d=>d.id===driverId)?.voice??defaultVoiceAccess);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[driverId]);
 async function save(next:VoiceAccess){if(busy)return;setBusy(true);setError('');try{setAccess(await api.voice<VoiceAccess>('voice/drivers/'+driverId,'PUT',next));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="space-y-3 rounded-xl border p-3"><h3 className="font-bold">صلاحيات المخشيرة</h3>{access?<div className="flex flex-wrap gap-4">{([['voiceEnabled','تفعيل الصوت'],['canListen','الاستماع'],['canTalkPublic','التحدث العام'],['canTalkPrivate','التحدث الخاص'],['isVoiceBlocked','حظر الكلام']] as const).map(([key,label])=><label key={key} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" disabled={busy} checked={access[key]} onChange={e=>void save({...access,[key]:e.target.checked})}/>{label}</label>)}</div>:<p role="status">جارٍ تحميل صلاحيات الصوت…</p>}{error&&<p role="alert" className="text-red-700">{error}</p>}</section>;
}
