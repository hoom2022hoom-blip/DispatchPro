"use client";
import {useEffect,useRef,useState} from 'react';
import {Phone} from 'lucide-react';
import {RideCommunication} from '../../public/customer-mobile/communication.js';
type Request=<T>(path:string,method?:string,body?:unknown,signal?:AbortSignal)=>Promise<T>;
export function RideCommunicationControl({request,rides}:{request:Request;rides:{id:string;status:string}[]}){
 const client=useRef<RideCommunication|null>(null),[note,setNote]=useState('');
 const currentRides=useRef(rides);currentRides.current=rides;
 useEffect(()=>{if(!request||typeof RTCPeerConnection==='undefined')return;const native=(globalThis as typeof globalThis&{dispatchProCallNative?:(type:string,data?:unknown)=>Promise<any>}).dispatchProCallNative;
 if(window.isSecureContext===false&&!native){setNote('المكالمات الصوتية تحتاج HTTPS. معاينة HTTP مخصصة للواجهة فقط.');return;}
 const value=new RideCommunication(request,{native});client.current=value;const connected=value.connect();const start=(event:Event)=>{const id=(event as CustomEvent).detail?.rideId;if(currentRides.current.some(r=>r.id===id&&["Accepted","DriverArriving","Arrived","InProgress"].includes(r.status)))void connected.then(()=>value.start(id)).catch(()=>setNote("تعذر بدء المكالمة"));};window.addEventListener("dispatchpro-call-start",start);const open=(e:Event)=>{const detail=(e as CustomEvent).detail;value.open(detail.callId,detail.action);};const status=(e:Event)=>setNote((e as CustomEvent).detail);window.addEventListener('dispatchpro-call-open',open);window.addEventListener('dispatchpro-call-note',status);const pending=(globalThis as typeof globalThis&{dispatchProCommunicationOpen?:{callId:string;action:string}}).dispatchProCommunicationOpen;if(pending){value.open(pending.callId,pending.action);delete (globalThis as any).dispatchProCommunicationOpen;}return()=>{window.removeEventListener('dispatchpro-call-open',open);window.removeEventListener('dispatchpro-call-note',status);window.removeEventListener("dispatchpro-call-start",start);value.dispose();client.current=null;};},[request]);
 return note?<p dir="rtl" role="status" className="text-sm">{note}</p>:null;
}
export function RideCallButton({rideId,disabled=false,label='اتصال بالزبون'}:{rideId:string;disabled?:boolean;label?:string}){return <button type="button" className="trip-call inline-flex min-h-12 items-center gap-2 rounded-xl border px-3 text-sm font-bold" disabled={disabled} onClick={()=>window.dispatchEvent(new CustomEvent("dispatchpro-call-start",{detail:{rideId}}))}><Phone size={18} aria-hidden="true"/>{label}</button>;}
