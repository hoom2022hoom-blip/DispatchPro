"use client";
import { useEffect, useRef, useState } from 'react';
export type LocationPoint = { latitude: number; longitude: number };
export function LocationPointPicker({point,onChange}:{point?:LocationPoint;onChange:(point:LocationPoint)=>void}) {
 const element=useRef<HTMLDivElement>(null),change=useRef(onChange);change.current=onChange;
 const [error,setError]=useState('');
 useEffect(()=>{let disposed=false;let map:{remove():void}|undefined;const url='/customer-mobile/maps.js';void import(/* webpackIgnore: true */ url).then(module=>module.createMap(element.current,point,(next:LocationPoint)=>{if(!disposed)change.current(next);})).then(view=>{if(disposed)view.map.remove();else map=view.map;}).catch(()=>{if(!disposed)setError('تعذر تحميل الخريطة؛ يمكنك كتابة العنوان أو إعادة فتح الاختيار.');});return()=>{disposed=true;map?.remove();};},[]);
 return <div className="space-y-2"><p className="text-sm text-slate-600">اضغط على النقطة أو حرّك العلامة. لن تُحفظ حتى تؤكد النموذج.</p><div ref={element} className="h-64 rounded-xl bg-slate-100"/>{error&&<p role="alert">{error}</p>}<p className="text-sm" dir="ltr">{point?`${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}`:'لم تحدد نقطة بعد'}</p></div>;
}
