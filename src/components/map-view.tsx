

'use client';

import { useMemo,useRef,useEffect } from 'react';
import {MapAttributionPortal} from './map-attribution-portal';
import {MapProviderLogo} from './map-layer-switcher';
import {useMapStyle} from '@/hooks/use-map-style';
import 'maplibre-gl/dist/maplibre-gl.css';
import Map, { Marker,type MapRef } from 'react-map-gl/maplibre';
import type { Ride, Driver } from '@/lib/types';
import { CarTaxiFront, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';

type MapViewProps = {
  rides: Ride[];
  drivers: Driver[];
  className?: string;
};

export function MapView({ rides, drivers, className }: MapViewProps) {
  const {style:mapStyle}=useMapStyle('street');
  const map=useRef<MapRef>(null),canvas=useRef<HTMLDivElement>(null),brand=useRef<HTMLDivElement>(null),credit=useRef<HTMLDivElement>(null);
  useEffect(()=>{const el=canvas.current;if(!el||typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(()=>map.current?.resize());observer.observe(el);return()=>observer.disconnect();},[]);
  const mapCenter = useMemo(() => {
    // Default viewport for Nablus; this is never a GPS observation.
    return { longitude:35.2544,latitude:32.2211 };
  }, []);
  // Legacy records have no GPS timestamp. Zero pairs are existing unknown-location placeholders.
  const valid=(point?:{x:number;y:number}|null)=>!!point&&Number.isFinite(point.x)&&Number.isFinite(point.y)&&Math.abs(point.x)<=90&&Math.abs(point.y)<=180&&(point.x!==0||point.y!==0);

  return (
      <div className={cn("relative flex h-full w-full flex-col overflow-hidden rounded-lg bg-secondary", className)}>
        <div ref={canvas} className="relative min-h-0 flex-1"><Map ref={map}
          initialViewState={{
            ...mapCenter,
            zoom: 11,
          }}
          style={{ width: '100%', height: '100%' }}
          mapStyle={mapStyle} RTLTextPlugin="/mapbox-gl-rtl-text-0.2.3.min.js" attributionControl={false}
        >
          <MapAttributionPortal target={credit}/><MapProviderLogo kind="street" target={brand}/>
          {drivers
            .filter(d => (d.status === 'on-shift' || d.status === 'available')&&valid(d.location))
            .map(driver => (
              <Marker key={driver.id} longitude={driver.location.y} latitude={driver.location.x}>
                <CarTaxiFront aria-label={`${driver.name} · موقع محفوظ`}
                  className="rounded-full bg-white p-1 text-slate-600"
                  size={32}
                />
              </Marker>
          ))}
          {rides.filter(ride=>valid(ride.pickup?.coords)).map(ride => (
            <Marker key={ride.id} longitude={ride.pickup.coords.y} latitude={ride.pickup.coords.x}>
                <MapPin
                  className="text-yellow-500"
                  size={32}
                  fill="currentColor"
                />
            </Marker>
          ))}
        </Map></div>
        <footer data-map-legal aria-label="حقوق مصادر الخريطة" className="flex shrink-0 items-center gap-2 border-t bg-white p-2" dir="ltr" style={{paddingBottom:'calc(8px + env(safe-area-inset-bottom, 0px))'}}><div ref={brand} className="shrink-0"/><div ref={credit} className="min-w-0 flex-1 [&_.maplibregl-ctrl-attrib]:m-0 [&_.maplibregl-ctrl-attrib]:max-w-full [&_.maplibregl-ctrl-attrib]:bg-transparent [&_.maplibregl-ctrl-attrib-inner]:whitespace-normal [&_.maplibregl-ctrl-attrib-inner]:[overflow-wrap:anywhere]"/></footer>
        <p role="status" dir="rtl" className="absolute right-3 top-3 z-10 rounded-lg bg-white/95 px-3 py-2 text-xs text-slate-700">مواقع محفوظة · وقت تحديث GPS غير متاح في هذه السجلات</p>
      </div>
  );
}
