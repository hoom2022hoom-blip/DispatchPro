"use client";
import { useEffect, useState } from 'react';
import { apiReceptionBackend as api } from '@/lib/reception-api';
import { noticeLabel, type Notice } from '@/lib/driver-api';
import { enableBrowserNotifications, sendBrowserNotification } from '@/lib/notifications';

export function OfficeLiveNotifications() {
  const [notices,setNotices]=useState<Notice[]>([]),[error,setError]=useState(''),[permission,setPermission]=useState('');
  useEffect(()=>{
    const controller=new AbortController();let cursor='';let timer:ReturnType<typeof setTimeout>;let seen:Set<string>|null=null;let retry=3000;
    async function watch(){
      try{
        const update=await api.notificationUpdates(cursor,controller.signal);if(controller.signal.aborted)return;
        if(seen)for(const n of update.data.filter(n=>!seen!.has(n.id)).slice(0,3))void sendBrowserNotification(noticeLabel(n.action),`طلب / سائق ${n.entityId.slice(0,8)}`);
        seen=new Set(update.data.map(n=>n.id));setNotices(update.data);setError('');cursor=update.cursor;retry=3000;
        timer=setTimeout(watch,0);
      }catch(e){if(controller.signal.aborted)return;setError((e as Error).message);timer=setTimeout(watch,retry);retry=Math.min(60000,retry*2);}
    }
    void watch();return()=>{controller.abort();clearTimeout(timer);};
  },[]);
  return <details className="shrink-0 border-b bg-white px-4 py-2 text-sm"><summary className="cursor-pointer">تنبيهات الطلبات والسائقين {error?'· تعذر التحديث':`(${notices.length})`}</summary><div className="max-h-48 space-y-2 overflow-auto py-2"><button className="rounded border p-2" onClick={()=>void enableBrowserNotifications().then(result=>setPermission(result==='granted'?'تم تفعيل إشعارات المتصفح':'الإشعارات الداخلية متاحة؛ يمكن السماح بإشعارات المتصفح من إعداداته'))}>تفعيل إشعارات المتصفح</button>{permission&&<p role="status">{permission}</p>}{error&&<p role="alert">{error}</p>}{notices.map(n=><p key={n.id}>{noticeLabel(n.action)} · <bdi>{n.entityId.slice(0,8)}</bdi> · {new Date(n.createdAt).toLocaleTimeString('ar')}</p>)}{!notices.length&&!error&&<p>لا توجد تنبيهات جديدة.</p>}</div></details>;
}
