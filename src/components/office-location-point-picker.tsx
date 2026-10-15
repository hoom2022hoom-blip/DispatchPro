"use client";
import {useRef,useEffect} from 'react';
import Map,{Marker,NavigationControl,type MapRef} from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import {useMapStyle} from '@/hooks/use-map-style';
export type LocationPoint={latitude:number;longitude:number};
export function LocationPointPicker({point,onChange,kind='clear',fill=false}:{point?:LocationPoint;onChange:(point:LocationPoint)=>void;kind?:'clear'|'detailed';fill?:boolean}){
 const map=useRef<MapRef>(null);const {style,error}=useMapStyle(kind);
 useEffect(()=>{if(point)map.current?.easeTo({center:[point.longitude,point.latitude],duration:200});},[point?.latitude,point?.longitude]);
 return <div className={fill?'relative h-full min-h-0':'relative h-64'}><Map ref={map} mapStyle={style} initialViewState={{latitude:point?.latitude??32.2211,longitude:point?.longitude??35.2544,zoom:14}} RTLTextPlugin="/mapbox-gl-rtl-text-0.2.3.min.js" onClick={e=>onChange({latitude:e.lngLat.lat,longitude:e.lngLat.lng})}><NavigationControl/>{point&&<Marker latitude={point.latitude} longitude={point.longitude} draggable onDragEnd={e=>onChange({latitude:e.lngLat.lat,longitude:e.lngLat.lng})}/>}</Map>{error&&<p role="status" className="absolute bottom-8 right-2 rounded bg-white p-2 text-sm">{error}</p>}</div>;
}
