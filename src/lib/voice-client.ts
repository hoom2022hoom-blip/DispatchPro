import {driverTones,playDriverTone} from './driver-tones.js';
import {isQaAudio,qaTone} from './qa-audio.js';
import {browserPressCapture,prepareVoiceBuffer,type PressCapture,type CaptureFactory} from './voice-preroll.js';
const EMPTY_FLOOR='00000000-0000-0000-0000-000000000000';
// Speech-only Opus negotiation; bitrate also remains capped on the RTP sender.
export function voiceDescription(value:RTCSessionDescriptionInit):RTCSessionDescriptionInit {
 let sdp=value.sdp;if(!sdp)return value;
 const payloads=[...sdp.matchAll(/^a=rtpmap:(\d+) opus\/48000(?:\/2)?\r?$/gmi)].map(m=>m[1]);
 for(const payload of payloads){
  const line=new RegExp(`^a=fmtp:${payload} ([^\\r\\n]*)`,'m');
  const current:string=sdp.match(line)?.[1]??'';
  const parameters:string[]=current.split(';').map(x=>x.trim()).filter(x=>x&&!/^(useinbandfec|usedtx|stereo|sprop-stereo|maxaveragebitrate)=/.test(x));
  parameters.push('useinbandfec=1','usedtx=1','stereo=0','sprop-stereo=0','maxaveragebitrate=24000');
  const replacement:string=`a=fmtp:${payload} ${parameters.join(';')}`;
  sdp=line.test(sdp)?sdp.replace(line,replacement):sdp.replace(new RegExp(`(^a=rtpmap:${payload} [^\\r\\n]*)`,'m'),`$1\r\n${replacement}`);
 }
 sdp=sdp.replace(/^a=ptime:\d+\r?\n/gm,'').replace(/^(m=audio [^\r\n]*)/m,'$1\r\na=ptime:20');
 return {...value,sdp};
}
export type VoiceAccess={voiceEnabled:boolean;canListen:boolean;canTalkPublic:boolean;canTalkPrivate:boolean;isVoiceBlocked:boolean};
export const defaultVoiceAccess:VoiceAccess={voiceEnabled:true,canListen:true,canTalkPublic:true,canTalkPrivate:true,isVoiceBlocked:false};
export type VoicePeer={id:string;actorId:string;driverId:string|null;name:string;plate:string|null;office:boolean;multiplexed?:boolean};
export type VoiceFloor={id:string;speaker:string;driverId:string|null;name:string;plate:string|null;channel:string;startedAt:string;expiresAt:string;revision:number;audioStarted?:boolean;attemptId?:string};
export type VoiceSignal={from:string;floorId:string;kind:'offer'|'answer'|'ice';data:string;channel?:'public'|'private';warmSender?:string};
export type VoiceSpeaker={driverId:string;name:string;plate:string|null;startedAt:string;floorId:string};
export type VoiceState={revision:number;self:VoicePeer;peers:VoicePeer[];floors:VoiceFloor[];signals:VoiceSignal[];access:VoiceAccess;publicMuted:boolean;serverTime:string;lastPublicSpeaker?:VoiceSpeaker|null;lastPrivateSpeaker?:VoiceSpeaker|null;lastDriverSpeaker?:VoiceSpeaker|null};
export type VoiceRequest=<T>(path:string,method?:string,body?:unknown,signal?:AbortSignal)=>Promise<T>;
export type VoiceStatus={connected:boolean;message:string;talking:VoiceFloor|null;state:VoiceState|null;needsPlayback:boolean;microphoneReady?:boolean;pending?:boolean};
type Connection={key:string;outgoing:boolean;active:boolean;sender:RTCRtpSender|null;pc:RTCPeerConnection;floorId:string;peerId:string;audio:HTMLAudioElement|null;pending:RTCIceCandidateInit[];mediaTask:Promise<void>;mediaReady?:boolean;warming?:Promise<void>;remoteFloorBinding?:boolean;remoteReadyAck?:boolean;controlChannel?:RTCDataChannel;ackFloor?:string;acknowledgedFloor?:string;observedFloor?:string;inspectedPath?:boolean;receivePoll?:ReturnType<typeof setTimeout>;recovery?:ReturnType<typeof setTimeout>};

