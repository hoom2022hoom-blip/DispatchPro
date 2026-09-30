"use client";
import {useEffect,useRef,useState} from 'react';
type Point={latitude:number;longitude:number};
type View={map:{remove():void;resize():void};update(points:Record<string,Point|undefined>):void;fit():void};
export function DriverJourneyMap({driver,pickup,destination}:{driver?:Point;pickup?:Point;destination?:Point}){
  const container=useRef<HTMLDivElement>(null),view=useRef<View>();
  const points=useRef({driver,pickup,destination});points.current={driver,pickup,destination};
  const [error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    if(!container.current)return;
    let disposed=false;const url='/driver-mobile/maps.js';
    void import(/* webpackIgnore: true */ url).then(module=>module.createJourneyMap(container.current,points.current)).then((next:View)=>{if(disposed){next.map.remove();return;}view.current=next;next.update(points.current);}).catch(()=>{if(!disposed)setError('تعذر تحميل الخريطة؛ يمكنك استخدام زر فتح الملاحة.');});
    return()=>{disposed=true;view.current?.map.remove();view.current=undefined;};
  },[retry]);
  useEffect(()=>{view.current?.update(points.current);},[driver?.latitude,driver?.longitude,pickup?.latitude,pickup?.longitude,destination?.latitude,destination?.longitude]);
  return <section aria-label="خريطة الرحلة" className="space-y-2"><div ref={container} className="h-72 overflow-hidden rounded-2xl bg-slate-100"/>{error&&<p role="status">{error} <button onClick={()=>{setError('');setRetry(n=>n+1);}}>إعادة تحميل الخريطة</button></p>}<button className="min-h-12 rounded-xl border px-4" onClick={()=>view.current?.fit()}>عرض نقاط الرحلة</button><p className="text-sm text-slate-600">🚕 السائق · ● نقطة الالتقاء · ⚑ الوجهة</p>{!driver&&<p className="text-sm">بانتظار تحديث موقع السائق</p>}</section>;
}
