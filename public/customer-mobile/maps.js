let library;
export function loadMapLibrary() {
  return library ??= new Promise((resolve,reject)=>{
    const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./maplibre-gl.css',import.meta.url).href;document.head.append(css);
    const script=document.createElement('script');script.src=new URL('./maplibre-gl.js',import.meta.url).href;script.onload=()=>resolve(window.maplibregl);script.onerror=()=>{library=null;script.remove();reject(Error('تعذر تحميل الخريطة'));};document.head.append(script);
  });
}
const style={version:8,sources:{osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,attribution:'© OpenStreetMap contributors'}},layers:[{id:'osm',type:'raster',source:'osm'}]};
export async function createMap(container,point,onPick,viewport) {
  const lib=await loadMapLibrary();
  // A city center is a viewport only; it is never a selected customer location.
  const center=point||viewport||{latitude:32.2211,longitude:35.2544};
  const map=new lib.Map({container,style,center:[center.longitude,center.latitude],zoom:14});
  map.addControl(new lib.NavigationControl());
  let marker=null;
  function choose(lngLat){
    if(!marker){marker=new lib.Marker({draggable:true,color:'#171717'}).setLngLat(lngLat).addTo(map);marker.on('dragend',()=>choose(marker.getLngLat()));}
    else marker.setLngLat(lngLat);
    onPick?.({latitude:lngLat.lat??lngLat[1],longitude:lngLat.lng??lngLat[0],locationSource:'MAP_PIN'});
  }
  if(point){marker=new lib.Marker({draggable:true,color:'#171717'}).setLngLat([point.longitude,point.latitude]).addTo(map);marker.on('dragend',()=>choose(marker.getLngLat()));}
  if(onPick)map.on('click',e=>{if(e.originalEvent?.target.closest?.('.maplibregl-marker'))return;choose(e.lngLat);});
  return {map,get marker(){return marker;}};
}

// Update markers in place. Never recenter while a passenger is exploring the map.
export async function createJourneyMap(container,points,onPick){
  const lib=await loadMapLibrary();
  const first=Object.values(points).find(p=>p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180)||{latitude:32.2211,longitude:35.2544};
  const map=new lib.Map({container,style,center:[first.longitude,first.latitude],zoom:14});
  map.addControl(new lib.NavigationControl());
  const markers=new Map();
  let animation=0,driverTarget='',disposed=false;
  function moveDriver(marker,point){
    const target=`${point.latitude}:${point.longitude}:${point.updatedAt||''}`;
    if(target===driverTarget)return;
    driverTarget=target;cancelAnimationFrame(animation);
    const from=marker.getLngLat(),to=[point.longitude,point.latitude];
    // Interpolate only between observed positions; never extrapolate speed/heading.
    if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){marker.setLngLat(to);return;}
    const start=performance.now();
    function frame(now){if(disposed||!markers.has('driver'))return;const t=Math.min(1,(now-start)/700),ease=t*t*(3-2*t);marker.setLngLat([from.lng+(to[0]-from.lng)*ease,from.lat+(to[1]-from.lat)*ease]);if(t<1)animation=requestAnimationFrame(frame);}
    animation=requestAnimationFrame(frame);
  }
  map.on('remove',()=>{disposed=true;cancelAnimationFrame(animation);});
  const labels={customer:['أنت','#171717'],driver:['السيارة','#171717'],pickup:['الالتقاء','#854d0e'],destination:['الوجهة','#171717']};
  function update(next){
    for(const [key,[label,color]] of Object.entries(labels)){
      const point=next[key];
      if(!point||!Number.isFinite(point.latitude)||!Number.isFinite(point.longitude)||Math.abs(point.latitude)>90||Math.abs(point.longitude)>180){if(key==='driver'){cancelAnimationFrame(animation);driverTarget='';}markers.get(key)?.remove();markers.delete(key);continue;}
      let marker=markers.get(key);
      if(!marker){const element=document.createElement('div');element.textContent=label;element.style.cssText=`background:${color};color:white;border:3px solid #facc15;border-radius:24px;padding:7px 10px;font:bold 13px Tahoma;box-shadow:0 2px 8px #0005`;element.setAttribute('aria-label',label);marker=new lib.Marker({element,anchor:key==='customer'?'bottom':'top'}).setLngLat([point.longitude,point.latitude]).addTo(map);markers.set(key,marker);}
      else if(key==='driver')moveDriver(marker,point);else marker.setLngLat([point.longitude,point.latitude]);
    }
  }
  function fit(){const bounds=new lib.LngLatBounds();for(const marker of markers.values())bounds.extend(marker.getLngLat());if(markers.size)map.fitBounds(bounds,{padding:65,maxZoom:15,duration:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?0:500});}
  update(points);map.once('load',fit);
  if(onPick)map.on('click',e=>{if(e.originalEvent.target.closest?.('.maplibregl-marker'))return;onPick({latitude:e.lngLat.lat,longitude:e.lngLat.lng,locationSource:'MAP_PIN'});});
  return {map,update,fit};
}
