let library;
export function loadMapLibrary() {
  return library ??= new Promise((resolve,reject)=>{
    const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./maplibre-gl.css',import.meta.url).href;document.head.append(css);
    const script=document.createElement('script');script.src=new URL('./maplibre-gl.js',import.meta.url).href;script.onload=()=>resolve(window.maplibregl);script.onerror=()=>{library=null;script.remove();reject(Error('تعذر تحميل الخريطة'));};document.head.append(script);
  });
}
const style={version:8,sources:{osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,attribution:'© OpenStreetMap contributors'}},layers:[{id:'osm',type:'raster',source:'osm'}]};
export async function createMap(container,point,onPick) {
  const lib=await loadMapLibrary();
  const map=new lib.Map({container,style,center:[point.longitude,point.latitude],zoom:14});
  map.addControl(new lib.NavigationControl());
  const marker=new lib.Marker().setLngLat([point.longitude,point.latitude]).addTo(map);
  if(onPick)map.on('click',e=>{marker.setLngLat(e.lngLat);onPick({latitude:e.lngLat.lat,longitude:e.lngLat.lng,locationSource:'MAP_PIN'});});
  return {map,marker};
}

// Update markers in place. Never recenter while a passenger is exploring the map.
export async function createJourneyMap(container,points,onPick){
  const lib=await loadMapLibrary();
  const first=Object.values(points).find(Boolean)||{latitude:32.2211,longitude:35.2544};
  const map=new lib.Map({container,style,center:[first.longitude,first.latitude],zoom:14});
  map.addControl(new lib.NavigationControl());
  const markers=new Map();
  const labels={customer:['أنت','#2563eb'],driver:['السيارة','#145c47'],pickup:['الالتقاء','#9a510b'],destination:['الوجهة','#9333a2']};
  function update(next){
    for(const [key,[label,color]] of Object.entries(labels)){
      const point=next[key];
      if(!point||!Number.isFinite(point.latitude)||!Number.isFinite(point.longitude)){markers.get(key)?.remove();markers.delete(key);continue;}
      let marker=markers.get(key);
      if(!marker){const element=document.createElement('div');element.textContent=(key==='driver'?'🚕 ':key==='destination'?'⚑ ':'● ')+label;element.style.cssText=`background:${color};color:white;border:3px solid white;border-radius:24px;padding:7px 10px;font:bold 13px Tahoma;box-shadow:0 2px 8px #0005`;element.setAttribute('aria-label',label);marker=new lib.Marker({element,anchor:key==='customer'?'bottom':'top'}).setLngLat([point.longitude,point.latitude]).addTo(map);markers.set(key,marker);}
      else marker.setLngLat([point.longitude,point.latitude]);
    }
  }
  function fit(){const bounds=new lib.LngLatBounds();for(const marker of markers.values())bounds.extend(marker.getLngLat());if(markers.size)map.fitBounds(bounds,{padding:65,maxZoom:15,duration:500});}
  update(points);map.once('load',fit);
  if(onPick)map.on('click',e=>{if(e.originalEvent.target.closest?.('.maplibregl-marker'))return;onPick({latitude:e.lngLat.lat,longitude:e.lngLat.lng,locationSource:'MAP_PIN'});});
  return {map,update,fit};
}
