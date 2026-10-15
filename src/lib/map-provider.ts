import type {StyleSpecification,ExpressionSpecification} from 'maplibre-gl';
import type {MapProps} from 'react-map-gl/maplibre';
import {mapboxEnabled,mapboxPublicToken,mapboxConfigurationError,mapboxStreetStyleUrl,mapboxSatelliteSource} from './mapbox-style';
export {mapboxEnabled} from './mapbox-style';
export const clientMapStyle=(style:StyleSpecification)=>style as unknown as NonNullable<MapProps['mapStyle']>;
export type MapAppearance={labels?:boolean;night?:boolean};
export const emptyMapStyle:StyleSpecification={version:8,sources:{},layers:[{id:'loading-background',type:'background',paint:{'background-color':'#e2e8f0'}}]};
export type MapKind='clear'|'detailed'|'street'|'satellite'|'hybrid'|'sentinel';
export const mapKinds:MapKind[]=['clear','detailed','street','satellite','hybrid','sentinel'];
export const mapLabels:Record<MapKind,string>={clear:'OpenFreeMap Liberty',detailed:'OpenFreeMap Bright',street:'شوارع',satellite:'MapTiler Satellite',hybrid:'MapTiler Hybrid',sentinel:'Sentinel-2'};
const street:StyleSpecification={version:8,sources:{osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'}},layers:[{id:'osm',type:'raster',source:'osm'}]};
function sentinelConfig(){
 const instance=process.env.NEXT_PUBLIC_COPERNICUS_WMS_INSTANCE_ID?.trim();
 const layer=process.env.NEXT_PUBLIC_COPERNICUS_SENTINEL2_LAYER?.trim();
 return instance&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(instance)&&layer&&/^[\w-]+$/.test(layer)?{instance,layer}:null;
}
export function mapBlockedReason(kind:MapKind):string|null {
 if(mapboxEnabled()&&kind!=='sentinel')return mapboxConfigurationError();
 if(kind==='satellite'||kind==='hybrid')return process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim()?null:'صور الأقمار الصناعية غير مفعلة لدى المكتب';
 if(kind==='sentinel'&&!sentinelConfig())return 'مصدر الصور الفضائية غير مهيأ لدى المكتب';
 return null;
}
// Keep provider TileJSON/native zoom limits; never invent keys or increase imagery resolution.
export function mapProvider(kind:MapKind):StyleSpecification|string|null {
 if(mapboxEnabled()&&kind!=='sentinel')return mapboxConfigurationError()?null:mapboxStreetStyleUrl();
 if(kind==='clear'||kind==='detailed')return `https://tiles.openfreemap.org/styles/${kind==='clear'?'liberty':'bright'}`;
 if(kind==='street')return street;
 if(mapBlockedReason(kind))return null;
 if(kind==='sentinel'){
  const {instance,layer}=sentinelConfig()!;
  // Official CDSE WMS: omitted TIME returns the last valid image, not a fixed-year mosaic.
  const url=`https://sh.dataspace.copernicus.eu/ogc/wms/${instance}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&LAYERS=${encodeURIComponent(layer)}&FORMAT=image/png`;
  return {version:8,sources:{sentinel:{type:'raster',tiles:[url],tileSize:256,maxzoom:13,attribution:'Contains modified Copernicus Sentinel data · <a href="https://dataspace.copernicus.eu/">Copernicus Data Space Ecosystem</a>'}},layers:[{id:'sentinel',type:'raster',source:'sentinel',paint:{'raster-resampling':'nearest'}}]};
 }
 const key=encodeURIComponent(process.env.NEXT_PUBLIC_MAPTILER_KEY!.trim());
 return `https://api.maptiler.com/maps/${kind==='satellite'?'satellite-v4':'hybrid-v4'}/style.json?key=${key}`;
}

// Change only existing named symbol layers; keep roads, imagery, fonts and attribution.
export function arabicHybridStyle(style:StyleSpecification):StyleSpecification {
 return {...style,layers:style.layers.map(layer=>{
  if(layer.type!=='symbol'||!layer.layout?.['text-field'])return layer;
  if(!JSON.stringify(layer.layout['text-field']).includes('name'))return layer;
  // typeof is runtime-validated in tests; MapLibre 4's bundled expression union omits it.
  const hasName=(key:string)=>['all',['==',['typeof',['get',key]],'string'],['!=',['get',key],'']] as unknown as ExpressionSpecification;
  return {...layer,layout:{...layer.layout,'text-field':['case',hasName('name_ar'),['to-string',['get','name_ar']],hasName('name:ar'),['to-string',['get','name:ar']],hasName('name'),['to-string',['get','name']],hasName('name_en'),['to-string',['get','name_en']],hasName('name:en'),['to-string',['get','name:en']],'']}} as typeof layer;
 })};
}
export function imageryError(event:{sourceId?:string;source?:{id?:string};error?:{sourceId?:string;url?:string}}){
 return [event.sourceId,event.source?.id,event.error?.sourceId].includes('dispatch-mapbox-satellite')||!!event.error?.url?.includes('/satellite-v9/');
}
export function composeMapStyle(base:StyleSpecification,kind:MapKind,{labels=true,night=false}:MapAppearance={}):StyleSpecification{
 const mapbox=(base.metadata as Record<string,unknown>|undefined)?.['dispatchpro:provider']==='mapbox',satellite=mapbox&&['satellite','hybrid'].includes(kind);
 const arabic=arabicHybridStyle(base);
 return {...arabic,sources:{...arabic.sources,...(mapbox&&mapboxPublicToken()?{'dispatch-mapbox-satellite':mapboxSatelliteSource()}:{})},layers:[
  ...(mapbox&&mapboxPublicToken()?[{id:'dispatch-mapbox-satellite',type:'raster' as const,source:'dispatch-mapbox-satellite',layout:{visibility:satellite?'visible' as const:'none' as const},paint:{'raster-fade-duration':180,'raster-resampling':'linear' as const,'raster-opacity':1,'raster-saturation':0,'raster-contrast':0,'raster-brightness-min':0,'raster-brightness-max':1}}]:[]),
  ...arabic.layers.map(layer=>{
   const symbol=layer.type==='symbol',hidden=symbol?!labels:satellite;
   return {...layer,layout:{...layer.layout,visibility:hidden?'none':layer.layout?.visibility??'visible'},...(satellite&&symbol&&layer.layout?.['text-field']?{paint:{...layer.paint,'text-color':'#ffffff','text-halo-color':'#172033','text-halo-width':1.6}}:{})} as typeof layer;
  }),
  ...(!satellite&&night?[{id:'dispatch-night-tint',type:'background' as const,paint:{'background-color':'#0f172a','background-opacity':0.18}}]:[])
 ]};
}
