"use client";
import {useEffect,useId,useState,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import {mapboxEnabled,mapBlockedReason,mapKinds,mapLabels,type MapKind} from '@/lib/map-provider';
export function MapLayerSwitcher({kind,onChange}:{kind:MapKind;onChange:(kind:MapKind)=>void}){
 const id=useId(),mapbox=mapboxEnabled(),kinds=mapbox?(['street','satellite'] as MapKind[]):mapKinds;
 return <div aria-label="نوع الخريطة" className="space-y-2">{kinds.map(value=>{
  const reason=mapBlockedReason(value),label=mapbox?(value==='street'?'شوارع Mapbox':'أقمار صناعية مع أسماء'):mapLabels[value];
  return <div key={value}><button type="button" disabled={!!reason} aria-disabled={!!reason} aria-pressed={kind===value||(value==='street'&&['clear','detailed'].includes(kind))} aria-describedby={reason?id+value:undefined} title={reason??undefined} className={`block min-h-11 w-full rounded-lg px-3 text-right text-sm focus-visible:ring-2 focus-visible:ring-blue-600 ${kind===value?'bg-blue-700 text-white':reason?'cursor-not-allowed bg-slate-50 text-slate-600':'bg-slate-100 hover:bg-slate-200'}`} onClick={()=>onChange(value)}>{label}</button>{reason&&<p id={id+value} className="px-3 py-2 text-xs leading-5 text-slate-600">{reason}</p>}</div>;
 })}</div>;
}
export function MapProviderLogo({kind,target}:{kind:MapKind;target?:RefObject<HTMLDivElement|null>}){
 const [host,setHost]=useState<HTMLDivElement|null>(null);useEffect(()=>{setHost(target?.current??null);},[target]);
 const mapbox=mapboxEnabled()&&kind!=='sentinel';
 if(!mapbox&&kind!=='satellite'&&kind!=='hybrid')return null;
 const logo=<a href={mapbox?'https://www.mapbox.com/':'https://www.maptiler.com/'} target="_blank" rel="noopener noreferrer" aria-label={mapbox?'Mapbox':'MapTiler'} className={target?'flex min-h-8 items-center px-1':'absolute bottom-2 left-3 z-10 rounded bg-white/95 p-1'}><img src={mapbox?'/mapbox-logo.svg':'https://api.maptiler.com/resources/logo.svg'} alt={mapbox?'Mapbox':'MapTiler logo'} width={mapbox?88:100} height={mapbox?23:30}/></a>;
 return target?(host?createPortal(logo,host):null):logo;
}
