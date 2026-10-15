"use client";
import {useEffect,useState} from 'react';
import type {MapRef} from 'react-map-gl/maplibre';
import {mapPlaceResults,type MapPlace} from '@/lib/map-place-search';
// Search loaded data; typing never invokes a geocoding service.
export function MapPlaceSearch({query,mapRef,onChoose}:{query:string;mapRef:React.RefObject<MapRef|null>;onChoose:(place:MapPlace)=>void}){
 const [results,setResults]=useState<MapPlace[]>([]);
 useEffect(()=>{
  setResults([]);let timer:ReturnType<typeof setTimeout>;
  const scan=()=>{try{setResults(mapPlaceResults((mapRef.current?.queryRenderedFeatures?.()??[]) as Parameters<typeof mapPlaceResults>[0],query));}catch{setResults([]);}};
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(scan,200);},map=mapRef.current;
  schedule();map?.on?.('moveend',schedule);map?.on?.('idle',schedule);
  return()=>{clearTimeout(timer);map?.off?.('moveend',schedule);map?.off?.('idle',schedule);};
 },[query,mapRef]);
 return <div className="border-t border-slate-200 p-2 text-xs"><p className="mb-1 leading-5 text-slate-600">أماكن وشوارع من البيانات المحمّلة على الخريطة · بلا طلبات بحث تلقائية</p>{results.map(place=><button type="button" key={place.name+place.latitude+place.longitude} aria-label={`اختيار مكان ${place.name}`} className="block min-h-11 w-full rounded-lg px-2 text-right text-sm text-blue-800 hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-blue-600" onClick={()=>onChoose(place)}>{place.name}</button>)}{query.trim().length>=2&&!results.length&&<p role="status" className="py-2 leading-5 text-slate-500">لا توجد أماكن مطابقة في البيانات المحمّلة. جرّب موقعًا محفوظًا أو حرّك الخريطة.</p>}</div>;
}
