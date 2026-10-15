import {playDriverTone,driverTones} from './driver-tones.js';
export const isQaAudio=()=>globalThis.dispatchProDriverQa===true;
export function qaTone(kind,key){
 if(!isQaAudio())return;
 const native=globalThis.dispatchProCallNative;
 if(native){void native('sound.event',{kind,key}).catch(()=>{});return;}
 if(!globalThis.dispatchProQaBrowserSound||globalThis.dispatchProRideCallActive||driverTones().sound===false)return;
 const context=globalThis.dispatchProQaAudioContext;if(!context)return;
 playDriverTone(context,kind==='accepted'?1:kind==='ptt-end'?2:kind==='error'||kind==='busy'?4:3,.025,.035);
}
export function enableQaBrowserSound(enabled){
 globalThis.dispatchProQaBrowserSound=enabled;
 if(enabled){globalThis.dispatchProQaAudioContext??=new AudioContext();void globalThis.dispatchProQaAudioContext.resume();}
 else void globalThis.dispatchProQaAudioContext?.suspend();
}
export class QaChatAlerts {
 constructor(device){this.key='qa-chat-seen:'+device;try{this.seen=new Set(JSON.parse(localStorage.getItem(this.key)||'[]'));}catch{this.seen=new Set();}}
 consume(data){
  if(!isQaAudio())return;
  for(const message of data.chat||[]){
   if(message.mine||!message.id||this.seen.has(message.id))continue;
   this.seen.add(message.id);while(this.seen.size>512)this.seen.delete(this.seen.values().next().value);
   try{localStorage.setItem(this.key,JSON.stringify([...this.seen]));}catch{}
   if(document.visibilityState==='visible'&&globalThis.dispatchProVisibleChat===message.rideId)continue;
   // Browser-only; native Android uses the durable notification dedupe instead.
   if(globalThis.dispatchProDriverNative||globalThis.dispatchProCustomerNative)continue;
   if(!globalThis.dispatchProRideCallActive&&!globalThis.dispatchProQaVoiceActive&&globalThis.dispatchProQaBrowserSound&&driverTones().sound!==false){const c=globalThis.dispatchProQaAudioContext;if(c)playDriverTone(c,2,.025,.06);}
   if(typeof Notification!=='undefined'&&Notification.permission==='granted'){try{new Notification(message.senderName||'رسالة جديدة',{body:document.visibilityState==='visible'?message.text:'رسالة داخلية جديدة',tag:'qa-chat:'+message.rideId,silent:true});}catch{}}
  }
 }
}
