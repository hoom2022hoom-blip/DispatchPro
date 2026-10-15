"use client";
import {useEffect,useId,useRef,useState} from 'react';
import type {Ride} from '@/lib/types';
import {receptionError} from '@/lib/reception-feedback';

export function InlineOfficeFare({ride,onSave,disabled=false}:{ride:Ride;onSave?:(ride:Ride,amount:number)=>Promise<void>;disabled?:boolean}){
 const amount=ride.finalFare??ride.totalFare;
 const errorId=useId();
 const saved=amount==null?'':Number(amount).toFixed(2);
 const [value,setValue]=useState(saved),[error,setError]=useState(''),[saving,setSaving]=useState(false);
 const lock=useRef(false),dirty=useRef(false),committed=useRef(saved);
 useEffect(()=>{committed.current=saved;if(!dirty.current)setValue(saved);},[saved]);
 async function save(){
  if(lock.current||!onSave||disabled)return;
  const text=value.trim();
  if(!text){if(committed.current)setError('أدخل السعر لتعديله؛ لا يمكن مسح سعر محفوظ من هذا الحقل');return;}
  if(!/^\d+(\.\d{1,2})?$/.test(text)||Number(text)>10000000){setError('أدخل مبلغًا صالحًا بحد أقصى منزلتين عشريتين');return;}
  const normalized=Number(text).toFixed(2);if(normalized===committed.current){dirty.current=false;setValue(normalized);setError('');return;}
  lock.current=true;setSaving(true);setError('');
  try{await onSave(ride,Number(text));committed.current=normalized;dirty.current=false;setValue(normalized);}
  catch(e){setError(receptionError(e));}
  finally{lock.current=false;setSaving(false);}
 }
 return <div><div className="flex items-center gap-1" dir="ltr"><input aria-label={`السعر للطلب ${ride.orderNumber??ride.id}`} aria-invalid={!!error} aria-describedby={error?errorId:undefined} title="Enter لحفظ السعر، Escape للتراجع" className="h-8 w-20 min-w-0 rounded border px-1 text-center tabular-nums focus-visible:outline-blue-600" inputMode="decimal" placeholder="—" value={value} disabled={disabled||!onSave||saving} onChange={e=>{dirty.current=true;setValue(e.target.value);setError('');}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();if(!e.repeat&&!e.nativeEvent.isComposing)void save();}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();dirty.current=false;setValue(committed.current);setError('');}}}/><span>{ride.currency&&ride.currency!=='ILS'?ride.currency:'₪'}</span></div>{saving&&<small role="status">جارٍ الحفظ…</small>}{error&&<small id={errorId} role="alert" className="block text-red-700">{error}</small>}</div>;
}
