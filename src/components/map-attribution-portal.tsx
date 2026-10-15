"use client";
import {useEffect,type RefObject} from 'react';
import {useMap} from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
// Keep MapLibre's own source attribution, deduplication and updates. Only its
// public control lifecycle is hosted outside the overlapping map panels.
export function MapAttributionPortal({target}:{target:RefObject<HTMLDivElement|null>}){
 const {current}=useMap();
 useEffect(()=>{
  const host=target.current,map=current?.getMap();if(!host||!map)return;
  const control=new maplibregl.AttributionControl({compact:false}),element=control.onAdd(map);
  host.appendChild(element);
  return()=>{control.onRemove();};
 },[current,target]);
 return null;
}
