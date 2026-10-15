import {mapboxEnabled,mapboxGlyphsUrl} from '@/lib/mapbox-style';
import type {Feature,Point,FeatureCollection} from 'geojson';
import type {CircleLayerSpecification,SymbolLayerSpecification,GeoJSONSourceDiff,StyleSpecification} from 'maplibre-gl';
import {driverMotion,lastKnownLocation,liveLocation,operationalStatus,type MapDriver} from './office-driver-map';
export type TaxiFeature=Feature<Point,{driverId:string;selected:boolean;talking:boolean;icon:string;heading:number;fresh:boolean}> & {id:string};
export type FleetTransition={origin:number[];started:number};
export function interpolatedFleetFeature(feature:TaxiFeature,transitions:Map<string,FleetTransition>,time:number):TaxiFeature{
 const motion=transitions.get(feature.id);if(!motion)return feature;
 const t=Math.max(0,Math.min(1,(time-motion.started)/650));if(t>=1){transitions.delete(feature.id);return feature;}
 const progress=t*t*(3-2*t);
 return {...feature,geometry:{...feature.geometry,coordinates:feature.geometry.coordinates.map((value,i)=>motion.origin[i]+(value-motion.origin[i])*progress)}};
}
export const emptyTaxis:FeatureCollection<Point,TaxiFeature['properties']>={type:'FeatureCollection',features:[]};
// The one-second freshness clock must not rebuild every GeoJSON feature or reset
// animation effects. Include mutable GPS inputs as well as freshness boundaries.
export function fleetRenderKey(drivers:MapDriver[],now:number,maxAge:number){
 return JSON.stringify(drivers.map(d=>{const p=lastKnownLocation(d),fresh=!!liveLocation(d,now,maxAge);return [d.id,d.connectionStatus,p?.longitude,p?.latitude,operationalStatus(d).status,fresh,fleetHeading(d,fresh)];}));
}
function fleetHeading(driver:MapDriver,fresh:boolean){return fresh?(Number.isFinite(driver.recordedHeading)?((driver.recordedHeading!%360)+360)%360:driverMotion(driver)?.bearing??0):0;}
export const fleetClusterRadius=56,fleetClusterMaxZoom=13;
export const fleetClusterPaint:NonNullable<CircleLayerSpecification['paint']>={'circle-radius':['step',['get','point_count'],17,50,20,200,23],'circle-color':'#152238','circle-stroke-color':'#facc15','circle-stroke-width':2};
export const fleetClusterCountLayout:NonNullable<SymbolLayerSpecification['layout']>={'icon-image':['concat','taxi-count-',['to-string',['get','point_count_abbreviated']]],'icon-allow-overlap':true,'icon-ignore-placement':true};

