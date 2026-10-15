import {playDriverTone} from './driver-tones.js';
type Offer={id:string;expiresAt?:number|null};
export function createDriverOfferAlert({closeNotification,now=()=>Date.now(),refresh=()=>{},preferences=()=>({sound:true,vibration:true})}:{closeNotification:(id:string)=>Promise<void>;now?:()=>number;refresh?:()=>void;preferences?:()=>{sound:boolean;vibration:boolean;orderTone?:number}}){
 let current:Offer|null=null,context:AudioContext|null=null,timer:ReturnType<typeof setInterval>|null=null;
 const seen=new Set<string>();let sounding=false;
 const tone=()=>{if((globalThis as typeof globalThis&{dispatchProDriverNative?:boolean}).dispatchProDriverNative||!preferences().sound||!sounding||!context||context.state!=='running')return;playDriverTone(context,preferences().orderTone??1);};
 function stop(id?:string){if(id&&current?.id!==id){void closeNotification(id);return;}sounding=false;if(timer)clearInterval(timer);timer=null;try{navigator.vibrate?.(0);}catch{}if(current)void closeNotification(current.id);current=null;}
 function unlock(){try{const Audio=globalThis.AudioContext||(globalThis as typeof globalThis&{webkitAudioContext?:typeof AudioContext}).webkitAudioContext;if(Audio){context??=new Audio();void context.resume();}}catch{}}
 function offer(value:Offer){if(current?.id===value.id)return false;if(seen.has(value.id))return false;seen.add(value.id);stop();current=value;if(value.expiresAt!=null&&value.expiresAt<=now()){stop();refresh();return false;}sounding=true;tone();try{!(globalThis as typeof globalThis&{dispatchProDriverNative?:boolean}).dispatchProDriverNative&&preferences().vibration&&navigator.vibrate?.([250,150,250]);}catch{}timer=setInterval(()=>{if(current?.expiresAt!=null&&current.expiresAt<=now()){stop();refresh();return;}tone();},1500);return true;}
 return {unlock,offer,stop,dispose(){stop();void context?.close();context=null;},get currentId(){return current?.id??null;}};
}
