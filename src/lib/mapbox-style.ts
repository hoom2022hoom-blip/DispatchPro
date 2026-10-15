import type {StyleSpecification} from 'maplibre-gl';

// Deliberate opt-in: adding a public token alone must never start paid requests.
export function mapboxEnabled(){return process.env.NEXT_PUBLIC_MAPBOX_ENABLED==='true';}
export function mapboxPublicToken(){
 const token=process.env.NEXT_PUBLIC_MAPBOX_PUBLIC_TOKEN?.trim();
 return token&&/^pk\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)?token:null;
}
export function mapboxConfigurationError(){return mapboxEnabled()&&!mapboxPublicToken()?'مفتاح Mapbox العام غير مهيأ؛ لم تُرسل طلبات إلى المزوّد':null;}
const tokenQuery=()=>encodeURIComponent(mapboxPublicToken()??'');
// Local resource fixtures are opt-in and impossible in a production build.
export function mapboxResourceOrigin(){
 const value=process.env.NEXT_PUBLIC_MAPBOX_RESOURCE_ORIGIN;
 if(process.env.NODE_ENV==='development'&&value){
  // Same-origin fixtures also work when the original QA pages are opened on a phone.
  if(value==='/__qa_mapbox')return value;
  try{const url=new URL(value);if(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.pathname==='/__qa_mapbox'&&!url.search&&!url.hash&&!url.username&&!url.password)return value.replace(/\/$/,'');}catch{}
 }
 return 'https://api.mapbox.com';
}
export const mapboxStreetStyleUrl=()=>`${mapboxResourceOrigin()}/styles/v1/mapbox/streets-v12?access_token=${tokenQuery()}`;
export const mapboxGlyphsUrl=()=>`${mapboxResourceOrigin()}/fonts/v1/mapbox/{fontstack}/{range}.pbf?access_token=${tokenQuery()}`;
const credit='<a href="https://www.mapbox.com/" target="_blank" rel="noopener noreferrer">© Mapbox</a> | <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a> | <a href="https://apps.mapbox.com/feedback/" target="_blank" rel="noopener noreferrer">Improve this map</a>';
const supportedTilesets=new Set(['mapbox.mapbox-streets-v8','mapbox.mapbox-terrain-v2','mapbox.mapbox-bathymetry-v2']);
export function mapboxSatelliteSource(){
 return {type:'raster' as const,tiles:[`${mapboxResourceOrigin()}/styles/v1/mapbox/satellite-v9/tiles/256/{z}/{x}/{y}?access_token=${tokenQuery()}`],tileSize:256,minzoom:0,maxzoom:22,attribution:credit+' | <a href="https://www.maxar.com/" target="_blank" rel="noopener noreferrer">© Maxar</a>'};
}
// Reuse the version-8 Streets document proven in QA. MapLibre cannot resolve
// mapbox:// URLs; these are the same official resource APIs used by that test.
export function prepareMapboxStyle(input:StyleSpecification):StyleSpecification{
 if(input.version!==8||!input.sources||!Array.isArray(input.layers)||'imports' in input)throw Error('Unsupported Mapbox style');
 const sources:StyleSpecification['sources']={};
 for(const [id,source] of Object.entries(input.sources)){
  const url='url' in source?source.url:undefined;
  const ids=typeof url==='string'&&url.startsWith('mapbox://')?url.slice(9).split(','):[];
  if(source.type!=='vector'||!ids.length||ids.some(value=>!supportedTilesets.has(value)))throw Error('Unsupported Mapbox source');
  sources[id]={type:'vector',tiles:[`${mapboxResourceOrigin()}/v4/${ids.join(',')}/{z}/{x}/{y}.vector.pbf?access_token=${tokenQuery()}`],minzoom:0,maxzoom:16,attribution:credit};
 }
 return {version:8,name:'DispatchPro · Mapbox',metadata:{'dispatchpro:provider':'mapbox'},sources,
  glyphs:mapboxGlyphsUrl(),
  sprite:`${mapboxResourceOrigin()}/styles/v1/mapbox/streets-v12/sprite?access_token=${tokenQuery()}`,
  layers:input.layers.filter(layer=>(layer.type as string)!=='sky').map(layer=>{
   const result={...layer} as typeof layer&{slot?:unknown};delete result.slot;
   return layer.type==='symbol'?{...result,layout:{...layer.layout,'text-font':['Arial Unicode MS Regular']}} as typeof layer:result;
  })};
}
