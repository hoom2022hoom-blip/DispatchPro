"use client";
import {useRef,useState} from 'react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from './ui/dialog';
import {OfficeOrderDestination} from './office-order-destination';
import type {LocationPoint} from './location-point-picker';
import type {SuggestedPlace,LocationUpdate} from './ride-location-editor';
import type {DriverRide} from '@/lib/driver-api';

export function DriverStartDestination({ride,places,save,onClose}:{ride:DriverRide;places:()=>Promise<SuggestedPlace[]>;save:(input:LocationUpdate)=>Promise<unknown>;onClose:()=>void}){
 const [text,setText]=useState(ride.destination??''),[point,setPoint]=useState<LocationPoint>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const lock=useRef(false),input=useRef<HTMLInputElement>(null);
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent dir="rtl" className="max-h-[90dvh] max-w-lg overflow-y-auto"><DialogTitle>حدد الوجهة قبل بدء الرحلة</DialogTitle><DialogDescription>احفظ الوجهة لهذه الرحلة ثم اضغط بدء الرحلة.</DialogDescription><form noValidate className="space-y-4" onSubmit={async event=>{event.preventDefault();if(lock.current)return;if(!text.trim()){setError('يرجى تحديد الوجهة قبل بدء الرحلة');input.current?.focus();return;}lock.current=true;setBusy(true);setError('');try{await save({version:ride.version,destination:{addressText:text.trim(),...point,locationSource:point?'MAP_PIN':'MANUAL_TEXT'}});onClose();}catch(e){setError((e as Error).message);}finally{lock.current=false;setBusy(false);}}}><fieldset disabled={busy} className="space-y-4"><label htmlFor="start-destination">إلى أين الوجهة؟ *</label><OfficeOrderDestination inputId="start-destination" inputRef={input} value={text} point={point} places={places} invalid={!!error} onChange={(label,next)=>{setText(label);setPoint(next);setError('');}}/>{error&&<p role="alert" className="text-red-700">{error}</p>}<button type="submit" className="min-h-12 w-full rounded-xl bg-yellow-400 p-3 font-bold">{busy?'جارٍ حفظ الوجهة…':'حفظ الوجهة'}</button><button type="button" className="min-h-12 w-full rounded-xl border p-3" onClick={onClose}>إلغاء</button></fieldset></form></DialogContent></Dialog>;
}