// All identity, recipient and floor decisions are checked again by the server.
// Receivers attach media only while the corresponding authorized floor exists.
export class VoiceClient {
 private preparationRequired=false;
 private transportWarmEnabled=false;
 private multiplexedTransport=false;
 private prepared=false;
 private automaticCapture=false;
 private audioAvailable=true;
 setAudioAvailable(active:boolean){
  if(this.audioAvailable===active)return;this.audioAvailable=active;
  if(!active){this.releaseMicrophone();for(const c of this.connections.values())if(!c.outgoing)this.idle(c);}
  else if(this.state)void this.apply(this.state);
 }
 private heldSource:string|null=null;
 automaticMicrophone(){this.automaticCapture=true;this.preparationRequired=false;}
 private captureFactory:CaptureFactory|null=null;
 private pressCapture:PressCapture|null=null;
 private captureAbort:AbortController|null=null;
 private drainTask:Promise<void>|null=null;
 private queuedPress=0;
 private queuedSource:string|null=null;
 setCaptureFactory(factory:CaptureFactory){this.captureFactory=factory;}
 private mediaGeneration=0;
 private pressedAt=0;
 private attemptId:string|null=null;
 private cancellableFloor=false;
 private acquisition:AbortController|null=null;
 private transmitting=false;
 private metrics:Record<string,number>={};
 private trace:Record<string,unknown>[]=[];
 diagnostics(){return {sessionId:this.peer?.id,connected:this.status.connected,pending:this.status.pending??false,microphoneReady:this.prepared,metrics:{...this.metrics},trace:[...this.trace],transports:[...this.connections.values()].map(c=>({outgoing:c.outgoing,active:c.active,connection:c.pc.connectionState,ice:c.pc.iceConnectionState,signaling:c.pc.signalingState,floorId:c.floorId}))};}
 officeTransportReady(){
  const a=this.state?.access;
  if(!this.status.connected||!a?.voiceEnabled||a.isVoiceBlocked)return false;
  const talk=a.canTalkPrivate||a.canTalkPublic&&!this.state?.publicMuted;
  if(!a.canListen&&!talk)return false;
  return this.state!.peers.some(p=>p.office&&p.id!==this.peer?.id&&(!a.canListen||[...this.connections.values()].some(c=>c.peerId===p.id&&!c.outgoing&&c.pc.connectionState==='connected'))&&(!talk||[...this.connections.values()].some(c=>c.peerId===p.id&&c.outgoing&&c.pc.connectionState==='connected')));
 }
 private sampledAt=0;
 private sampling=false;
 private async sampleTransport(){
  if(this.sampling||performance.now()-this.sampledAt<5000)return;this.sampling=true;this.sampledAt=performance.now();
  try{let lost=0,received=0,sent=0,jitter=0,rtt=0,connected=0;
   for(const c of this.connections.values()){
    if(c.pc.connectionState==='connected')connected++;
    const stats=await c.pc.getStats();
    for(const stat of stats.values()){
     if(stat.type==='inbound-rtp'&&stat.kind==='audio'){lost+=Math.max(0,stat.packetsLost??0);received+=stat.packetsReceived??0;jitter=Math.max(jitter,(stat.jitter??0)*1000);}
     if(stat.type==='outbound-rtp'&&stat.kind==='audio')sent+=stat.packetsSent??0;
     if(stat.type==='candidate-pair'&&stat.state==='succeeded'&&stat.nominated){rtt=Math.max(rtt,(stat.currentRoundTripTime??0)*1000);
      if(!c.inspectedPath){const local=stats.get(stat.localCandidateId),remote=stats.get(stat.remoteCandidateId);if(local&&remote){c.inspectedPath=true;this.record('voiceSelectedUdp',local.protocol==='udp'?1:0);this.record('voiceSelectedRelay',local.candidateType==='relay'||remote.candidateType==='relay'?1:0);}}
     }
     if(stat.type==='codec'&&stat.mimeType?.toLowerCase()==='audio/opus'&&!c.inspectedPath)this.record('voiceOpusClockRateHz',stat.clockRate);
     if(stat.type==='media-playout'&&stat.kind==='audio'&&c.active&&stat.totalSamplesCount>0&&stat.totalPlayoutDelay!==undefined)this.record('voiceEstimatedDevicePlayoutMs',1000*stat.totalPlayoutDelay/stat.totalSamplesCount);
    }
   }
   for(const [name,ms] of Object.entries({voicePacketsLost:lost,voicePacketsReceived:received,voicePacketsSent:sent,voiceJitterMs:jitter,voiceRoundTripMs:rtt,voiceConnectedTransports:connected})){
    this.metrics[name]=Math.round(ms);if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('dispatchpro-voice-metric',{detail:{name,ms:Math.round(ms)}}));
   }
  }catch{}finally{this.sampling=false;}
 }
 private async observeSender(c:Connection,f:VoiceFloor,started:number){
  if(typeof c.pc.getStats!=='function')return;let baseline:number|undefined;
  const poll=async()=>{if(!this.transmitting||this.floor?.id!==f.id||!c.active)return;
   try{for(const s of(await c.pc.getStats()).values())if(s.type==='outbound-rtp'&&s.kind==='audio'){
    const sent=s.packetsSent??0;if(baseline===undefined)baseline=sent;
    else if(sent>baseline){this.record('voiceEnableToFirstSentRtpMs',performance.now()-started,{sessionId:this.peer?.id,attemptId:f.attemptId,floorId:f.id});return;}
   }}catch{return;}if(performance.now()-started<1500)setTimeout(()=>void poll(),20);
  };void poll();
 }
 requirePreparation(){this.preparationRequired=true;}
 private record(name:string,value:number,trace:{sessionId?:string;attemptId?:string|null;floorId?:string}={sessionId:this.peer?.id,attemptId:this.attemptId,floorId:this.floor?.id}){this.metrics[name]=Math.round(value);const detail={name,ms:Math.round(value),atMs:Math.round(performance.now()),...trace};this.trace.push(detail);if(this.trace.length>160)this.trace.shift();if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('dispatchpro-voice-metric',{detail}));}
 private measure(name:string,started:number){this.record(name,Math.max(0,performance.now()-started));}
 private preparedState(active:boolean){this.prepared=active;this.emit({microphoneReady:active});if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('dispatchpro-voice-prepared',{detail:{active}}));}
 private callSuspended=false;
 suspendForCall(){this.callSuspended=true;this.releaseMicrophone();this.clearConnections();this.emit({message:'المخشيرة متوقفة أثناء مكالمة الرحلة'});}
 resumeAfterCall(){this.callSuspended=false;this.networkChanged();}

 private controller:AbortController|null=null;
 private networkController:AbortController|null=null;
 private wake:(()=>void)|null=null;
 private retryNow=false;
 // Refresh signaling without tearing down healthy RTP transports or identity.
 networkChanged(){this.retryNow=true;this.stop();this.networkController?.abort();this.wake?.();}
 private peer:VoicePeer|null=null;
 private state:VoiceState|null=null;
 private stream:MediaStream|null=null;
 private streamForSending:MediaStream|null=null;
 private microphonePending:Promise<MediaStream>|null=null;
 private microphonePendingGeneration=0;
 private async microphone():Promise<MediaStream>{
  if(this.callSuspended||(globalThis as any).dispatchProRideCallActive)throw new Error('الميكروفون مستخدم للمكالمة');
  if(this.stream?.getAudioTracks().some(t=>t.readyState!=='ended'))return this.stream;
  if(this.microphonePending&&this.microphonePendingGeneration!==this.mediaGeneration){await this.microphonePending.catch(()=>{});return this.microphone();}
  this.microphonePendingGeneration=this.mediaGeneration;
  if(!this.microphonePending){const mediaGeneration=this.mediaGeneration;this.microphonePending=navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1},video:false}).then(stream=>{stream.getAudioTracks().forEach(t=>t.enabled=false);if(mediaGeneration!==this.mediaGeneration||this.callSuspended||!this.controller){stream.getTracks().forEach(t=>t.stop());throw new Error('Microphone preparation cancelled');}this.stream=stream;return stream;}).finally(()=>{this.microphonePending=null;});}
  return this.microphonePending;
 }
 async prepareMicrophone(){const generation=this.mediaGeneration;this.unlock();try{await this.microphone();if(generation!==this.mediaGeneration)return;this.preparedState(true);this.emit({message:'الميكروفون جاهز · اضغط مطولًا للتحدث'});this.warmConnections();}catch{this.emit({microphoneReady:false,message:'اسمح باستخدام الميكروفون من تفعيل الصوت ثم أعد المحاولة'});}}
 private idle(c:Connection){
  if(c.receivePoll)clearTimeout(c.receivePoll);if(!c.active)return;c.active=false;c.mediaReady=false;
  // Serialize detach/attach: a late detach must never mute the next private press.
  if(c.outgoing&&c.sender)c.mediaTask=c.mediaTask.then(()=>c.sender!.replaceTrack(null)).catch(()=>this.close(c));
  if(c.audio){c.audio.muted=true;c.audio.pause();}this.audioState();
 }
 private chime:AudioContext|null=null;
 private chimeIdle:ReturnType<typeof setTimeout>|null=null;
 private idleChime(){if(this.chimeIdle)clearTimeout(this.chimeIdle);this.chimeIdle=setTimeout(()=>{this.chimeIdle=null;try{void this.chime?.suspend?.().catch(()=>{});}catch{}},600);}
 private heard=new Set<string>();
 private audioActive=false;
 private captureRequested=false;
 private microphoneStarting=false;
 private audioState(){const receiving=[...this.connections.values()].some(c=>c.active&&!!c.audio),active=this.captureRequested||!!this.floor||receiving;if(active===this.audioActive)return;this.audioActive=active;if(isQaAudio())(globalThis as any).dispatchProQaVoiceActive=active;const reason=this.captureRequested?'capture':this.floor?'floor':receiving?'receive':'idle';if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('dispatchpro-voice-audio',{detail:{active,reason}}));}
 private connections=new Map<string,Connection>();
 private ice:RTCIceServer[]=[];
 private floor:VoiceFloor|null=null;
 private held=false;
 isHolding(){return this.held;}
 private generation=0;
 private floorTask:Promise<unknown>=Promise.resolve();
 private control<T>(action:()=>Promise<T>):Promise<T>{const next=this.floorTask.catch(()=>{}).then(action);this.floorTask=next.catch(()=>{});return next;}
 private heartbeat:ReturnType<typeof setInterval>|null=null;
 private watchdog:ReturnType<typeof setInterval>|null=null;
 private renewedAt=0;
 private offset=0;
 private status:VoiceStatus={connected:false,message:'المخشيرة غير متصلة',talking:null,state:null,needsPlayback:false};
 private request:VoiceRequest;
 private update:(s:VoiceStatus)=>void;
 private speakerNotice='';
 private speakerState(){
  const s=this.status,now=Date.now()+this.offset;
  const floor=s.connected&&s.state?.access.voiceEnabled&&s.state.access.canListen?s.state.floors.filter(f=>Date.parse(f.expiresAt)>now).sort((a,b)=>Number(b.channel!=='public')-Number(a.channel!=='public'))[0]:undefined;
  const detail={name:floor?.name??'',channel:floor?(floor.channel==='public'?'public':'private'):'',connected:s.connected,expiresInMs:floor?Math.max(0,Date.parse(floor.expiresAt)-now):0};
  const key=JSON.stringify({...detail,expiresInMs:floor?.expiresAt??''});
  if(key!==this.speakerNotice){this.speakerNotice=key;if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('dispatchpro-voice-speaker',{detail}));}
 }
 constructor(request:VoiceRequest,update:(s:VoiceStatus)=>void){this.request=request;this.update=update;}
 private emit(partial:Partial<VoiceStatus>){this.status={...this.status,...partial};this.update(this.status);this.speakerState();}
 private close(c:Connection){if(c.receivePoll)clearTimeout(c.receivePoll);if(c.recovery)clearTimeout(c.recovery);c.pc.onconnectionstatechange=null;c.pc.onicecandidate=null;c.pc.ontrack=null;c.pc.close();if(c.audio){c.audio.pause();c.audio.srcObject=null;}if(this.connections.get(c.key)===c)this.connections.delete(c.key);this.audioState();}
 private clearConnections(){for(const c of this.connections.values())this.close(c);}
 private signal(to:string,floorId:string,kind:string,data:unknown,channel='public',warmSender=this.peer?.id){const d=data as RTCSessionDescriptionInit;const wire=kind==='ice'?data:{type:d.type,sdp:d.sdp,floorBinding:true,readyAck:true};return this.request('voice/signal','POST',{sessionId:this.peer?.id,to,floorId,kind,data:JSON.stringify(wire),channel,warmSender},this.controller?.signal);}
 private acknowledge(c:Connection,f:VoiceFloor){
  if(!c.outgoing&&c.active&&this.playable(f)&&c.floorId===f.id&&c.acknowledgedFloor!==f.id&&c.controlChannel?.readyState==='open')
   try{c.controlChannel.send(JSON.stringify({floorId:f.id}));c.acknowledgedFloor=f.id;}catch{}
 }
 private observeReceiver(c:Connection,f:VoiceFloor){
  if(c.observedFloor===f.id||typeof c.pc.getStats!=='function')return;c.observedFloor=f.id;
  const started=performance.now();let baseline:{packets:number;energy:number;jitterDelay?:number;jitterCount?:number;jitterMinimum?:number;jitterTarget?:number}|null=null,received=false;
  const poll=async()=>{
   if(!c.active||c.floorId!==f.id||!this.playable(f))return;
   try{for(const s of (await c.pc.getStats()).values())if(s.type==='inbound-rtp'&&s.kind==='audio'){
    const packets=s.packetsReceived??0,energy=s.totalAudioEnergy??0;
    if(!baseline){baseline={packets,energy,jitterDelay:s.jitterBufferDelay,jitterCount:s.jitterBufferEmittedCount,jitterMinimum:s.jitterBufferMinimumDelay,jitterTarget:s.jitterBufferTargetDelay};continue;}
    const trace={sessionId:this.peer?.id,attemptId:f.attemptId,floorId:f.id};
    if(!received&&packets>baseline.packets){received=true;this.record('voiceFloorToFirstRtpMs',performance.now()-started,trace);}
    if(energy>baseline.energy){this.record('voiceFloorToDecodedAudioMs',performance.now()-started,trace);
     const count=s.jitterBufferEmittedCount-(baseline.jitterCount??0);if(count>0&&s.jitterBufferDelay!==undefined&&baseline.jitterDelay!==undefined)this.record('voiceReceiverJitterBufferMs',1000*(s.jitterBufferDelay-baseline.jitterDelay)/count,trace);
     if(count>0&&s.jitterBufferMinimumDelay!==undefined&&baseline.jitterMinimum!==undefined)this.record('voiceReceiverJitterMinimumMs',1000*(s.jitterBufferMinimumDelay-baseline.jitterMinimum)/count,trace);
     if(count>0&&s.jitterBufferTargetDelay!==undefined&&baseline.jitterTarget!==undefined)this.record('voiceReceiverJitterTargetMs',1000*(s.jitterBufferTargetDelay-baseline.jitterTarget)/count,trace);
     return;}
   }}catch{return;}
   if(performance.now()-started<5000)c.receivePoll=setTimeout(()=>void poll(),60);
  };void poll();
 }
 private floorChannel(c:Connection,channel:RTCDataChannel){
  if(channel.label!=='floor-ready'){channel.close();return;}c.controlChannel=channel;
  // A receiver may see the published floor before our grant HTTP response.
  // Cache its acknowledgement; start() still requires the exact granted ID.
  channel.onmessage=e=>{if(!c.outgoing||typeof e.data!=='string'||e.data.length>100)return;try{const id=JSON.parse(e.data).floorId;if(typeof id==='string'&&id.length<=64)c.ackFloor=id;}catch{}};
  channel.onopen=()=>{const f=this.state?.floors.find(f=>f.id===c.floorId);if(f&&c.audio)this.acknowledge(c,f);};
 }
 private allowed(f:VoiceFloor){const current=this.state?.floors.find(x=>x.id===f.id);return !!current&&!!this.state?.access.voiceEnabled&&!!this.state.access.canListen&&(f.channel==='public'||this.peer?.office||f.driverId===this.peer?.driverId)&&Date.parse(current.expiresAt)>Date.now()+this.offset;}
 private playable(f:VoiceFloor){return this.audioAvailable&&this.allowed(f)&&(f.channel!=='public'||!this.state?.floors.some(x=>x.channel!=='public'&&(this.peer?.office||x.driverId===this.peer?.driverId)));}
 private transportKey(peerId:string,f:VoiceFloor,outgoing:boolean){return (outgoing?'out:':'in:')+(this.multiplexedTransport&&this.state?.peers.find(p=>p.id===peerId)?.multiplexed?'shared':f.channel)+':'+peerId;}
 private connection(peerId:string,f:VoiceFloor,outgoing:boolean,warm=false){
  const key=this.transportKey(peerId,f,outgoing),existing=this.connections.get(key);if(existing){existing.floorId=f.id;existing.active=true;return existing;}
  const pc=new RTCPeerConnection({iceServers:this.ice}),c:Connection={key,outgoing,active:!warm,sender:null,pc,floorId:f.id,peerId,audio:null,pending:[],mediaTask:Promise.resolve()};this.connections.set(key,c);
  if(outgoing&&typeof pc.createDataChannel==='function')this.floorChannel(c,pc.createDataChannel('floor-ready'));
  pc.ondatachannel=e=>this.floorChannel(c,e.channel);
  pc.onicecandidate=e=>{if(e.candidate&&(c.active||c.floorId===EMPTY_FLOOR))void this.signal(peerId,c.floorId,'ice',e.candidate.toJSON(),f.channel==='public'?'public':'private',c.outgoing?this.peer?.id:peerId).catch(()=>this.close(c));};
  let restarting=false;
  const restart=async()=>{
   if(restarting||!outgoing||c.active&&(this.floor?.id!==c.floorId||!this.held)||!c.active&&!this.transportWarmEnabled)return;
   restarting=true;const floorId=c.active?c.floorId:EMPTY_FLOOR;if(!c.active)c.floorId=EMPTY_FLOOR;
   try{await pc.setLocalDescription(voiceDescription(await pc.createOffer({iceRestart:true})));if(c.floorId===floorId&&this.connections.get(key)===c)await this.signal(peerId,floorId,'offer',pc.localDescription,f.channel==='public'?'public':'private');}
   catch{this.close(c);}finally{restarting=false;}
  };
  pc.onconnectionstatechange=()=>{
   this.emit({});
   if(c.recovery)clearTimeout(c.recovery);
   if(pc.connectionState==='connected'&&c.outgoing&&c.active)this.measure('pttPressToTransportMs',this.pressedAt);
   if(pc.connectionState==='disconnected'&&c.outgoing)c.recovery=setTimeout(()=>{if(pc.connectionState==='disconnected')void restart();},2000);
   else if(pc.connectionState==='failed'){if(c.outgoing)void restart();else this.close(c);}
   else if(pc.connectionState==='closed')this.close(c);
  };
  pc.ontrack=e=>{const f=this.state?.floors.find(f=>f.id===c.floorId);if(outgoing||!this.state?.access.voiceEnabled||!this.state.access.canListen){e.track.stop();return;}if(f&&this.playable(f)&&!this.heard.has(f.id)){this.heard.add(f.id);this.beep(f.channel!=='public'?'privateTone':'publicTone',f.id);}const audio=c.audio??new Audio();audio.autoplay=false;audio.muted=!f||!this.playable(f);audio.srcObject=e.streams[0]?.getAudioTracks().length===1&&e.streams[0].getAudioTracks()[0]===e.track?e.streams[0]:new MediaStream([e.track]);c.audio=audio;c.active=!!f&&this.playable(f);const receiver=e.receiver as RTCRtpReceiver&{jitterBufferTarget?:number};try{receiver.jitterBufferTarget=80;}catch{}this.audioState();if(f&&this.playable(f)){this.acknowledge(c,f);this.observeReceiver(c,f);void audio.play().catch(()=>this.emit({needsPlayback:true,message:'اضغط أحد زري الصوت لتفعيل الاستماع'}));}};
  // setRemoteDescription creates the receiver for the offered m-line. An eager
  // recvonly transceiver can leave an extra silent track ahead of the RTP track.
  if(outgoing){const stream=this.streamForSending??this.stream;const transceiver=pc.addTransceiver(warm?'audio':stream!.getAudioTracks()[0],{direction:'sendonly',...(warm?{}:{streams:[stream!]}),sendEncodings:[{maxBitrate:24000}]});c.sender=transceiver.sender;
   const codecs=RTCRtpSender.getCapabilities?.('audio')?.codecs.filter(codec=>codec.mimeType.toLowerCase()==='audio/opus');if(codecs?.length)transceiver.setCodecPreferences(codecs);
  }
  return c;
 }
 private warmFloor(peer:VoicePeer,channel:'public'|'private',outgoing:boolean):VoiceFloor {
  const driver=channel==='public'?null:this.peer?.office?peer.driverId:this.peer?.driverId??null;
  return {id:EMPTY_FLOOR,speaker:outgoing?this.peer!.id:peer.id,driverId:driver,name:peer.name,plate:peer.plate,channel:channel==='public'?'public':'private:'+driver,startedAt:'',expiresAt:'',revision:0};
 }
 private warmConnections(){
  // Negotiate silent transports in both directions, even for a listen-only phone.
  if(!this.transportWarmEnabled||this.callSuspended||!this.peer||!this.state)return;
  const a=this.state.access;
  // Keep silent preparation linear around the office. Public driver broadcasts
  // still use compatible direct RTP; do not pre-create an all-driver mesh.
  for(const p of this.state.peers.filter(p=>p.id!==this.peer?.id&&(this.peer?.office||p.office)))for(const channel of ['public','private'] as const){
   if(channel==='private'&&p.office===this.peer.office)continue;
   if(!this.peer.office&&(!a.voiceEnabled||a.isVoiceBlocked||(channel==='public'?!a.canTalkPublic||this.state.publicMuted:!a.canTalkPrivate)))continue;
   const f=this.warmFloor(p,channel,true),key=this.transportKey(p.id,f,true);
   if(this.connections.has(key))continue;
   const c=this.connection(p.id,f,true,true);
   c.warming=(async()=>{try{await c.pc.setLocalDescription(voiceDescription(await c.pc.createOffer()));if(this.connections.get(key)===c)await this.signal(p.id,EMPTY_FLOOR,'offer',c.pc.localDescription,channel);}catch{this.close(c);}})();
  }
 }
 private async receiveWarm(signal:VoiceSignal){
  if(this.callSuspended||!this.peer||!this.state?.access.voiceEnabled)return;
  const p=this.state.peers.find(p=>p.id===signal.from);if(!p)return;
  const channel=signal.channel==='private'?'private':'public',outgoing=signal.warmSender===this.peer.id;
  if(signal.warmSender!==this.peer.id&&signal.warmSender!==p.id||channel==='private'&&p.office===this.peer.office)return;
  if(!outgoing&&!this.peer.office&&!this.state.access.canListen)return;
  const f=this.warmFloor(p,channel,outgoing),key=this.transportKey(p.id,f,outgoing);
  let c=this.connections.get(key);
  // A floor update can arrive before the answer to its silent preparation.
  if(!c){if(outgoing)return;c=this.connection(p.id,f,false,true);}
  if(!c.active)c.floorId=EMPTY_FLOOR;
  const data=JSON.parse(signal.data);
  if(signal.kind!=='ice'){c.remoteFloorBinding=data.floorBinding===true;c.remoteReadyAck=data.readyAck===true;}
  if(signal.kind==='ice'){if(c.pc.remoteDescription)await c.pc.addIceCandidate(data);else c.pending.push(data);return;}
  if(signal.kind==='offer'&&!outgoing){await c.pc.setRemoteDescription(data);for(const ice of c.pending)await c.pc.addIceCandidate(ice);c.pending=[];await c.pc.setLocalDescription(voiceDescription(await c.pc.createAnswer()));await this.signal(p.id,EMPTY_FLOOR,'answer',c.pc.localDescription,channel,p.id);}
  else if(signal.kind==='answer'&&outgoing){await c.pc.setRemoteDescription(data);for(const ice of c.pending)await c.pc.addIceCandidate(ice);c.pending=[];}
 }
 private async receive(signal:VoiceSignal){
  if(signal.floorId===EMPTY_FLOOR){await this.receiveWarm(signal);return;}
  const f=this.state?.floors.find(f=>f.id===signal.floorId);if(!f)return;
  const outbound=f.speaker===this.peer?.id;
  if(!outbound&&(!this.allowed(f)||signal.from!==f.speaker))return;
  if(outbound&&(!this.floor||this.floor.id!==f.id))return;
  const c=this.connection(signal.from,f,outbound);
  if(signal.kind!=='ice'){const data=JSON.parse(signal.data);c.remoteFloorBinding=data.floorBinding===true;c.remoteReadyAck=data.readyAck===true;}
  if(signal.kind==='ice'){const candidate=JSON.parse(signal.data) as RTCIceCandidateInit;if(c.pc.remoteDescription)await c.pc.addIceCandidate(candidate);else c.pending.push(candidate);return;}
  if(signal.kind==='offer'){
   if(outbound)return;
   await c.pc.setRemoteDescription(JSON.parse(signal.data));
   for(const candidate of c.pending)await c.pc.addIceCandidate(candidate);c.pending=[];
   await c.pc.setLocalDescription(voiceDescription(await c.pc.createAnswer()));await this.signal(signal.from,f.id,'answer',c.pc.localDescription);if(c.audio&&this.playable(f)){c.audio.muted=false;c.active=true;this.audioState();void c.audio.play().then(()=>this.acknowledge(c,f)).catch(()=>this.emit({needsPlayback:true}));if(!this.heard.has(f.id)){this.heard.add(f.id);this.beep(f.channel!=='public'?'privateTone':'publicTone',f.id);}}
  }else if(signal.kind==='answer'&&outbound){await c.pc.setRemoteDescription(JSON.parse(signal.data));for(const candidate of c.pending)await c.pc.addIceCandidate(candidate);c.pending=[];}
 }
 private async offer(f:VoiceFloor,p:VoicePeer){
  const stream=this.streamForSending??this.stream;
  if(!this.floor||this.floor.id!==f.id||!stream||[...this.connections.values()].some(c=>c.outgoing&&c.peerId===p.id&&c.floorId===f.id&&c.active))return;
  const c=this.connection(p.id,f,true);
  try{await c.warming;
   // The answer to silent preparation may still be in flight on the first press.
   // Keep that negotiation: replacing it races its old answer with the new SDP.
   while(c.pc.signalingState==='have-local-offer'&&this.floor?.id===f.id&&performance.now()-this.pressedAt<3500)await new Promise<void>(r=>setTimeout(r,10));
   if(this.floor?.id!==f.id)return;
   if(c.pc.signalingState==='have-local-offer')throw new Error('Voice negotiation pending');
   if(c.sender){const track=stream.getAudioTracks()[0],at=performance.now();c.mediaTask=c.mediaTask.then(async()=>{if(this.floor?.id===f.id&&c.active){await c.sender!.replaceTrack(track);c.mediaReady=true;}});await c.mediaTask;this.measure('pttSenderAttachMs',at);}if(this.floor?.id!==f.id){if(c.floorId===f.id)this.idle(c);return;}
   // Current receivers bind a cached stream to the authenticated floor update.
   // A connected transport needs only replaceTrack, not a new SDP/ICE round trip.
   if(this.transportWarmEnabled&&c.remoteFloorBinding&&c.pc.connectionState==='connected'&&c.pc.signalingState==='stable'&&c.pc.remoteDescription){this.measure('pttPressToTransportMs',this.pressedAt);return;}
   await c.pc.setLocalDescription(voiceDescription(await c.pc.createOffer({iceRestart:c.pc.connectionState==='failed'||c.pc.connectionState==='disconnected'})));if(this.floor?.id===f.id){await this.signal(p.id,f.id,'offer',c.pc.localDescription);if(c.pc.connectionState==='connected')this.measure('pttPressToTransportMs',this.pressedAt);}else if(c.floorId===f.id)this.idle(c);}catch{if(c.floorId===f.id)this.close(c);}
 }
 private async apply(s:VoiceState){
  if(this.callSuspended){this.emit({connected:true,state:s,talking:null,message:'المخشيرة متوقفة أثناء مكالمة الرحلة'});return;}
  if(s.revision<Math.max(this.state?.revision??0,this.floor?.revision??0)){for(const message of s.signals)try{await this.receive(message);}catch{}return;}
  this.state=s;this.offset=Date.parse(s.serverTime)-Date.now();
  if(this.prepared&&!this.peer?.office&&(!s.access.voiceEnabled||s.access.isVoiceBlocked||!s.access.canTalkPublic&&!s.access.canTalkPrivate))this.releaseMicrophone();
  if(this.floor&&s.revision>=this.floor.revision&&(!s.floors.some(f=>f.id===this.floor!.id)||!this.peer?.office&&(!s.access.voiceEnabled||s.access.isVoiceBlocked||(this.floor.channel==='public'?s.publicMuted||!s.access.canTalkPublic:!s.access.canTalkPrivate))))this.stop();
  for(const c of this.connections.values()){
   const f=c.outgoing?s.floors.find(f=>f.id===c.floorId):s.floors.filter(f=>f.speaker===c.peerId&&c.key===this.transportKey(c.peerId,f,false)).sort((a,b)=>Number(b.channel!=='public')-Number(a.channel!=='public'))[0];
   if(!s.peers.some(p=>p.id===c.peerId)||!c.outgoing&&(!s.access.voiceEnabled||!s.access.canListen)||f&&f.speaker!==this.peer?.id&&!this.allowed(f)){this.close(c);continue;}
   if(!f){this.idle(c);continue;}
   if(!c.outgoing){c.floorId=f.id;if(!this.playable(f)){this.idle(c);continue;}if(c.audio&&!c.active){c.active=true;c.audio.muted=false;this.audioState();void c.audio.play().catch(()=>this.emit({needsPlayback:true}));if(!this.heard.has(f.id)){this.heard.add(f.id);this.beep(f.channel!=='public'?'privateTone':'publicTone',f.id);}}if(c.audio){this.acknowledge(c,f);this.observeReceiver(c,f);}}
  }
  for(const message of s.signals)try{await this.receive(message);}catch{const c=[...this.connections.values()].find(c=>c.floorId===message.floorId&&c.peerId===message.from);if(c)this.close(c);}
  this.warmConnections();
  if(this.floor){const f=this.floor;for(const p of s.peers)if(p.id!==this.peer?.id&&(f.channel==='public'||p.office||p.driverId===f.driverId))void this.offer(f,p);}
  const speaking=s.floors.find(f=>f.channel==='public')??s.floors[0];
  this.emit({connected:true,state:s,talking:this.drainTask?null:this.transmitting?this.floor:null,pending:!!this.drainTask||this.held&&!this.transmitting,message:this.drainTask?'جارٍ إنهاء الإرسال…':this.floor?(this.transmitting?(this.floor.channel==='public'?'أنت تتحدث للجميع':'خاص مع '+(this.peer?.office?s.peers.find(p=>p.driverId===this.floor!.driverId)?.name??'السائق':'المكتب')):(this.microphoneStarting?'جارٍ تهيئة الميكروفون…':'جارٍ تجهيز مسار الصوت…')):speaking?`يتحدث الآن: ${speaking.name}${speaking.plate?' - '+speaking.plate:''}`:'المخشيرة متصلة'});
 }
 async connect(){
  if(this.controller)return;
  this.unlock();
  if(typeof RTCPeerConnection==='undefined'){this.emit({message:'الصوت غير مدعوم في هذا المتصفح'});return;}
  const controller=new AbortController();this.controller=controller;
  const wait=(ms:number)=>new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',done);if(this.wake===done)this.wake=null;resolve();};const timer=setTimeout(done,ms);this.wake=done;controller.signal.addEventListener('abort',done,{once:true});});
  this.watchdog=setInterval(()=>{if(this.floor&&performance.now()-this.renewedAt>4500)this.stop();for(const c of this.connections.values()){const f=this.state?.floors.find(f=>f.id===c.floorId);if(f&&f.speaker!==this.peer?.id&&!this.allowed(f))this.close(c);}this.speakerState();void this.sampleTransport();},250);
  let retry=1000;
  while(!controller.signal.aborted){
   try{
    this.networkController=new AbortController();const signal=AbortSignal.any([controller.signal,this.networkController.signal]);
    if(!this.peer){const joined=await this.request<{peer:VoicePeer;iceServers:RTCIceServer[];preparedTransport?:boolean;multiplexedTransport?:boolean;cancellableFloor?:boolean}>('voice/session','POST',{multiplexed:true},signal);this.peer=joined.peer;this.ice=joined.iceServers;this.transportWarmEnabled=joined.preparedTransport===true;this.multiplexedTransport=joined.multiplexedTransport===true;this.cancellableFloor=joined.cancellableFloor===true;this.state=null;if(typeof AudioWorkletNode!=='undefined')void prepareVoiceBuffer().catch(()=>{});}
    const s=await this.request<VoiceState>(`voice/updates?sessionId=${this.peer.id}${this.state?'&revision='+this.state.revision:''}`,'GET',undefined,signal);
    if(!controller.signal.aborted){await this.apply(s);retry=1000;}
   }catch(e){if(controller.signal.aborted)break;this.stop();if(this.automaticCapture&&(e as {sessionInvalid?:boolean}).sessionInvalid){this.dispose();this.emit({connected:false,message:'انتهت جلسة الحساب؛ سجل الدخول مجددًا'});if(typeof window!=='undefined')window.dispatchEvent(new Event('dispatchpro-radio-session-invalid'));break;}if((e as {status?:number}).status===401||(e as {status?:number}).status===403||(e as {status?:number}).status===410||(e as {status?:number}).status===404){this.releaseMicrophone();this.clearConnections();this.peer=null;this.state=null;}this.emit({connected:false,message:'جاري إعادة الاتصال'});const delay=this.retryNow?0:retry+Math.random()*250;this.retryNow=false;await wait(delay);retry=Math.min(retry*2,10000);}
  }
 }
 private beep(kind:'publicTone'|'privateTone'|'floorTone',eventId?:string){if(isQaAudio()){const id=eventId??this.floor?.id??this.state?.floors.find(f=>f.speaker!==this.peer?.id&&this.playable(f))?.id;if(id)qaTone(kind==='floorTone'?'ptt-start':'ptt-receive',id);return;}try{const context=this.chime;if(context)void Promise.resolve(context.resume()).then(()=>{if(this.chime!==context)return;playDriverTone(context,driverTones()[kind],kind==='floorTone'?.05:.07,kind==='floorTone'?.04:.1);this.idleChime();}).catch(()=>{});}catch{}}
 unlock(){try{if(typeof AudioContext!=='undefined'){this.chime??=new AudioContext();void this.chime.resume();this.idleChime();}}catch{}this.emit({needsPlayback:false});for(const c of this.connections.values())if(c.audio&&c.active)void c.audio.play().catch(()=>this.emit({needsPlayback:true}));}
 async start(channel:'public'|'private',driverId?:string,source='ui'){
  if(this.drainTask){const queued=++this.queuedPress;this.queuedSource=source;await this.drainTask;if(queued!==this.queuedPress)return;this.queuedSource=null;}
  if(!this.audioAvailable){this.emit({message:'الصوت مستخدم بواسطة تطبيق آخر؛ أعد المحاولة بعد انتهائه'});return;}
  if(this.preparationRequired&&!this.prepared){this.emit({message:'فعّل الصوت أولًا لتجهيز إذن الميكروفون'});return;}
  if(this.callSuspended||(globalThis as any).dispatchProRideCallActive){this.emit({message:'الميكروفون مستخدم للمكالمة'});return;}this.unlock();if(this.held)return;this.held=true;this.heldSource=source;const generation=++this.generation;
  const peer=this.peer,controller=this.controller;
  if(!peer||!this.status.connected){this.held=false;this.emit({message:'المخشيرة غير متصلة'});return;}
  const access=this.state?.access;
  if(!peer.office&&(!access?.voiceEnabled||access.isVoiceBlocked||(channel==='public'?!access.canTalkPublic||this.state?.publicMuted:!access.canTalkPrivate))){this.held=false;this.emit({message:'التحدث غير مسموح'});return;}
  const speaking=this.state?.floors.find(f=>f.channel==='public'&&f.speaker!==peer.id);
  if(channel==='public'&&!peer.office&&speaking&&Date.parse(speaking.expiresAt)>Date.now()+this.offset){this.held=false;qaTone('busy',speaking.id);this.emit({message:`الموجة مشغولة - ${speaking.name} يتحدث`});return;}
  this.pressedAt=performance.now();
  this.attemptId=globalThis.crypto?.randomUUID?.()??'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const n=Math.floor(Math.random()*16);return (c==='x'?n:(n&3)|8).toString(16);});
  const attemptId=this.attemptId;
  this.record('pttPressMs',0);
  this.emit({pending:true,talking:null,message:'جارٍ طلب الموجة…'});
  try{
   // Open hardware only after a permitted press. In parallel with floor HTTP,
   // prepare a disabled track; no sender attaches/enables it before the grant.
   const buffered=!!this.captureFactory||typeof AudioWorkletNode!=='undefined';
   this.captureAbort=new AbortController();const captureSignal=this.captureAbort.signal;
   const capture=this.automaticCapture||buffered?(async()=>{
    this.captureRequested=true;this.microphoneStarting=true;this.audioState();
    if((globalThis as any).dispatchProCallNative){const routeAt=performance.now();await (globalThis as any).dispatchProCallNative('voice.audio',{active:true,reason:'ptt-press'});this.measure('pttAudioRouteMs',routeAt);}
    if(!this.held||generation!==this.generation)throw new Error('Microphone preparation cancelled');
    const at=performance.now();try{
     let stream:MediaStream;
     if(buffered){const metric=(name:string,ms:number)=>{this.record(name,ms,{sessionId:peer.id,attemptId});if(name==='pttCaptureFailure'||name==='pttCaptureOverflow'){this.stop();this.emit({message:'تعذر التقاط الصوت؛ أعد المحاولة'});}};
      const recording=this.captureFactory?await this.captureFactory.begin(attemptId,captureSignal,metric):await browserPressCapture(attemptId,captureSignal,()=>this.microphone(),metric,()=>{this.stream?.getTracks().forEach(t=>{t.enabled=false;if(!this.prepared)t.stop();});if(!this.prepared)this.stream=null;});
      recording.stream.getAudioTracks().forEach(t=>t.enabled=false);
      if(captureSignal.aborted||generation!==this.generation){await recording.stop(false);throw new Error('Microphone preparation cancelled');}this.pressCapture=recording;stream=recording.stream;
     }else stream=await this.microphone();
     this.measure('pttMicrophoneSetupMs',at);this.measure('pttPressToMicrophoneMs',this.pressedAt);return stream;
    }finally{if(generation===this.generation)this.microphoneStarting=false;}
   })():null;
   // Floor denial/release can finish first; handle a late rejected capture too.
   void capture?.catch(()=>{});
   let stream=this.automaticCapture||buffered?null:await this.microphone();
   if(!this.held||generation!==this.generation){if(!this.held&&stream){stream.getAudioTracks().forEach(t=>{t.enabled=false;if(!this.prepared&&!this.peer?.office)t.stop();});if(!this.prepared&&!this.peer?.office&&this.stream===stream)this.stream=null;}return;}
   stream?.getAudioTracks().forEach(t=>t.enabled=false);
   // A cancelled acquisition releases its grant before the next press can acquire.
   const f=await this.control(async()=>{
    if(!this.held||generation!==this.generation)return null;
    this.measure('pttPressToFloorRequestMs',this.pressedAt);const requestedAt=performance.now();
    const acquisition=new AbortController();this.acquisition=acquisition;
    let granted:VoiceFloor;
    try{granted=await this.request<VoiceFloor>('voice/floor','POST',{sessionId:peer.id,channel,driverId,attemptId},this.cancellableFloor?AbortSignal.any([acquisition.signal,...(controller?[controller.signal]:[])]):controller?.signal);}
    finally{if(this.acquisition===acquisition)this.acquisition=null;}
    this.measure('pttFloorGrantMs',requestedAt);this.measure('pttPressToFloorGrantMs',this.pressedAt);
    if(!this.held||generation!==this.generation){await this.request('voice/release','POST',{sessionId:peer.id,floorId:granted.id});return null;}
    // Publish ownership before returning from the serialized acquisition. stop()
    // must be able to release this grant even while sender detachment is pending.
    this.floor=granted;this.renewedAt=performance.now();
    return granted;
   });
   if(!f||!this.held||generation!==this.generation||this.floor?.id!==f.id)return;
   let renewing=false;
   this.heartbeat=setInterval(async()=>{if(renewing||this.floor?.id!==f.id)return;renewing=true;try{const r=await this.request<{held:boolean}>('voice/heartbeat','POST',{sessionId:peer.id,floorId:f.id,audioStarted:this.transmitting},controller?.signal);if(this.floor?.id!==f.id)return;if(!r.held)this.stop();else this.renewedAt=performance.now();}catch{if(this.floor?.id===f.id)this.stop();}finally{renewing=false;}},1500);
   stream??=await capture!;this.captureRequested=false;
   if(buffered)this.streamForSending=stream;
   if(!this.held||generation!==this.generation)return;
   await Promise.all([...this.connections.values()].filter(c=>c.outgoing&&!c.active).map(c=>c.mediaTask));
   if(!this.held||generation!==this.generation||this.floor?.id!==f.id)return;
   this.audioState();
   // Merge the grant immediately; an earlier long-poll response must not revoke it.
   if(this.state)this.state={...this.state,floors:[...this.state.floors.filter(x=>x.channel!==f.channel),f]};
   this.emit({talking:null,pending:true,message:'جارٍ تجهيز مسار الصوت…'});
   const recipients=(this.state?.peers??[]).filter(p=>p.id!==peer.id&&(channel==='public'||p.office||p.driverId===f.driverId));
   const offers=recipients.map(p=>this.offer(f,p));
   // A slow or unreachable listener must not block every other recipient.
   void Promise.all(offers);
   const readyAt=performance.now(),deadline=readyAt+3500;
   const readyConnections=()=>[...this.connections.values()].filter(c=>c.outgoing&&c.active&&c.mediaReady&&c.floorId===f.id&&c.pc.connectionState==='connected'&&(!c.remoteReadyAck||c.ackFloor===f.id));
   const ready=()=>readyConnections().length>0;
   // Wait for authorized receiver attachment, not just one connected ICE path.
   // Bound the grace period: an unreachable receiver cannot silence the room.
   let firstReadyAt=0;
   while(this.held&&generation===this.generation&&performance.now()<deadline){
    if(ready()){firstReadyAt||=performance.now();if(readyConnections().length===recipients.length||performance.now()-firstReadyAt>=180)break;}
    await new Promise<void>(resolve=>setTimeout(resolve,10));
   }
   if(!this.held||generation!==this.generation||this.floor?.id!==f.id)return;
   if(!ready())throw new Error('تعذر تجهيز مسار الصوت للطرف الآخر؛ تحقق من الشبكة');
   this.measure('pttReceiverReadyWaitMs',readyAt);
   this.record('pttExpectedRecipients',recipients.length);this.record('pttReadyRecipients',readyConnections().length);
   stream.getAudioTracks().forEach(t=>t.enabled=true);this.pressCapture?.commit();this.transmitting=true;this.beep('floorTone');this.measure('pttPressToTrackMs',this.pressedAt);
   for(const c of readyConnections())void this.observeSender(c,f,performance.now());
   this.emit({talking:f,pending:false,message:channel==='public'?'أنت تتحدث للجميع':'خاص مع '+(driverId?this.state?.peers.find(p=>p.driverId===driverId)?.name??'السائق':'المكتب')});
   void this.request('voice/heartbeat','POST',{sessionId:peer.id,floorId:f.id,audioStarted:true},controller?.signal).catch(()=>{});
  }catch(e){if(generation===this.generation){this.stop();const error=e as Error;this.emit({message:error.name==='NotAllowedError'?'إذن الميكروفون غير متاح؛ فعّله من أذونات التطبيق':error.name==='NotFoundError'?'لم يُعثر على ميكروفون؛ تحقق من جهاز الصوت':error.name==='NotReadableError'?'الميكروفون مشغول أو تعذر فتحه؛ أغلق المكالمة وأعد المحاولة':/[\u0600-\u06ff]/.test(error.message)?error.message:'تعذر تشغيل الصوت؛ أعد المحاولة'});}}
 }
 stop(source?:string){
  if(!source||this.queuedSource===source){++this.queuedPress;this.queuedSource=null;}
  if(source&&this.heldSource!==source)return;
  if(source&&this.transmitting&&this.pressCapture&&!this.drainTask){const capture=this.pressCapture;this.pressCapture=null;const generation=this.generation;
   this.record('pttReleaseMs',Math.max(0,performance.now()-this.pressedAt));this.held=false;this.heldSource=null;
   this.emit({talking:null,pending:true,message:'جارٍ إنهاء الإرسال…'});
   this.drainTask=capture.stop(true).catch(()=>{}).finally(()=>{this.drainTask=null;if(generation===this.generation)this.finishStop();});return;
  }
  this.finishStop(source);
 }
 private finishStop(source?:string){
  if(source&&this.heldSource!==source)return;
  const trace={sessionId:this.peer?.id,attemptId:this.attemptId,floorId:this.floor?.id};
  if(this.transmitting&&this.floor)qaTone('ptt-end',this.floor.id);
  if(this.held)this.record('pttReleaseMs',Math.max(0,performance.now()-this.pressedAt),trace);
  if(this.acquisition&&this.cancellableFloor&&this.peer&&this.attemptId){
   const sessionId=this.peer.id,attemptId=this.attemptId;
   // Cancellation reaches the server even if grant HTTP has not returned. Its
   // tombstone prevents a late acquisition, regardless of request arrival order.
   const cancelled=this.request('voice/release','POST',{sessionId,attemptId});
   this.acquisition.abort();void this.control(()=>cancelled).catch(()=>{});
  }
  this.heldSource=null;this.held=false;this.transmitting=false;this.captureRequested=false;this.microphoneStarting=false;this.attemptId=null;++this.generation;if(this.automaticCapture)++this.mediaGeneration;if(this.heartbeat)clearInterval(this.heartbeat);this.heartbeat=null;
  this.captureAbort?.abort();this.captureAbort=null;void this.pressCapture?.stop(false);this.pressCapture=null;
  this.streamForSending?.getTracks().forEach(t=>t.stop());this.streamForSending=null;
  this.stream?.getTracks().forEach(t=>{t.enabled=false;if(!this.prepared&&(this.automaticCapture||!this.peer?.office))t.stop();});if(!this.prepared&&(this.automaticCapture||!this.peer?.office))this.stream=null;
  const f=this.floor;this.floor=null;if(f){for(const c of this.connections.values())if(c.floorId===f.id)this.idle(c);if(this.peer){const peer=this.peer,releasedAt=performance.now();void this.control(()=>this.request<{revision?:number}>('voice/release','POST',{sessionId:peer.id,floorId:f.id})).then(r=>{this.record('pttFloorReleaseMs',Math.max(0,performance.now()-releasedAt),trace);if(this.state&&r.revision!==undefined&&r.revision>=this.state.revision){this.state={...this.state,revision:r.revision,floors:this.state.floors.filter(x=>x.id!==f.id)};this.emit({state:this.state});}}).catch(()=>{});}}
  this.emit({talking:null,pending:false,message:this.status.connected?'المخشيرة متصلة':'جاري إعادة الاتصال'});
  this.audioState();
 }
 releaseMicrophone(){++this.mediaGeneration;this.stop();this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.preparedState(false);}
 dispose(){const peer=this.peer;this.releaseMicrophone();this.captureFactory?.dispose();if(this.chimeIdle)clearTimeout(this.chimeIdle);this.chimeIdle=null;void this.chime?.close();this.chime=null;this.heard.clear();this.controller?.abort();this.networkController?.abort();this.networkController=null;this.controller=null;this.peer=null;this.clearConnections();if(this.watchdog)clearInterval(this.watchdog);this.watchdog=null;if(peer)void this.request('voice/release','POST',{sessionId:peer.id,leave:true}).catch(()=>{});}
}