// Include owned overlays in every style diff so MapLibre never removes their sources.
export function withFleetOverlay(style:StyleSpecification):StyleSpecification{
 return {...style,glyphs:style.glyphs??(mapboxEnabled()?mapboxGlyphsUrl():'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'),sources:{...style.sources,
  'office-taxis':{type:'geojson',data:emptyTaxis,cluster:true,clusterRadius:fleetClusterRadius,clusterMaxZoom:fleetClusterMaxZoom},
  'office-selected-taxi':{type:'geojson',data:emptyTaxis},
  'office-speaking-taxi':{type:'geojson',data:emptyTaxis}},layers:[...style.layers,
  {id:'office-taxi-clusters',type:'circle',source:'office-taxis',filter:['has','point_count'],paint:fleetClusterPaint},
  {id:'office-taxi-cluster-count',type:'symbol',source:'office-taxis',filter:['has','point_count'],layout:fleetClusterCountLayout},
  {id:'office-taxi-cluster-hit',type:'circle',source:'office-taxis',filter:['has','point_count'],paint:{'circle-radius':24,'circle-opacity':0}},
  {id:'office-taxi-speaking',type:'circle',source:'office-taxis',filter:['==',['get','talking'],true],paint:{'circle-radius':22,'circle-color':'#a78bfa','circle-opacity':0.2,'circle-stroke-color':'#7c3aed','circle-stroke-width':2}},
  {id:'office-taxi-hit-target',type:'circle',source:'office-taxis',minzoom:fleetClusterMaxZoom+1,filter:['!',['has','point_count']],paint:{'circle-radius':22,'circle-opacity':0}},
  {id:'office-taxi-cars',type:'symbol',source:'office-taxis',filter:['!',['has','point_count']],layout:{'icon-image':['get','icon'],'icon-size':0.9,'icon-rotate':['get','heading'],'icon-rotation-alignment':'map','icon-allow-overlap':false,'icon-ignore-placement':false}},
  {id:'office-taxi-selection',type:'circle',source:'office-selected-taxi',paint:{'circle-radius':23,'circle-color':'#60a5fa','circle-opacity':0.25,'circle-stroke-width':2,'circle-stroke-color':'#2563eb'}},
  {id:'office-taxi-selected',type:'symbol',source:'office-selected-taxi',layout:{'icon-image':['get','icon'],'icon-size':1.05,'icon-rotate':['get','heading'],'icon-rotation-alignment':'map','icon-allow-overlap':true}},
  {id:'office-speaker-ring',type:'circle',source:'office-speaking-taxi',paint:{'circle-radius':25,'circle-color':'#a78bfa','circle-opacity':0.22,'circle-stroke-color':'#7c3aed','circle-stroke-width':2}},
  {id:'office-speaker-car',type:'symbol',source:'office-speaking-taxi',layout:{'icon-image':['get','icon'],'icon-size':1,'icon-rotate':['get','heading'],'icon-rotation-alignment':'map','icon-allow-overlap':true}}
 ]};
}
export function fleetFeatures(drivers:MapDriver[],selected:string|null,now:number,maxAge:number,speaker?:string):TaxiFeature[]{
 return drivers.flatMap(d=>{
  const location=lastKnownLocation(d);if(!location)return [];
  const fresh=!!liveLocation(d,now,maxAge),status=operationalStatus(d).status;
  const color=d.connectionStatus==='unknown'?'gray':status==='Offline'?'red':!fresh?'gray':status==='InProgress'?'blue':status==='Available'?'green':'yellow';
  return [{type:'Feature',id:d.id,properties:{driverId:d.id,selected:d.id===selected,talking:d.id===speaker,icon:'taxi-'+color,heading:fleetHeading(d,fresh),fresh},geometry:{type:'Point',coordinates:[location.longitude,location.latitude]}}];
 });
}
export function fleetDiff(previous:Map<string,TaxiFeature>,next:TaxiFeature[],partial=false):GeoJSONSourceDiff{
 // Animation frames contain only moving cars. Unmentioned cars must remain in the source.
 const ids=partial?null:new Set(next.map(f=>f.id)),remove=ids?[...previous.keys()].filter(id=>!ids.has(id)):[],add:TaxiFeature[]=[],update:NonNullable<GeoJSONSourceDiff['update']>=[];
 for(const f of next){const before=previous.get(f.id);if(!before){add.push(f);continue;}
  const geometryChanged=before.geometry.coordinates.some((v,i)=>v!==f.geometry.coordinates[i]);
  const propertiesChanged=Object.keys(f.properties).some(key=>before.properties[key as keyof TaxiFeature['properties']]!==f.properties[key as keyof TaxiFeature['properties']]);
  if(geometryChanged||propertiesChanged)update.push({id:f.id,...(geometryChanged?{newGeometry:f.geometry}:{}),...(propertiesChanged?{addOrUpdateProperties:Object.entries(f.properties).map(([key,value])=>({key,value}))}:{})});
 }
 return {remove,add,update};
}
export function hasFleetDiff(diff:GeoJSONSourceDiff){return !!(diff.add?.length||diff.remove?.length||diff.update?.length);}
