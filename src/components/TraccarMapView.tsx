'use client';
import {MapResourceNotice} from './map-resource-notice';
import {latestTraccarPositions,recordedSpeedLabel} from '@/lib/traccar-map';

import { useState, useMemo, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTraccar } from '@/context/traccar-context';
import traccarService from '@/lib/traccar-service';
import Map, {Popup,type MapRef} from 'react-map-gl/maplibre';
import type {GeoJSONSource} from 'maplibre-gl';
import type {TraccarDevice,TraccarPosition} from '@/lib/traccar-service';
import {matchesMapDriver,matchesMapGpsFilter,type MapGpsFilter,type MapDriver} from '@/lib/office-driver-map';
import {useMapStyle} from '@/hooks/use-map-style';
import {clientMapStyle,type MapKind} from '@/lib/map-provider';
import {withFleetOverlay} from '@/lib/fleet-map-render';
import {MapAttributionPortal} from './map-attribution-portal';
import {MapLayerSwitcher,MapProviderLogo} from './map-layer-switcher';
import {OfficeTaxiLayer,installTaxiImages,taxiLayerId,taxiHitLayerId,taxiClusterLayerId,taxiClusterHitLayerId,taxiSelectedLayerId,taxiSourceId} from './office-taxi-layer';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Truck, MapPin, RefreshCw, ExternalLink, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TraccarMapViewProps {
  className?: string;
  mode?: 'embedded' | 'custom' | 'both';
  height?: string;
}

