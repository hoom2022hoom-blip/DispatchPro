"use client";
import {fleetClusterRadius,fleetClusterMaxZoom,fleetClusterPaint,fleetClusterCountLayout,emptyTaxis,fleetFeatures,fleetRenderKey,fleetDiff,hasFleetDiff,interpolatedFleetFeature,type TaxiFeature,type FleetTransition} from '@/lib/fleet-map-render';
import {memo,useEffect,useMemo,useRef} from 'react';
import {Source,Layer,type MapRef} from 'react-map-gl/maplibre';
import type {GeoJSONSource,Map as LibreMap} from 'maplibre-gl';
import {gpsMotion,lastKnownLocation,liveLocation,operationalStatus,type MapDriver} from '@/lib/office-driver-map';
export const taxiSourceId='office-taxis';
export const taxiLayerId='office-taxi-cars';
export const taxiHitLayerId='office-taxi-hit-target';
export const taxiClusterLayerId='office-taxi-clusters';
export const taxiClusterHitLayerId='office-taxi-cluster-hit';
export const taxiSelectedLayerId='office-taxi-selected';
export const taxiSpeakerLayerId='office-speaker-car';
const colors={green:'#16a34a',yellow:'#eab308',blue:'#2563eb',red:'#dc2626',gray:'#64748b'};
const taxiSprites=new Map<string,ImageData>();
const countSprites=new Map<string,ImageData>();
// Small overhead vehicle sprites stay the same screen size at every zoom.
export function installTaxiImages(map:LibreMap,missingId?:string){
 if(missingId?.startsWith('taxi-count-')){
  if(map.hasImage(missingId))return;
  const text=missingId.slice(11);if(!/^\d+(?:\.\d+)?[kKmM]?$/.test(text)||text.length>8)return;
  let bitmap=countSprites.get(text);
  if(!bitmap){const canvas=document.createElement('canvas');canvas.width=Math.max(36,Math.min(128,text.length*18+8));canvas.height=40;const c=canvas.getContext('2d');if(!c)return;c.font='700 28px Tahoma, Arial, sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillStyle='#ffffff';c.fillText(text,canvas.width/2,canvas.height/2);bitmap=c.getImageData(0,0,canvas.width,canvas.height);countSprites.set(text,bitmap);if(countSprites.size>128)countSprites.delete(countSprites.keys().next().value!);}
  map.addImage(missingId,bitmap,{pixelRatio:2});return;
 }
 for(const [name,color] of Object.entries(colors)){
  const id='taxi-'+name;if(map.hasImage(id))continue;
  const cached=taxiSprites.get(name);if(cached){map.addImage(id,cached,{pixelRatio:2});continue;}
  const canvas=document.createElement('canvas');canvas.width=48;canvas.height=72;const c=canvas.getContext('2d');if(!c)continue;
  c.fillStyle='#0f172a';c.fillRect(4,15,8,14);c.fillRect(36,15,8,14);c.fillRect(4,45,8,14);c.fillRect(36,45,8,14);
  c.beginPath();c.roundRect(10,3,28,66,8);c.fillStyle=color;c.fill();c.strokeStyle='#fff';c.lineWidth=3;c.stroke();
  c.fillStyle='#dbeafe';c.beginPath();c.roundRect(14,13,20,12,3);c.fill();c.fillStyle='#172554';c.beginPath();c.roundRect(14,45,20,10,3);c.fill();
  c.fillStyle='#fef9c3';c.fillRect(13,5,6,3);c.fillRect(29,5,6,3);c.fillStyle='#fecaca';c.fillRect(13,64,6,3);c.fillRect(29,64,6,3);
  // A bright nose makes north/up orientation visible at small map sizes.
  c.fillStyle='#fff';c.beginPath();c.moveTo(24,4);c.lineTo(19,10);c.lineTo(29,10);c.closePath();c.fill();
  c.fillStyle='#fff';c.beginPath();c.roundRect(16,29,16,12,3);c.fill();c.strokeStyle='#0f172a';c.lineWidth=2;c.lineCap='round';
  c.beginPath();
  if(name==='green'){c.arc(24,35,3,0,Math.PI*2);}
  else if(name==='blue'){c.moveTo(20,37);c.lineTo(24,32);c.lineTo(28,37);}
  else if(name==='yellow'){c.moveTo(21,32);c.lineTo(21,38);c.moveTo(27,32);c.lineTo(27,38);}
  else if(name==='red'){c.moveTo(21,32);c.lineTo(27,38);c.moveTo(27,32);c.lineTo(21,38);}
  else {c.moveTo(20,38);c.lineTo(28,32);}
  c.stroke();
  const image=c.getImageData(0,0,48,72);taxiSprites.set(name,image);map.addImage(id,image,{pixelRatio:2});
 }
}
export function OfficeTaxiLayer({drivers,selected,now,maxAge,mapRef,speaker,visible=true}:{drivers:MapDriver[];selected:string|null;now:number;maxAge:number;mapRef:React.RefObject<MapRef|null>;speaker?:string;visible?:boolean}){
 const renderKey=fleetRenderKey(drivers,now,maxAge);
 // renderKey includes every time-dependent value used by fleetFeatures.
 const features=useMemo(()=>fleetFeatures(drivers,selected,now,maxAge,speaker),[selected,renderKey,maxAge,speaker]);
 const state=useRef(new Map<string,{source:GeoJSONSource;features:Map<string,TaxiFeature>}>()),previous=useRef<MapDriver[]>([]),motion=useRef(new Map<string,FleetTransition>());
 useEffect(()=>{
  const map=mapRef.current?.getMap?.();if(!map||!visible)return;
  let frame=0,disposed=false,lastFrame=0;
  const origins=new Map(previous.current.map(d=>[d.id,d]));
  const transitions=motion.current;
  const featureIndex=new Map(features.map(f=>[f.id,f]));
  for(const id of transitions.keys())if(!featureIndex.has(id))transitions.delete(id);
  const displayedPositions=new Map<string,number[]>();
  for(const record of state.current.values())for(const [id,feature] of record.features)displayedPositions.set(id,feature.geometry.coordinates);
  if(!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){
   for(const d of drivers){const a=origins.get(d.id)?.location,b=d.location;
    if(!liveLocation(d,now,maxAge)){transitions.delete(d.id);continue;}
    if(a&&b&&a.updatedAt!==b.updatedAt){
     if(gpsMotion({...a,timestamp:a.updatedAt},{...b,timestamp:b.updatedAt})){
      const displayed=displayedPositions.get(d.id);
      transitions.set(d.id,{origin:displayed??[a.longitude,a.latitude],started:performance.now()});
     }else transitions.delete(d.id);
    }
   }
  }else transitions.clear();
  function sync(rows:TaxiFeature[],id:string,partial:boolean){
   const source=map!.getSource(id) as GeoJSONSource|undefined;if(!source)return;
   let record=state.current.get(id);
   if(!record||record.source!==source){record={source,features:new Map()};state.current.set(id,record);}
   const diff=fleetDiff(record.features,rows,partial);if(hasFleetDiff(diff)){
    source.updateData(diff);
    if(partial){for(const row of rows)record.features.set(row.id,row);}else record.features=new Map(rows.map(f=>[f.id,f]));
   }
  }
  function draw(time=performance.now(),partial=false){
   if(disposed)return;
   if(partial&&[taxiSourceId,'office-selected-taxi','office-speaking-taxi'].some(id=>state.current.get(id)?.source!==map!.getSource(id)))partial=false;
   // Snapshot active IDs before interpolation removes completed transitions, so the last frame reaches the exact fix.
   const targets=partial?[...transitions.keys()].map(id=>featureIndex.get(id)!).filter(Boolean):features;
   const rows=targets.map(f=>interpolatedFleetFeature(f,transitions,time));
   const fleet:TaxiFeature[]=[],selection:TaxiFeature[]=[],speaking:TaxiFeature[]=[];
   for(const row of rows){if(row.properties.selected)selection.push(row);else {fleet.push(row);if(row.properties.talking)speaking.push(row);}}
   sync(fleet,taxiSourceId,partial);sync(selection,'office-selected-taxi',partial);sync(speaking,'office-speaking-taxi',partial);
  }
  const tick=(time:number)=>{if(disposed||typeof document!=='undefined'&&document.visibilityState==='hidden')return;
   // Delta transport at <=25 fps; acquisition of GPS continues at its original cadence.
   if(time-lastFrame>=40){draw(time,true);lastFrame=time;}
   if(transitions.size)frame=requestAnimationFrame(tick);
  };
  const missingImage=(event:{id:string})=>installTaxiImages(map,event.id);
  map.on('styleimagemissing',missingImage);
  // Adding a cached label image also emits styledata. Restore geometry only when
  // a source was replaced; those image events must not finish a car's animation.
  const restore=()=>{if((typeof document==='undefined'||document.visibilityState!=='hidden')&&[taxiSourceId,'office-selected-taxi','office-speaking-taxi'].some(id=>state.current.get(id)?.source!==map.getSource(id)))draw();};
  const visibility=()=>{cancelAnimationFrame(frame);if(typeof document==='undefined'||document.visibilityState!=='hidden')draw(performance.now()+650);};
  if(typeof document==='undefined'||document.visibilityState!=='hidden')draw();if(transitions.size&&(typeof document==='undefined'||document.visibilityState!=='hidden'))frame=requestAnimationFrame(tick);
  map.on('styledata',restore);if(typeof document!=='undefined')document.addEventListener('visibilitychange',visibility);
  return()=>{disposed=true;cancelAnimationFrame(frame);map.off('styledata',restore);map.off('styleimagemissing',missingImage);if(typeof document!=='undefined')document.removeEventListener('visibilitychange',visibility);};
 },[features,maxAge,mapRef,visible]);
 // Retain the latest confirmed stationary fix without restarting an animation.
 useEffect(()=>{previous.current=drivers;},[drivers]);
 return <FleetSources/>;
}
// The native sources/layers are static; live fixes travel through updateData.
const FleetSources=memo(function FleetSources(){
 return <><Source id={taxiSourceId} type="geojson" data={emptyTaxis} cluster clusterRadius={fleetClusterRadius} clusterMaxZoom={fleetClusterMaxZoom}>
  <Layer id={taxiClusterLayerId} type="circle" filter={['has','point_count']} paint={fleetClusterPaint}/>
  <Layer id="office-taxi-cluster-count" type="symbol" filter={['has','point_count']} layout={fleetClusterCountLayout}/>
  <Layer id={taxiClusterHitLayerId} type="circle" filter={['has','point_count']} paint={{'circle-radius':24,'circle-opacity':0}}/>
  <Layer id="office-taxi-speaking" type="circle" filter={['==',['get','talking'],true]} paint={{'circle-radius':22,'circle-color':'#a78bfa','circle-opacity':0.2,'circle-stroke-color':'#7c3aed','circle-stroke-width':2}}/>
  <Layer id={taxiHitLayerId} type="circle" minzoom={fleetClusterMaxZoom+1} filter={['!',['has','point_count']]} paint={{'circle-radius':22,'circle-opacity':0}}/>
  <Layer id={taxiLayerId} type="symbol" filter={['!',['has','point_count']]} layout={{'icon-image':['get','icon'],'icon-size':0.9,'icon-rotate':['get','heading'],'icon-rotation-alignment':'map','icon-allow-overlap':false,'icon-ignore-placement':false}}/>
 </Source><Source id="office-selected-taxi" type="geojson" data={emptyTaxis}>
  <Layer id="office-taxi-selection" type="circle" paint={{'circle-radius':23,'circle-color':'#60a5fa','circle-opacity':0.25,'circle-stroke-width':2,'circle-stroke-color':'#2563eb'}}/>
  <Layer id={taxiSelectedLayerId} type="symbol" layout={{'icon-image':['get','icon'],'icon-size':1.05,'icon-rotate':['get','heading'],'icon-rotation-alignment':'map','icon-allow-overlap':true}}/>
 </Source><Source id="office-speaking-taxi" type="geojson" data={emptyTaxis}>
  <Layer id="office-speaker-ring" type="circle" paint={{'circle-radius':25,'circle-color':'#a78bfa','circle-opacity':0.22,'circle-stroke-color':'#7c3aed','circle-stroke-width':2}}/>
  <Layer id={taxiSpeakerLayerId} type="symbol" layout={{'icon-image':['get','icon'],'icon-size':1,'icon-rotate':['get','heading'],'icon-rotation-alignment':'map','icon-allow-overlap':true}}/>
 </Source></>;
});
