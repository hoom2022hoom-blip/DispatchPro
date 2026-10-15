"use client";
import {useEffect,useRef,useState,type Ref} from 'react';
import type {SuggestedPlace} from './ride-location-editor';

import '../../public/customer-mobile/place-search.js';
const {matchesSuggestedPlace}=globalThis.ArabicPlaces;
export {matchesSuggestedPlace};
export function SuggestedPlaceSearch({items,target,onSelect,value='',onChange,inputRef,inputId,onBlur,invalid=false,required=false,disabled=false}:{items:SuggestedPlace[];target:'pickup'|'destination';onSelect:(place:SuggestedPlace)=>void;value?:string;onChange:(text:string)=>void;inputRef?:Ref<HTMLInputElement>;inputId?:string;onBlur?:()=>void;invalid?:boolean;required?:boolean;disabled?:boolean}){
 const [open,setOpen]=useState(false);const query=value;
 const root=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!open||typeof document==='undefined')return;const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[open]);
 const label=target==='pickup'?'موقع الانطلاق':'الوجهة';
 const matches=items.filter(p=>p.isActive&&matchesSuggestedPlace(p,query));
 return <div ref={root} className="space-y-1" onKeyDown={e=>{if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();setOpen(false);}}} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOpen(false);}}><input ref={inputRef} id={inputId} disabled={disabled} aria-label={label} aria-required={required} aria-invalid={invalid} aria-expanded={open&&matches.length>0} autoComplete="off" maxLength={500} placeholder={target==='pickup'?'اكتب أو ابحث عن موقع الانطلاق...':'اكتب أو ابحث عن وجهتك...'} className="min-h-12 w-full rounded-xl border bg-white p-3" value={value} onFocus={()=>setOpen(true)} onBlur={()=>onBlur?.()} onChange={e=>{onChange(e.target.value);setOpen(true);}}/>{open&&matches.length>0&&<div className="max-h-48 overflow-y-auto rounded-xl border bg-white">{target==='destination'&&<div className="flex justify-end"><button type="button" aria-label="إغلاق اقتراحات الوجهة" className="h-8 w-8 rounded text-xl hover:bg-slate-100" onMouseDown={e=>e.preventDefault()} onClick={e=>{e.stopPropagation();setOpen(false);}}>×</button></div>}{matches.slice(0,8).map(p=><button type="button" key={p.id} className="block min-h-12 w-full p-3 text-right" onMouseDown={e=>e.preventDefault()} onClick={()=>{onSelect(p);setOpen(false);}}>{p.name}{p.addressText?' · '+p.addressText:''}</button>)}</div>}</div>;
}
