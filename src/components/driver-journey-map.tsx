"use client";
import {MapResourceNotice} from './map-resource-notice';
import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {LocateFixed,Layers,Plus,Minus,CarTaxiFront,MapPin} from 'lucide-react';
import Map,{Marker,type MapRef} from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import {useMapStyle} from '@/hooks/use-map-style';
import {type MapKind} from '@/lib/map-provider';
import {MapAttributionPortal} from './map-attribution-portal';
import {MapLayerSwitcher,MapProviderLogo} from './map-layer-switcher';
import {mapAnimationDuration} from '@/lib/map-camera';
type Point={latitude:number;longitude:number};
const valid=(point:Point|undefined)=>point&&Number.isFinite(point.latitude)&&Number.isFinite(point.longitude)&&Math.abs(point.latitude)<=90&&Math.abs(point.longitude)<=180&&(point.latitude!==0||point.longitude!==0)?point:undefined;
export function DriverJourneyMap({driver,pickup,destination,compact=false,active=false,summary}:{summary?:ReactNode;driver?:Point;pickup?:Point;destination?:Point;compact?:boolean;active?:boolean}){
 const map=useRef<MapRef>(null),brand=useRef<HTMLDivElement>(null),credits=useRef<HTMLDivElement>(null);
 const [kind,setKind]=useState<MapKind>('street'),[layers,setLayers]=useState(false),[loaded,setLoaded]=useState(false);
 const {style,error,loading,retry}=useMapStyle(kind);
 const points=useMemo(()=>({driver:valid(driver),pickup:valid(pickup),destination:valid(destination)}),[driver?.latitude,driver?.longitude,pickup?.latitude,pickup?.longitude,destination?.latitude,destination?.longitude]);
 const latest=useRef(points);latest.current=points;
 useEffect(()=>{window.dispatchEvent(new Event('dispatchpro-driver-map-layout'));return()=>{queueMicrotask(()=>window.dispatchEvent(new Event('dispatchpro-driver-map-layout')));};},[]);
 const fit=()=>{const values=Object.values(latest.current).filter((p):p is Point=>!!p);if(!values.length)return;map.current?.fitBounds([[Math.min(...values.map(p=>p.longitude)),Math.min(...values.map(p=>p.latitude))],[Math.max(...values.map(p=>p.longitude)),Math.max(...values.map(p=>p.latitude))]],{padding:64,maxZoom:16,duration:mapAnimationDuration(450)});};
 useEffect(()=>{map.current?.resize();},[compact,active]);
 // Fit only when the trip endpoints change; a GPS fix must not reset manual navigation.
 useEffect(()=>{if(loaded)fit();},[loaded,pickup?.latitude,pickup?.longitude,destination?.latitude,destination?.longitude]);
 return <section aria-label="خريطة الرحلة" className="driver-journey-map relative">
  {summary&&<details className="driver-map-summary"><summary>تفاصيل الرحلة الحالية</summary><div className="p-3">{summary}</div></details>}
  <div className={compact?'driver-map-canvas relative h-[64dvh] min-h-80 bg-slate-100':'driver-map-canvas relative h-96 bg-slate-100'}>
   <Map ref={map} RTLTextPlugin="/mapbox-gl-rtl-text-0.2.3.min.js" mapStyle={style} initialViewState={{longitude:points.driver?.longitude??points.pickup?.longitude??35.2544,latitude:points.driver?.latitude??points.pickup?.latitude??32.2211,zoom:14}} minZoom={5} maxZoom={20} attributionControl={false} onLoad={()=>setLoaded(true)}>
    {Object.entries(points).map(([key,p])=>p&&<Marker key={key} longitude={p.longitude} latitude={p.latitude} anchor="center"><span title={key==='driver'?'موقعك الحالي':key==='pickup'?'نقطة الالتقاء':'الوجهة'} className={'flex h-11 w-11 items-center justify-center rounded-full border-2 border-slate-900 shadow-lg '+(key==='driver'?'bg-yellow-400 text-black':key==='pickup'?'bg-blue-700 text-white':'bg-emerald-700 text-white')}>{key==='driver'?<CarTaxiFront size={25}/>:<MapPin size={24}/>}</span></Marker>)}
    <MapAttributionPortal target={credits}/>
   </Map>
   <div className="absolute right-3 top-3 z-10 flex gap-2"><button type="button" aria-label="عرض نقاط الرحلة" className="journey-tool" onClick={fit}><LocateFixed size={22}/></button><button type="button" aria-label="تكبير خريطة الرحلة" className="journey-tool" onClick={()=>map.current?.zoomIn()}><Plus size={22}/></button><button type="button" aria-label="تصغير خريطة الرحلة" className="journey-tool" onClick={()=>map.current?.zoomOut()}><Minus size={22}/></button><button type="button" aria-label="طبقات خريطة الرحلة" className="journey-tool" aria-expanded={layers} onClick={()=>setLayers(v=>!v)}><Layers size={22}/></button></div>
   {layers&&<div className="absolute right-3 top-16 z-20 max-w-[calc(100%-24px)] rounded-xl border bg-white p-3 shadow-lg"><MapLayerSwitcher kind={kind} onChange={setKind}/></div>}

   <MapResourceNotice loading={loading} error={error} retry={retry}/>
   <div data-driver-radio-target className="absolute left-3 bottom-3 z-30"/>
   {!points.driver&&<p className="absolute right-3 bottom-3 rounded-xl bg-white px-3 py-2 text-xs">بانتظار تحديث موقع السائق</p>}
  </div>
  <footer data-map-legal aria-label="حقوق مصادر الخريطة" className="relative z-20 flex flex-wrap items-center justify-between gap-2 border-t bg-white px-3 py-2"><div ref={brand}/><div ref={credits}/><MapProviderLogo kind={kind} target={brand}/></footer>
 </section>;
}
