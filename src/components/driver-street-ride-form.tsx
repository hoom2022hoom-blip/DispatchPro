"use client";
import {useEffect,useRef,useState} from 'react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from './ui/dialog';
import {LocationPointPicker,type LocationPoint} from './location-point-picker';
import type {SuggestedPlace} from './ride-location-editor';
import type {StreetRideInput} from '@/lib/driver-api';
import {streetRideLabel} from '@/lib/ride-source';
import {SuggestedPlaceSearch} from './suggested-place-search';
import {v4 as uuidv4} from 'uuid';

export function DriverStreetRideForm({initialPickup,places,sendLocation,save,onClose}:{initialPickup?:LocationPoint;places:()=>Promise<SuggestedPlace[]>;sendLocation:(value:{latitude:number;longitude:number;accuracy:number;capturedAt:string})=>Promise<unknown>;save:(value:StreetRideInput)=>Promise<unknown>;onClose:()=>void}){
 const [id]=useState(()=>uuidv4());
 const gpsGeneration=useRef(0);
 const [pickupLabel,setPickupLabel]=useState(''),[pickupPlaceId,setPickupPlaceId]=useState<string>();
 const destinationRef=useRef<HTMLInputElement>(null);
 const [destinationError,setDestinationError]=useState('');
 const [pickup,setPickup]=useState(initialPickup),[pickupEdited,setPickupEdited]=useState(false),[destination,setDestination]=useState(''),[destinationPoint,setDestinationPoint]=useState<LocationPoint>(),[placeId,setPlaceId]=useState<string>(),[notes,setNotes]=useState(''),[fareMode,setFareMode]=useState<'DRIVER_MANUAL'|'GPS_METER'>('DRIVER_MANUAL');
 const [items,setItems]=useState<SuggestedPlace[]>([]),[map,setMap]=useState<'pickup'|'destination'|null>(null),[error,setError]=useState(''),[placesError,setPlacesError]=useState(''),[busy,setBusy]=useState(false),[gpsBusy,setGpsBusy]=useState(false);const lock=useRef(false),live=useRef(true);
 const field='block min-h-12 w-full rounded-xl border bg-white p-3';
 const gps=()=>{
  if(!navigator.geolocation){setError('GPS غير متاح؛ حدد نقطة الانطلاق على الخريطة.');return;}
  const generation=++gpsGeneration.current;setGpsBusy(true);setError('');
  navigator.geolocation.getCurrentPosition(async position=>{
   try{
    if(generation!==gpsGeneration.current)return;
    const {latitude,longitude,accuracy}=position.coords;
    if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||accuracy>200||accuracy<0||Date.now()-position.timestamp>60000||position.timestamp>Date.now()+10000)throw Error('يلزم موقع GPS حديث بدقة أفضل من 200م.');
    const result=await sendLocation({latitude,longitude,accuracy,capturedAt:new Date(position.timestamp).toISOString()});
    if(result&&typeof result==='object'&&'stored' in result&&result.stored===false)throw Error('لم يُحفظ GPS؛ أعد المحاولة أو حدد الانطلاق على الخريطة.');
    if(live.current&&generation===gpsGeneration.current){setPickup({latitude,longitude});setPickupEdited(false);setPickupPlaceId(undefined);setPickupLabel('موقع الانطلاق GPS');}
   }catch(e){if(live.current&&generation===gpsGeneration.current)setError((e as Error).message);}finally{if(live.current&&generation===gpsGeneration.current)setGpsBusy(false);}
  },()=>{if(live.current&&generation===gpsGeneration.current){setError('تعذر تحديد GPS؛ اسمح بالموقع الدقيق أو حدد الانطلاق على الخريطة.');setGpsBusy(false);}},{enableHighAccuracy:true,maximumAge:0,timeout:20000});
 };
 useEffect(()=>{live.current=true;void places().then(rows=>{if(live.current)setItems(rows.filter(p=>p.isActive));}).catch(()=>{if(live.current)setPlacesError('تعذر تحميل المواقع المقترحة؛ يمكن كتابة الوجهة أو تحديدها على الخريطة.');});return()=>{live.current=false;};},[]);
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent dir="rtl" className="max-h-[90dvh] max-w-lg overflow-y-auto"><DialogTitle>{streetRideLabel}</DialogTitle><DialogDescription>تسجيل رحلة مباشرة</DialogDescription><form noValidate className="space-y-4" onSubmit={async event=>{
  event.preventDefault();if(lock.current)return;
  if(!destination.trim()){setDestinationError('يرجى تحديد وجهة الرحلة');destinationRef.current?.focus();return;}
  if(!pickup){setError('يرجى تحديد موقع الانطلاق');return;}
  lock.current=true;setBusy(true);setError('');
  try{await save({id,destination:{addressText:destination.trim(),...destinationPoint,locationSource:destinationPoint?'MAP_PIN':'MANUAL_TEXT'},...(pickupEdited?{pickup:{addressText:pickupLabel||'نقطة الانطلاق على الخريطة',...pickup,locationSource:'MAP_PIN'}}:{}),...(placeId?{destinationPlaceId:placeId}:{}),...(pickupPlaceId?{pickupPlaceId}:{}),notes:notes.trim(),fareMode});onClose();}catch(e){if(live.current)setError((e as Error).message);}finally{lock.current=false;if(live.current)setBusy(false);}
 }}><fieldset disabled={busy} className="space-y-4"><div><p className="font-bold">موقع الانطلاق *</p><p>{pickupLabel}</p><p dir="ltr">{pickup?`${pickup.latitude.toFixed(6)}, ${pickup.longitude.toFixed(6)}`:'بانتظار GPS أو اختيار نقطة'}</p><p className="text-sm">{pickupEdited?'نقطة اخترتها على الخريطة':'آخر موقع GPS صالح؛ يتحقق المكتب من حداثته عند البدء'}</p></div><SuggestedPlaceSearch items={items} target="pickup" value={pickupLabel} onChange={text=>{gpsGeneration.current++;setGpsBusy(false);setPickupLabel(text);setPickup(undefined);setPickupPlaceId(undefined);setPickupEdited(true);setError('');}} onSelect={place=>{gpsGeneration.current++;setGpsBusy(false);setError('');setPickup({latitude:place.latitude,longitude:place.longitude});setPickupLabel(place.name+(place.addressText?' · '+place.addressText:''));setPickupPlaceId(place.id);setPickupEdited(true);setMap(null);}}/><button type="button" className={field} disabled={gpsBusy} onClick={gps}>{gpsBusy?'جارٍ تحديد GPS…':'استخدام GPS الحالي'}</button><button type="button" className={field} onClick={()=>setMap(map==='pickup'?null:'pickup')}>تعديل الانطلاق على الخريطة</button><label className="block">إلى أين الوجهة؟ *</label><SuggestedPlaceSearch items={items} target="destination" value={destination} inputRef={destinationRef} required invalid={!!destinationError} onChange={text=>{setError('');setDestinationError('');setDestination(text);setDestinationPoint(undefined);setPlaceId(undefined);}} onSelect={place=>{setDestinationError('');setPlaceId(place.id);setDestination(place.name+(place.addressText?' · '+place.addressText:''));setDestinationPoint({latitude:place.latitude,longitude:place.longitude});setMap(null);}}/>{destinationError&&<p role="alert" className="text-red-700">{destinationError}</p>}{placesError&&<p role="status">{placesError}</p>}<button type="button" className={field} onClick={()=>setMap(map==='destination'?null:'destination')}>تحديد الوجهة على الخريطة</button>{map&&<LocationPointPicker key={map} point={map==='pickup'?pickup:destinationPoint} onChange={point=>{if(map==='pickup'){gpsGeneration.current++;setGpsBusy(false);setError('');setPickup(point);setPickupEdited(true);setPickupPlaceId(undefined);setPickupLabel('نقطة الانطلاق على الخريطة');}else{setDestinationError('');setDestinationPoint(point);setPlaceId(undefined);if(!destination.trim())setDestination('الوجهة على الخريطة');}}}/>}<label className="block">ملاحظات (اختياري)<textarea className={field} maxLength={4000} value={notes} onChange={event=>setNotes(event.target.value)}/></label><label className="block">طريقة السعر<select className={field} value={fareMode} onChange={event=>setFareMode(event.target.value as typeof fareMode)}><option value="DRIVER_MANUAL">إدخال المبلغ عند إنهاء الرحلة</option><option value="GPS_METER">عداد GPS</option></select></label>{error&&<p role="alert" className="text-red-700">{error}</p>}<button className={`${field} bg-yellow-400 font-bold text-black`} disabled={busy}>{busy?'جارٍ بدء الرحلة…':'بدء الرحلة'}</button><button type="button" className={field} onClick={onClose}>إلغاء</button></fieldset></form></DialogContent></Dialog>;
}
