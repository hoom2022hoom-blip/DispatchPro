import {matchesMapSearch,normalizeMapSearch} from './map-search';
export type MapPlace={name:string;latitude:number;longitude:number};
export function mergeMapPlaces(...groups:MapPlace[][]):MapPlace[]{
 const found=new Map<string,MapPlace>();
 for(const place of groups.flat()){
  if(!place.name?.trim()||!Number.isFinite(place.latitude)||!Number.isFinite(place.longitude)||Math.abs(place.latitude)>90||Math.abs(place.longitude)>180)continue;
  const key=normalizeMapSearch(place.name)+':'+place.longitude.toFixed(4)+','+place.latitude.toFixed(4);
  if(!found.has(key))found.set(key,place);
 }
 return [...found.values()].slice(0,20);
}
export function mapPlaceResults(features:Array<{properties?:Record<string,unknown>|null;geometry:{type:string;coordinates?:unknown}}>,query:string):MapPlace[]{
 const term=normalizeMapSearch(query);if(term.length<2)return [];
 const found=new Map<string,MapPlace>();
 for(const feature of features){const p=feature.properties??{},names=[p.name_ar,p['name:ar'],p.name_script==='Arabic'?p.name:null,p.name_en,p['name:en'],p.name].filter((n):n is string=>typeof n==='string'&&!!n.trim());
  if(!matchesMapSearch(names,term))continue;
  const c=feature.geometry.coordinates;
  const pair=feature.geometry.type==='Point'?c:feature.geometry.type==='LineString'&&Array.isArray(c)?c[Math.floor(c.length/2)]:null;
  if(!Array.isArray(pair)||!Number.isFinite(pair[0])||!Number.isFinite(pair[1])||Math.abs(pair[0])>180||Math.abs(pair[1])>90)continue;
  const name=names[0];found.set(normalizeMapSearch(name)+':'+pair.map(n=>Number(n).toFixed(4)).join(','),{name,longitude:pair[0],latitude:pair[1]});
  if(found.size>=20)break;
 }
 return [...found.values()];
}
