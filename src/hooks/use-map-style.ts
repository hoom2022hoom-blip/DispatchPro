"use client";
import {useEffect,useMemo,useState} from 'react';
import type {StyleSpecification} from 'maplibre-gl';
import {clientMapStyle,composeMapStyle,emptyMapStyle,mapProvider,mapBlockedReason,type MapKind,type MapAppearance} from '@/lib/map-provider';
import {mapboxEnabled,prepareMapboxStyle} from '@/lib/mapbox-style';
const cache=new Map<string,StyleSpecification>(),pending=new Map<string,Promise<StyleSpecification>>();
function resolveStyle(key:string,isMapbox:boolean){
 const ready=cache.get(key);if(ready)return Promise.resolve(ready);
 const running=pending.get(key);if(running)return running;
 const request=fetch(key,{signal:AbortSignal.timeout(12000)}).then(async response=>{
  if(!response.ok){
   if(isMapbox&&[401,402,403,429].includes(response.status))throw Error('توقف Mapbox: تحقق من صلاحية المفتاح وحدود الحساب؛ لم تبدأ إعادة محاولة تلقائية');
   throw Error('تعذر تحميل مصدر الخريطة؛ تحقق من الاتصال ثم أعد المحاولة');
  }
  const value:StyleSpecification=await response.json();
  if(value.version!==8||!value.sources||!Array.isArray(value.layers))throw Error('تعذر قراءة إعدادات مصدر الخريطة');
  const style=isMapbox?prepareMapboxStyle(value):value;cache.set(key,style);
  if(cache.size>8)cache.delete(cache.keys().next().value!);return style;
 }).finally(()=>pending.delete(key));pending.set(key,request);return request;
}
export function useMapStyle(kind:MapKind,appearance:MapAppearance={}){
 const provider=mapProvider(kind),key=typeof provider==='string'?provider:null,isMapbox=mapboxEnabled()&&kind!=='sentinel';
 const [base,setBase]=useState<StyleSpecification>(typeof provider==='string'?cache.get(provider)??emptyMapStyle:provider??emptyMapStyle),[loading,setLoading]=useState(!!key&&!cache.has(key)),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  let active=true;setError('');
  if(!key){setBase(typeof provider==='string'?emptyMapStyle:provider??emptyMapStyle);setLoading(false);setError(mapBlockedReason(kind)??'');return;}
  setLoading(!cache.has(key));
  void resolveStyle(key,isMapbox).then(value=>{if(active)setBase(value);}).catch((e:Error)=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[key,kind,isMapbox,attempt]);
 const rawStyle=useMemo(()=>composeMapStyle(base,kind,appearance),[base,kind,appearance.labels,appearance.night]);
 return {style:clientMapStyle(rawStyle),rawStyle,loading,error,retry:()=>setAttempt(n=>n+1)};
}
