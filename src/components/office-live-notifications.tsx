"use client";
import { useEffect, useState } from 'react';
import { ReceptionApiError, apiReceptionBackend as api } from '@/lib/reception-api';
import { noticeLabel, type Notice } from '@/lib/driver-api';
import { enableBrowserNotifications, sendBrowserNotification } from '@/lib/notifications';
import { Bell } from 'lucide-react';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import {driverTones,previewDriverTone} from '@/lib/driver-tones.js';
const important=(n:Notice)=>/\.(created|Assigned|Accepted|Rejected|Cancelled|Removed|Offline)$/.test(n.action);

export function OfficeLiveNotifications({compact=false}:{compact?:boolean}) {
  const [notices,setNotices]=useState<Notice[]>([]),[error,setError]=useState(''),[permission,setPermission]=useState('');
  useEffect(()=>{
    const controller=new AbortController();let cursor='';let timer:ReturnType<typeof setTimeout>;let seen:Set<string>|null=null;let retry=3000;
    async function watch(){
      try{
        const update=await api.notificationUpdates(cursor,controller.signal);if(controller.signal.aborted)return;
        if(seen){const fresh=update.data.filter(n=>!seen!.has(n.id)&&important(n));for(const n of fresh.slice(0,3))void sendBrowserNotification(n.action.endsWith('.created')?'طلب جديد':noticeLabel(n.action),'تكسي نابلس والمهندس');if(fresh.some(n=>/\.(created|Assigned)$/.test(n.action)))try{previewDriverTone(driverTones().orderTone);}catch{}if(update.cursor!==cursor)window.dispatchEvent(new Event('dispatchpro-office-update'));}
        seen=new Set(update.data.map(n=>n.id));setNotices(update.data.filter(important));setError('');cursor=update.cursor;retry=3000;
        timer=setTimeout(watch,0);
      }catch(e){if(controller.signal.aborted)return;setError((e as Error).message);if(e instanceof ReceptionApiError&&[401,403].includes(e.status))return;timer=setTimeout(watch,retry);retry=Math.min(60000,retry*2);}
    }
    void watch();return()=>{controller.abort();clearTimeout(timer);};
  },[]);
  const panel=<div className="max-h-48 space-y-2 overflow-auto py-2 text-sm"><button className="rounded border p-2" onClick={()=>void enableBrowserNotifications().then(result=>setPermission(result==='granted'?'تم تفعيل إشعارات المتصفح':'الإشعارات الداخلية متاحة؛ يمكن السماح بإشعارات المتصفح من إعداداته'))}>تفعيل إشعارات المتصفح</button>{permission&&<p role="status">{permission}</p>}{error&&<p role="alert">{error}</p>}{notices.map(n=><p key={n.id}>{n.action.endsWith('.created')?'طلب جديد':noticeLabel(n.action)} · {new Date(n.createdAt).toLocaleTimeString('ar')}</p>)}{!notices.length&&!error&&<p>لا توجد تنبيهات جديدة.</p>}</div>;
  if(compact)return <Popover><PopoverTrigger asChild><Button variant="outline" className="gap-1.5 px-2" aria-label={`تنبيهات الطلبات والسائقين (${notices.length})${error?' · تعذر التحديث':''}`} title={error?'تعذر تحديث التنبيهات':'تنبيهات الطلبات والسائقين'}><Bell size={15} aria-hidden="true"/><span className="tabular-nums">{notices.length}</span>{error&&<span aria-hidden="true" className="text-red-700">!</span>}</Button></PopoverTrigger><PopoverContent dir="rtl" align="start" className="w-80 max-w-[calc(100vw-1rem)]"><h2 className="text-sm font-bold">تنبيهات الطلبات والسائقين</h2>{panel}</PopoverContent></Popover>;
  return <details className="shrink-0 border-b bg-white px-4 py-2 text-sm"><summary className="cursor-pointer">تنبيهات الطلبات والسائقين {error?'· تعذر التحديث':`(${notices.length})`}</summary>{panel}</details>;
}