export function TraccarMapView({ 
  className, 
  mode = 'both',
  height = '600px'
}: TraccarMapViewProps) {
  const { 
    devices, 
    positions, 
    loading, 
    authenticated, 
    login, 
    refreshData,
    getOnlineDevices 
  } = useTraccar();
  
  const positionsByDevice=useMemo(()=>latestTraccarPositions(positions),[positions]);
  const [listLimit,setListLimit]=useState(50);
  const [loginCredentials, setLoginCredentials] = useState({
    email: '',
    password: ''
  });
  
  const [isClientMounted, setIsClientMounted] = useState(false);
  
  // Initialize credentials after client mount to avoid hydration mismatch
  useEffect(() => {
    setIsClientMounted(true);
    setLoginCredentials({
      email: process.env.NEXT_PUBLIC_TRACCAR_EMAIL || 'admin',
      password: process.env.NEXT_PUBLIC_TRACCAR_PASSWORD || 'admin'
    });
  }, []);

  const handleLogin = async () => {
    await login(loginCredentials.email, loginCredentials.password);
  };

  const mapCenter = useMemo(() => {
    if (positions.length > 0) {
      const validPositions = [...positionsByDevice.values()];
      if (validPositions.length > 0) {
        const avgLat = validPositions.reduce((sum, p) => sum + p.latitude, 0) / validPositions.length;
        const avgLng = validPositions.reduce((sum, p) => sum + p.longitude, 0) / validPositions.length;
        return { longitude: avgLng, latitude: avgLat };
      }
    }
    // Default Nablus viewport only; never a GPS observation.
    return { longitude:35.2544,latitude:32.2211 };
  }, [positionsByDevice]);

  const activeDevices = devices.filter(d => !d.disabled);
  const onlineDevices = getOnlineDevices();

  const EmbeddedTraccarMap = () => (
    <div className="relative w-full" style={{ height }}>
      <iframe
        src={traccarService.getWebInterfaceUrl()}
        className="w-full h-full border-0 rounded-lg"
        title="Traccar Map"
        allow="geolocation"
      />
      <div className="absolute top-2 right-2 z-10">
        <Button 
          size="sm" 
          variant="outline" 
          onClick={() => window.open(traccarService.getWebInterfaceUrl(), '_blank')}
        >
          <ExternalLink className="w-4 h-4 mr-1" />
          Open Full Screen
        </Button>
      </div>
    </div>
  );

  const customMap = <TraccarPositionsMap positions={positions} devices={devices} mapCenter={mapCenter} height={height} refreshData={refreshData} loading={loading}/>;

  if (!authenticated) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Traccar Fleet Map</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Connect to Traccar server to view fleet positions
            </div>
            {isClientMounted && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Email</label>
                  <input
                    type="email"
                    value={loginCredentials.email}
                    onChange={(e) => setLoginCredentials(prev => ({ ...prev, email: e.target.value }))}
                    className="w-full mt-1 p-2 border rounded"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Password</label>
                  <input
                    type="password"
                    value={loginCredentials.password}
                    onChange={(e) => setLoginCredentials(prev => ({ ...prev, password: e.target.value }))}
                    className="w-full mt-1 p-2 border rounded"
                  />
                </div>
              </div>
            )}
            <Button onClick={handleLogin} disabled={loading}>
              {loading ? 'Connecting...' : 'Connect to Traccar'}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={className}>
      {/* Stats */}
      <div className="flex flex-wrap gap-2 mb-3">
        <Badge variant="outline">
          Total Devices: {devices.length}
        </Badge>
        <Badge variant="outline">
          Active: {activeDevices.length}
        </Badge>
        <Badge variant="outline" className="text-green-600">
          Online: {onlineDevices.length}
        </Badge>
        <Badge variant="outline">
          Last Update: {new Date().toLocaleTimeString()}
        </Badge>
      </div>

      {mode === 'both' ? (
        <Tabs defaultValue="custom" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="custom">Custom Map</TabsTrigger>
            <TabsTrigger value="embedded">Traccar Interface</TabsTrigger>
          </TabsList>
          <TabsContent value="custom">
            {customMap}
          </TabsContent>
          <TabsContent value="embedded">
            <EmbeddedTraccarMap />
          </TabsContent>
        </Tabs>
      ) : mode === 'embedded' ? (
        <EmbeddedTraccarMap />
      ) : (
        customMap
      )}

      {/* Device List */}
      <details className="mt-4 space-y-2 rounded-xl border p-3">
        <summary className="min-h-11 cursor-pointer font-semibold">قائمة الأسطول ({devices.length})</summary>
        <div className="grid gap-2 max-h-40 overflow-y-auto">
          {devices.slice(0,listLimit).map(device => {
            const position = positionsByDevice.get(device.id);
            return (
              <div key={device.id} className="flex items-center justify-between p-2 border rounded">
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "w-2 h-2 rounded-full",
                    device.status === 'online' ? 'bg-green-500' : 'bg-gray-400'
                  )} />
                  <span className="font-medium">{device.name}</span>
                  <Badge variant={device.disabled ? "destructive" : "secondary"}>
                    {device.status}
                  </Badge>
                </div>
                <div className="text-sm text-muted-foreground">
                  {position ? (
                    <>
                      {recordedSpeedLabel(position.speed)}
                      {position.address && ` • ${position.address.substring(0, 30)}...`}
                    </>
                  ) : (
                    'No recent position'
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {listLimit<devices.length&&<button type="button" className="min-h-11 rounded-lg border px-3" onClick={()=>setListLimit(n=>n+50)}>عرض 50 إضافية</button>}
        {listLimit>50&&<button type="button" className="min-h-11 rounded-lg border px-3" onClick={()=>setListLimit(50)}>تصغير القائمة</button>}
      </details>
    </div>
  );
}

// Read-only presentation of the existing context. No Traccar connection or write API here.
function TraccarPositionsMap({positions,devices,mapCenter,height,refreshData,loading}:{positions:TraccarPosition[];devices:TraccarDevice[];mapCenter:{longitude:number;latitude:number};height:string;refreshData:()=>Promise<void>;loading:boolean}){
 const [kind,setKind]=useState<MapKind>('street'),[selected,setSelected]=useState<string|null>(null),[now,setNow]=useState(Date.now()),[search,setSearch]=useState(''),[gps,setGps]=useState<MapGpsFilter>('All'),[connection,setConnection]=useState('All');
 const map=useRef<MapRef>(null),frame=useRef<HTMLDivElement>(null),canvas=useRef<HTMLDivElement>(null),brand=useRef<HTMLDivElement>(null),credit=useRef<HTMLDivElement>(null);
 const latestPositions=useMemo(()=>latestTraccarPositions(positions),[positions]);
 const connectionById=useMemo(()=>new globalThis.Map(devices.map(d=>[String(d.id),d.status])),[devices]);
 const {rawStyle,error,loading:styleLoading,retry}=useMapStyle(kind),style=useMemo(()=>clientMapStyle(withFleetOverlay(rawStyle)),[rawStyle]);
 const drivers=useMemo<MapDriver[]>(()=>{const index=new globalThis.Map(devices.map(d=>[d.id,d]));return [...latestPositions.values()].flatMap(p=>{
  const device=index.get(p.deviceId);if(!device||device.disabled)return [];
  return [{connectionStatus:device.status==='online'?'online':device.status==='offline'?'offline':'unknown',recordedHeading:Number.isFinite(p.course)&&p.speed>0?p.course:undefined,id:String(p.deviceId),fullName:device.name,active:true,status:device.status==='online'?'Available':'Offline',currentRide:null,waitingCount:0,locationStatus:p.outdated?'STALE':'FRESH',updatedAt:p.fixTime,location:{latitude:p.latitude,longitude:p.longitude,accuracy:p.accuracy??Number.NaN,updatedAt:p.fixTime}}];
 });},[positions,devices]);
 const visibleDrivers=useMemo(()=>drivers.filter(d=>matchesMapDriver(d,search)&&matchesMapGpsFilter(d,gps,now,120)&&(connection==='All'||connectionById.get(d.id)===connection)),[drivers,search,gps,connection,connectionById,now]);
 useEffect(()=>{if(selected&&!visibleDrivers.some(d=>d.id===selected))setSelected(null);},[selected,visibleDrivers]);
 const driver=drivers.find(d=>d.id===selected),position=latestPositions.get(Number(selected));
 useEffect(()=>{const clock=setInterval(()=>{if(document.visibilityState!=='hidden')setNow(Date.now());},1000);return()=>clearInterval(clock);},[]);
 useEffect(()=>{const el=canvas.current;if(!el)return;const observer=new ResizeObserver(()=>map.current?.resize());observer.observe(el);return()=>observer.disconnect();},[]);
 useEffect(()=>{
  const el=frame.current;if(!el)return;
  const measure=()=>{const value=Math.ceil(Math.max(0,el.getBoundingClientRect().top))+'px';if(el.style.getPropertyValue('--fleet-map-top')!==value)el.style.setProperty('--fleet-map-top',value);};
  measure();const observer=new ResizeObserver(measure);observer.observe(el);if(el.parentElement)observer.observe(el.parentElement);
  window.addEventListener('resize',measure);document.addEventListener('toggle',measure,true);
  return()=>{observer.disconnect();window.removeEventListener('resize',measure);document.removeEventListener('toggle',measure,true);};
 },[]);
 return <div ref={frame} data-fleet-map className="flex w-full flex-col overflow-hidden rounded-lg border [&_.maplibregl-popup-close-button]:min-h-11 [&_.maplibregl-popup-close-button]:min-w-11 [&_.maplibregl-popup-content]:pt-11" style={{height,maxHeight:'max(220px, calc(100dvh - var(--fleet-map-top, 192px) - 12px))'}}>
  <div className="flex shrink-0 flex-wrap items-center gap-2 bg-white p-2" dir="rtl"><details className="relative"><summary className="min-h-11 cursor-pointer rounded border px-3 py-2">طبقات الخريطة</summary><div className="absolute right-0 top-full z-40 w-64 rounded border bg-white p-2 shadow"><MapLayerSwitcher kind={kind} onChange={setKind}/></div></details><Button size="sm" variant="outline" onClick={refreshData} disabled={loading}><RefreshCw className={cn('mr-1 h-4 w-4',loading&&'animate-spin')}/>Refresh</Button><details className="relative"><summary className="min-h-11 cursor-pointer rounded border px-3 py-2">بحث وفلاتر</summary><div className="absolute right-0 top-full z-40 w-64 max-w-[calc(100vw-24px)] space-y-2 rounded-xl border bg-white p-3 shadow-lg"><label className="block text-sm">بحث السائق<input type="search" aria-label="بحث سيارات الأسطول" className="min-h-11 w-full rounded-lg border px-2" value={search} onChange={e=>setSearch(e.target.value)}/></label><label className="block text-sm">GPS<select aria-label="فلتر GPS للأسطول" className="min-h-11 w-full rounded-lg border px-2" value={gps} onChange={e=>setGps(e.target.value as MapGpsFilter)}><option value="All">كل المواقع</option><option value="Live">مواقع مباشرة</option><option value="Stale">مواقع قديمة</option><option value="Poor">دقة ضعيفة</option></select></label><label className="block text-sm">اتصال الجهاز<select aria-label="فلتر اتصال الأسطول" className="min-h-11 w-full rounded-lg border px-2" value={connection} onChange={e=>setConnection(e.target.value)}><option value="All">كل الأجهزة</option><option value="online">متصل</option><option value="offline">غير متصل</option><option value="unknown">غير معروف</option></select></label><p role="status" className="text-xs">{visibleDrivers.length} من {drivers.length}</p><button type="button" className="min-h-11 w-full rounded-lg border" onClick={()=>{setSearch('');setGps('All');setConnection('All');}}>مسح الفلاتر</button></div></details>{error&&<p role="alert" className="text-xs text-amber-900">{error}</p>}</div>
  <div ref={canvas} className="fleet-map-canvas relative min-h-0 flex-1"><Map ref={map} initialViewState={{...mapCenter,zoom:13}} mapStyle={style} RTLTextPlugin="/mapbox-gl-rtl-text-0.2.3.min.js" attributionControl={false} interactiveLayerIds={[taxiLayerId,taxiHitLayerId,taxiClusterLayerId,taxiClusterHitLayerId,taxiSelectedLayerId]} onLoad={e=>{installTaxiImages(e.target);}} onClick={e=>{
   const feature=e.features?.[0];if(!feature)return;if([taxiClusterLayerId,taxiClusterHitLayerId].includes(feature.layer.id)){const source=map.current?.getSource(taxiSourceId) as GeoJSONSource|undefined;void source?.getClusterExpansionZoom(Number(feature.properties?.cluster_id)).then(zoom=>{if(feature.geometry.type==='Point')map.current?.easeTo({center:[feature.geometry.coordinates[0],feature.geometry.coordinates[1]],zoom});}).catch(()=>{});return;}setSelected(String(feature.properties?.driverId));
  }}><MapAttributionPortal target={credit}/><OfficeTaxiLayer drivers={visibleDrivers} selected={selected} now={now} maxAge={120} mapRef={map}/><MapProviderLogo kind={kind} target={brand}/>{driver&&position&&<Popup longitude={position.longitude} latitude={position.latitude} onClose={()=>setSelected(null)} closeOnClick={false}><div dir="rtl"><strong>{driver.fullName}</strong><p>آخر GPS: {Number.isFinite(Date.parse(position.fixTime))?new Date(position.fixTime).toLocaleString('ar'):'غير متاح'}</p><p>الدقة: {position.accuracy==null?'غير متاحة':position.accuracy+'م'}</p><p>آخر سرعة مسجلة: {recordedSpeedLabel(position.speed)}</p><p>الاتصال: {connectionById.get(driver.id)==='online'?'متصل':connectionById.get(driver.id)==='offline'?'غير متصل':'غير معروف'}</p><p>حالة العمل والطلب: غير متاحة من هذا المصدر</p><p>{matchesMapGpsFilter(driver,'Live',now,120)?'GPS حديث':'GPS قديم أو دقته غير مؤكدة'}</p></div></Popup>}</Map><MapResourceNotice loading={styleLoading} error={error} retry={retry}/></div>
  <footer data-map-legal aria-label="حقوق مصادر الخريطة" className="flex shrink-0 items-center gap-2 border-t bg-white p-2" dir="ltr" style={{paddingBottom:'calc(8px + env(safe-area-inset-bottom, 0px))'}}><div ref={brand} className="shrink-0"/><div ref={credit} className="min-w-0 flex-1 [&_.maplibregl-ctrl-attrib]:m-0 [&_.maplibregl-ctrl-attrib]:max-w-full [&_.maplibregl-ctrl-attrib]:bg-transparent [&_.maplibregl-ctrl-attrib-inner]:whitespace-normal [&_.maplibregl-ctrl-attrib-inner]:[overflow-wrap:anywhere]"/></footer>
 </div>;
}
