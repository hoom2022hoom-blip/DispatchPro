import test from 'node:test';
import assert from 'node:assert/strict';
import {VoiceClient,defaultVoiceAccess,voiceDescription} from '../src/lib/voice-client.ts';

test('QA PTT sends one native start/end pair only after grant and repeated release stays silent',async t=>{
 const f=setup(t),events=[];globalThis.dispatchProDriverQa=true;globalThis.dispatchProCallNative=async(type,data)=>events.push({type,data});
 t.after(()=>{delete globalThis.dispatchProDriverQa;delete globalThis.dispatchProCallNative;delete globalThis.dispatchProQaVoiceActive;});
 await f.client.start('private');f.client.stop();f.client.stop();await Promise.resolve();
 assert.deepEqual(events.filter(e=>e.type==='sound.event').map(e=>e.data.kind),['ptt-start','ptt-end']);
 assert.equal(events[0].data.key,events[1].data.key);
});

test('authorized incoming PTT switches audio without a button press, then restores on floor release',async t=>{
 const f=setup(t),events=[],oldWindow=globalThis.window;
 globalThis.window={dispatchEvent:e=>events.push(e)};
 t.after(()=>{if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;});
 f.client.unlock();f.client.stop();
 assert.equal(events.filter(e=>e.type==='dispatchpro-voice-audio').length,0);
 const incoming=floor('office');f.client.state=state(peer('a'),[incoming]);
 await f.client.receive({floorId:incoming.id,from:'office',kind:'offer',data:'{"type":"offer","sdp":"opus"}'});
 f.pcs[0].ontrack({track:f.track,streams:[f.stream],receiver:{}});
 await f.client.apply(state(peer('a'),[],4));
 assert.deepEqual(events.filter(e=>e.type==='dispatchpro-voice-audio').map(e=>e.detail),[{active:true,reason:'receive'},{active:false,reason:'idle'}]);
 assert.equal(f.micCalls(),0);assert.equal(f.calls.filter(c=>c.path==='voice/floor').length,0);
});

test('pressed buffered capture commits only after a floor and receiver, and release stops input before releasing the grant',async t=>{
 const f=setup(t);let commits=0,stops=0,finishDrain;
 f.track.enabled=false;f.client.setCaptureFactory({prepare:async()=>{},dispose(){},begin:async()=>({stream:f.stream,commit(){commits++;assert.ok(f.client.floor);assert.ok(f.track.enabled);},stop:async drain=>{stops++;if(drain)await new Promise(r=>finishDrain=r);}})});
 await f.client.start('private');assert.equal(f.micCalls(),0);assert.equal(commits,1);
 f.client.stop('ui');assert.equal(stops,1);assert.ok(f.client.floor);assert.equal(f.client.held,false);finishDrain();await f.client.drainTask;assert.equal(f.client.floor,null);await f.client.floorTask;assert.ok(f.calls.some(c=>c.path==='voice/release'));
});
test('a press released during a previous buffered tail cannot start after its finger has gone up',async t=>{
 const f=setup(t);let finishDrain;f.client.setCaptureFactory({prepare:async()=>{},dispose(){},begin:async()=>({stream:f.stream,commit(){},stop:async drain=>{if(drain)await new Promise(r=>finishDrain=r);}})});
 await f.client.start('public');f.client.stop('ui');const next=f.client.start('private',undefined,'ui');f.client.stop('ui');finishDrain();await next;assert.equal(f.calls.filter(c=>c.path==='voice/floor').length,1);assert.equal(f.client.held,false);
});
test('floor denial discards buffered microphone speech without a commit or outgoing track',async t=>{
 const f=setup(t);let commit=0,discard=0;f.client.setCaptureFactory({prepare:async()=>{},dispose(){},begin:async()=>({stream:f.stream,commit(){commit++;},stop:async()=>{discard++;}})});
 f.client.request=async path=>{if(path==='voice/floor')throw Object.assign(new Error('busy'),{status:409});return{};};await f.client.start('public');assert.equal(commit,0);assert.ok(discard>0);assert.equal(f.client.floor,null);assert.equal(f.track.enabled,false);
});

const peer=(id,office=false)=>({id,actorId:'actor-'+id,driverId:office?null:'driver-'+id,name:id,plate:id,office});
const floor=(speaker,channel='public',revision=3)=>({id:'floor-'+speaker,channel,driverId:channel==='public'?null:'driver-a',speaker,name:speaker,startedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+6000).toISOString(),revision});
const state=(self,floors=[],revision=3)=>({self,peers:[peer('office',true),peer('a'),peer('b')],floors,revision,signals:[],access:defaultVoiceAccess,publicMuted:false,serverTime:new Date().toISOString()});
function setup(t){
 const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator'),originalPc=globalThis.RTCPeerConnection,originalAudio=globalThis.Audio,originalInterval=globalThis.setInterval,originalClear=globalThis.clearInterval,originalSender=globalThis.RTCRtpSender;
 const calls=[],pcs=[],timers=new Map(),statuses=[];let sequence=0,micCalls=0;
 const track={kind:'audio',enabled:true,stopped:false,stop(){this.stopped=true;}},stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>{micCalls++;return stream;}}}});
 globalThis.Audio=class{pause(){}play(){return Promise.resolve();}};
 globalThis.RTCRtpSender={getCapabilities:()=>({codecs:[{mimeType:'audio/opus'}]})};
 globalThis.RTCPeerConnection=class{
  constructor(){pcs.push(this);this.connectionState='connected';this.localDescription=null;this.remoteDescription=null;this.closed=false;}
  addTransceiver(track){this.sender={track:typeof track==='string'?null:track,replaceTrack:async next=>{this.sender.track=next;}};return {sender:this.sender,setCodecPreferences(){}};}
  getSenders(){return this.sender?[this.sender]:[];}
  createOffer(){return Promise.resolve({type:'offer',sdp:'opus'});}createAnswer(){return Promise.resolve({type:'answer',sdp:'opus'});}
  setLocalDescription(d){this.localDescription=d;return Promise.resolve();}setRemoteDescription(d){this.remoteDescription=d;return Promise.resolve();}addIceCandidate(){return Promise.resolve();}
  close(){this.closed=true;}
 };
 globalThis.setInterval=(fn)=>{const id=++sequence;timers.set(id,fn);return id;};globalThis.clearInterval=id=>timers.delete(id);
 const request=async(path,method,body)=>{calls.push({path,method,body});if(path==='voice/floor')return floor('a',body.channel);if(path==='voice/heartbeat')return{held:true};return{};};
 const client=new VoiceClient(request,s=>statuses.push(s));client.peer=peer('a');client.controller=new AbortController();client.state=state(client.peer);client.status={connected:true,message:'',talking:null,state:client.state,needsPlayback:false};
 t.after(()=>{client.dispose();globalThis.setInterval=originalInterval;globalThis.clearInterval=originalClear;globalThis.RTCPeerConnection=originalPc;globalThis.RTCRtpSender=originalSender;globalThis.Audio=originalAudio;if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);else delete globalThis.navigator;});
 return {client,calls,pcs,timers,statuses,track,stream,micCalls:()=>micCalls};
}
test('hold requests one microphone and floor; release stops all media immediately and releases the specific floor',async t=>{
 const f=setup(t);await f.client.start('public');await f.client.start('public');await Promise.resolve();
 assert.equal(f.micCalls(),1);assert.equal(f.calls.filter(c=>c.path==='voice/floor').length,1);assert.equal(f.pcs.length,2);assert.equal(f.track.enabled,true);
 f.client.stop();assert.equal(f.track.enabled,false);assert.ok(f.pcs.every(p=>!p.closed));assert.ok([...f.client.connections.values()].every(c=>!c.active));assert.equal(f.timers.size,0);await f.client.floorTask;assert.equal(f.calls.find(c=>c.path==='voice/release').body.floorId,'floor-a');
});
test('a delayed private sender detach completes before the next press attaches microphone',async t=>{
 const f=setup(t);await f.client.start('private');await new Promise(r=>setImmediate(r));
 const sender=f.pcs[0].sender;let release;const original=sender.replaceTrack.bind(sender);
 sender.replaceTrack=async track=>{if(track===null)await new Promise(r=>release=r);await original(track);};
 f.client.stop();await Promise.resolve();const next=f.client.start('private');await new Promise(r=>setImmediate(r));
 assert.equal(f.track.enabled,false);assert.equal(typeof release,'function');release();await next;await new Promise(r=>setImmediate(r));
 assert.equal(sender.track,f.track);assert.equal(f.track.enabled,true);assert.equal(f.pcs.length,1);
 // Let disposal detach without creating another unresolved synthetic wait.
 sender.replaceTrack=original;
});
test('release while microphone permission is pending never acquires a floor',async t=>{
 const f=setup(t);let resolve;globalThis.navigator.mediaDevices.getUserMedia=()=>new Promise(r=>resolve=r);
 const starting=f.client.start('public');f.client.stop();resolve(f.stream);await starting;
 assert.ok(f.track.stopped);assert.equal(f.calls.filter(c=>c.path==='voice/floor').length,0);assert.equal(f.pcs.length,0);
});
test('a grant released while its request is pending cannot open a delayed microphone session',async t=>{
 const f=setup(t);let resolve;f.client.request=async(path,method,body)=>{f.calls.push({path,body});if(path==='voice/floor')return new Promise(r=>resolve=r);return{};};
 const starting=f.client.start('public');await new Promise(setImmediate);f.client.stop();resolve(floor('a'));await starting;
 assert.equal(f.track.enabled,false);assert.equal(f.pcs.length,0);assert.ok(f.calls.some(c=>c.path==='voice/release'));
});
test('office private sends only to selected driver; driver private sends only to office',async t=>{
 const f=setup(t);await f.client.start('private');await new Promise(setImmediate);assert.equal(f.pcs.length,1);assert.equal(f.calls.find(c=>c.path==='voice/signal').body.to,'office');f.client.stop();
 f.client.peer=peer('office',true);f.client.state=state(f.client.peer);f.client.status={...f.client.status,connected:true};f.client.request=async(path,method,body)=>{f.calls.push({path,body});return path==='voice/floor'?{...floor('office','private'),driverId:'driver-b'}:{};};
 await f.client.start('private','driver-b');await new Promise(setImmediate);assert.equal(f.calls.filter(c=>c.path==='voice/signal').at(-1).body.to,'b');
});
test('floor loss, permission revocation and network heartbeat failure stop transmission',async t=>{
 const f=setup(t);await f.client.start('public');await f.client.apply(state(peer('a'),[],4));assert.equal(f.track.enabled,false);assert.equal(f.client.floor,null);
 f.track.stopped=false;await f.client.start('public');await f.client.apply({...state(peer('a'),[floor('a')],5),access:{...defaultVoiceAccess,isVoiceBlocked:true}});assert.equal(f.track.enabled,false);assert.equal(f.client.floor,null);
 f.track.stopped=false;f.client.state=state(peer('a'));await f.client.start('public');f.client.request=async()=>{throw new Error('offline');};await [...f.timers.values()][0]();assert.equal(f.track.enabled,false);assert.equal(f.client.floor,null);
});
test('older long-poll response cannot revoke a newer floor grant',async t=>{
 const f=setup(t);await f.client.start('public');await f.client.apply(state(peer('a'),[],2));assert.equal(f.client.floor.id,'floor-a');assert.equal(f.track.stopped,false);
});
test('private offers to another driver and offers without live floors create no receiver',async t=>{
 const f=setup(t);const privateFloor={...floor('office','private'),driverId:'driver-b'};f.client.state=state(peer('a'),[privateFloor]);
 await f.client.receive({floorId:privateFloor.id,from:'office',kind:'offer',data:'{"type":"offer","sdp":"opus"}'});assert.equal(f.pcs.length,0);
 f.client.state=state(peer('a'));await f.client.receive({floorId:'unknown',from:'office',kind:'offer',data:'{}'});assert.equal(f.pcs.length,0);
});
test('receiver stops on block or floor release and duplicate ICE uses one peer connection',async t=>{
 const f=setup(t),publicFloor=floor('office');f.client.state=state(peer('a'),[publicFloor]);
 const ice={floorId:publicFloor.id,from:'office',kind:'ice',data:'{"candidate":"test"}'};await f.client.receive(ice);await f.client.receive(ice);assert.equal(f.pcs.length,1);
 await f.client.apply({...state(peer('a'),[publicFloor],4),access:{...defaultVoiceAccess,voiceEnabled:false}});assert.ok(f.pcs[0].closed);assert.equal(f.client.connections.size,0);
});

test('successive holds release idle microphone hardware and reacquire it only while talking',async t=>{
 const f=setup(t);await f.client.start('public');f.client.stop();assert.equal(f.track.enabled,false);assert.equal(f.track.stopped,true);
 await f.client.start('private');assert.equal(f.track.enabled,true);assert.equal(f.micCalls(),2);
 f.client.dispose();assert.equal(f.track.enabled,false);assert.equal(f.track.stopped,true);
});
test('prepared office microphone stays disabled until grant; successive holds reuse peer connections',async t=>{
 const f=setup(t);f.client.peer=peer('office',true);f.client.state=state(f.client.peer);
 let sequence=0;f.client.request=async(path,method,body)=>{f.calls.push({path,body});return path==='voice/floor'?{...floor('office'),id:'office-floor-'+(++sequence)}:{};};
 await f.client.prepareMicrophone();assert.equal(f.track.enabled,false);assert.equal(f.micCalls(),1);assert.equal(f.calls.length,0);
 await f.client.start('public');await new Promise(setImmediate);const count=f.pcs.length;assert.equal(count,2);assert.equal(f.track.enabled,true);
 f.client.stop();assert.equal(f.track.enabled,false);assert.equal(f.track.stopped,false);
 await f.client.apply({...state(f.client.peer,[],5)});assert.ok([...f.client.connections.values()].every(c=>!c.active));
 await f.client.start('public');await new Promise(setImmediate);assert.equal(f.pcs.length,count);assert.equal(f.micCalls(),1);assert.equal(f.track.enabled,true);
 f.client.releaseMicrophone();assert.equal(f.track.stopped,true);assert.equal(f.track.enabled,false);
});
test('private transmission cannot feed previously cached public senders',async t=>{
 const f=setup(t);f.client.peer=peer('office',true);f.client.state=state(f.client.peer);let sequence=0;
 f.client.request=async(path,method,body)=>path==='voice/floor'?{...floor('office',body.channel),id:'privacy-'+(++sequence),driverId:body.driverId}:{};
 await f.client.start('public');await new Promise(setImmediate);const publicSenders=[...f.client.connections.values()].map(c=>c.sender);
 f.client.stop();await new Promise(setImmediate);assert.ok(publicSenders.every(s=>s.track===null));
 await f.client.start('private','driver-b');await new Promise(setImmediate);assert.equal(f.track.enabled,true);assert.ok(publicSenders.every(s=>s.track===null));
 const active=[...f.client.connections.values()].filter(c=>c.active);assert.equal(active.length,1);assert.equal(active[0].peerId,'b');assert.equal(active[0].sender.track,f.track);
});
test('an idle inbound connection is muted, reused on the next authorized floor and closed immediately on revoked listening',async t=>{
 const f=setup(t),first=floor('office');f.client.state=state(peer('a'),[first]);
 await f.client.receive({floorId:first.id,from:'office',kind:'offer',data:'{"type":"offer","sdp":"opus"}'});
 f.pcs[0].ontrack({track:f.track,streams:[f.stream],receiver:{}});const c=[...f.client.connections.values()][0];
 await f.client.apply(state(peer('a'),[],4));assert.equal(c.audio.muted,true);assert.equal(c.active,false);
 const second={...first,id:'next-floor',revision:5};f.client.state=state(peer('a'),[second],5);
 await f.client.receive({floorId:second.id,from:'office',kind:'offer',data:'{"type":"offer","sdp":"opus"}'});
 assert.equal(f.pcs.length,1);assert.equal(c.audio.muted,false);assert.equal(c.active,true);
 await f.client.apply({...state(peer('a'),[],6),access:{...defaultVoiceAccess,canListen:false}});assert.equal(f.pcs[0].closed,true);
});
test('autoplay refusal requests a user gesture; unlock retries only authorized active audio',async t=>{
 const f=setup(t),incoming=floor('office');f.client.state=state(peer('a'),[incoming]);
 globalThis.Audio.prototype.play=async()=>{throw new Error('autoplay denied');};
 const c=f.client.connection('office',incoming,false);c.pc.ontrack({track:f.track,streams:[f.stream],receiver:{}});await new Promise(setImmediate);
 assert.equal(f.statuses.at(-1).needsPlayback,true);assert.match(f.statuses.at(-1).message,/تفعيل الاستماع/);
 let plays=0;globalThis.Audio.prototype.play=async()=>{plays++;};f.client.unlock();await new Promise(setImmediate);assert.equal(plays,1);
 await f.client.apply(state(peer('a'),[],4));f.client.unlock();await new Promise(setImmediate);assert.equal(plays,1);assert.equal(c.audio.muted,true);
});

test('audio interruption idles a receiver and recovery reuses its authorized transport without another session or microphone',async t=>{
 const f=setup(t),incoming=floor('office');f.client.state=state(peer('a'),[incoming]);
 const c=f.client.connection('office',incoming,false);c.pc.ontrack({track:f.track,streams:[f.stream],receiver:{}});
 assert.equal(c.active,true);f.client.setAudioAvailable(false);assert.equal(c.active,false);assert.equal(c.audio.muted,true);
 f.client.setAudioAvailable(true);await new Promise(setImmediate);
 assert.equal(c.active,true);assert.equal(c.audio.muted,false);assert.equal(f.pcs.length,1);assert.equal(f.micCalls(),0);
 assert.equal(f.calls.filter(x=>x.path==='voice/session'||x.path==='voice/floor').length,0);
});

test('office cancels an unacknowledged receiver after its readiness deadline and releases the floor with microphone disabled',async t=>{
 const f=setup(t);f.client.peer=peer('office',true);f.client.state=state(f.client.peer);f.client.status={...f.client.status,state:f.client.state};
 const connection=f.client.connection.bind(f.client);f.client.connection=(...args)=>{const c=connection(...args);c.remoteReadyAck=true;return c;};
 const started=performance.now();await f.client.start('private','driver-a');await f.client.floorTask;
 assert.ok(performance.now()-started>=3400);assert.equal(f.track.enabled,false);assert.equal(f.client.floor,null);assert.equal(f.client.held,false);
 assert.equal(f.statuses.at(-1).pending,false);assert.match(f.statuses.at(-1).message,/تعذر تجهيز مسار الصوت/);
 assert.ok(f.calls.some(x=>x.path==='voice/release'&&x.body.floorId));
});

test('radio prepares a disabled microphone in parallel with its grant only after pressing; release stops the hardware',async t=>{
 const f=setup(t);f.client.automaticMicrophone();let microphone,grant,microphoneCalls=0;
 globalThis.navigator.mediaDevices.getUserMedia=()=>{microphoneCalls++;return new Promise(r=>microphone=r);};
 f.client.request=async(path,method,body)=>{f.calls.push({path,body});if(path==='voice/floor')return new Promise(r=>grant=r);return{};};
 assert.equal(microphoneCalls,0);const pressing=f.client.start('public');await new Promise(setImmediate);
 assert.equal(microphoneCalls,1);assert.equal(typeof grant,'function');microphone(f.stream);await new Promise(setImmediate);
 assert.equal(f.track.enabled,false);assert.equal(f.pcs.length,0);grant(floor('a'));await pressing;
 assert.equal(f.track.enabled,true);f.client.stop();assert.equal(f.track.stopped,true);assert.equal(f.track.enabled,false);
});

test('a denied parallel radio grant cancels a late capture result without attaching or sending it',async t=>{
 const f=setup(t);f.client.automaticMicrophone();let microphone;
 globalThis.navigator.mediaDevices.getUserMedia=()=>new Promise(r=>microphone=r);
 f.client.request=async(path)=>{if(path==='voice/floor')throw new Error('الموجة مشغولة');return{};};
 await f.client.start('private');microphone(f.stream);await new Promise(setImmediate);
 assert.equal(f.track.stopped,true);assert.equal(f.track.enabled,false);assert.equal(f.pcs.length,0);assert.equal(f.client.floor,null);assert.equal(f.client.captureRequested,false);
});
test('revoked permission and a busy public floor cannot acquire or enable a microphone',async t=>{
 const f=setup(t);f.client.state={...state(peer('a')),access:{...defaultVoiceAccess,canTalkPublic:false}};
 await f.client.start('public');assert.equal(f.micCalls(),0);assert.equal(f.calls.length,0);
 f.client.state=state(peer('a'),[floor('b')]);await f.client.start('public');assert.equal(f.micCalls(),0);assert.match(f.statuses.at(-1).message,/الموجة مشغولة/);
});
test('CanListen false refuses both public and private incoming media',async t=>{
 const f=setup(t);for(const channel of ['public','private']){const incoming=floor('office',channel);f.client.state={...state(peer('a'),[incoming]),access:{...defaultVoiceAccess,canListen:false}};await f.client.receive({floorId:incoming.id,from:'office',kind:'offer',data:'{"type":"offer","sdp":"opus"}'});}assert.equal(f.pcs.length,0);
});
test('incoming tones differ by channel and occur once per floor, not once per track event',t=>{
 const f=setup(t),beeps=[];f.client.beep=frequency=>beeps.push(frequency);
 for(const channel of ['public','private']){const incoming={...floor('office',channel),id:'incoming-'+channel};f.client.state=state(peer('a'),[incoming]);const c=f.client.connection('office',incoming,false);c.pc.ontrack({track:f.track,streams:[f.stream]});const audio=c.audio;c.pc.ontrack({track:f.track,streams:[f.stream]});assert.equal(c.audio,audio);}
 assert.deepEqual(beeps,['publicTone','privateTone']);
});
test('denied acquisition never enables media or plays the grant tone',async t=>{
 const f=setup(t),beeps=[];f.client.beep=frequency=>beeps.push(frequency);f.client.request=async()=>{throw Error('الموجة مشغولة - أحمد يتحدث')};await f.client.start('public');assert.equal(f.track.enabled,false);assert.equal(f.client.floor,null);assert.deepEqual(beeps,[]);assert.match(f.statuses.at(-1).message,/الموجة مشغولة/);
});
test('network failure retains signaling session and recovers automatically with refreshed permissions and no microphone acquisition',async t=>{
 const f=setup(t);f.client.controller=null;f.client.peer=null;const pending=[];let joins=0;const originalTimeout=globalThis.setTimeout;globalThis.setTimeout=(fn,ms,...args)=>ms>=1000&&ms<=1250?originalTimeout(fn,0,...args):originalTimeout(fn,ms,...args);
 f.client.request=async(path,method,body,signal)=>{if(path==='voice/session'){joins++;return {peer:peer('a'),iceServers:[]}}if(path.startsWith('voice/updates'))return new Promise((resolve,reject)=>{pending.push({resolve,reject});signal?.addEventListener('abort',()=>reject(Error('aborted')),{once:true})});return {}};
 const connecting=f.client.connect(),flush=()=>new Promise(setImmediate);
 try{await flush();pending.shift().resolve(state(peer('a')));await flush();assert.equal(f.statuses.at(-1).connected,true);pending.shift().reject(Error('offline'));await new Promise(r=>originalTimeout(r,10));assert.equal(joins,1);pending.shift().resolve({...state(peer('a')),access:{...defaultVoiceAccess,canTalkPublic:false}});await flush();assert.equal(f.statuses.at(-1).connected,true);assert.equal(f.statuses.at(-1).state.access.canTalkPublic,false);assert.equal(f.micCalls(),0);}finally{f.client.dispose();await connecting;globalThis.setTimeout=originalTimeout;}
});

test('speech negotiation caps Opus, enables loss recovery and preserves other codecs',()=>{
 const description={type:'offer',sdp:'v=0\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=0;stereo=1\r\na=rtpmap:0 PCMU/8000\r\n'};
 const result=voiceDescription(description);assert.match(result.sdp,/useinbandfec=1/);assert.match(result.sdp,/usedtx=1/);assert.match(result.sdp,/maxaveragebitrate=24000/);assert.match(result.sdp,/minptime=10/);assert.match(result.sdp,/a=rtpmap:0 PCMU\/8000/);assert.equal(voiceDescription(result).sdp,result.sdp);assert.match(description.sdp,/stereo=1/);
});
test('failed sender ICE renegotiates the same floor without acquiring another microphone',async t=>{
 const f=setup(t);await f.client.start('public');await new Promise(setImmediate);const pc=f.pcs[0],count=f.pcs.length,before=f.calls.filter(c=>c.path==='voice/signal').length;pc.connectionState='failed';pc.onconnectionstatechange();await new Promise(setImmediate);assert.equal(f.pcs.length,count);assert.equal(f.micCalls(),1);assert.equal(f.calls.filter(c=>c.path==='voice/floor').length,1);assert.equal(f.calls.filter(c=>c.path==='voice/signal').length,before+1);assert.equal(f.client.floor.id,'floor-a');
});

test('network change interrupts a stalled voice watch and keeps its existing session',async t=>{
 const f=setup(t);f.client.controller=null;f.client.peer=null;let joins=0,watches=0;
 f.client.request=async(path,method,body,signal)=>{if(path==='voice/session'){joins++;return {peer:peer('a'),iceServers:[]};}if(path.startsWith('voice/updates')){watches++;return new Promise((r,j)=>signal.addEventListener('abort',()=>j(Error('network changed')),{once:true}));}return {};};
 const connecting=f.client.connect();try{await new Promise(setImmediate);assert.equal(watches,1);f.client.networkChanged();await new Promise(r=>setTimeout(r,20));assert.equal(joins,1);assert.equal(watches,2);assert.equal(f.micCalls(),0);}finally{f.client.dispose();await connecting;}
});

test('driver setup gates floor requests and repeated prepared presses reuse one disabled microphone',async t=>{
 const f=setup(t);f.client.requirePreparation();await f.client.start('public');assert.equal(f.micCalls(),0);assert.equal(f.calls.length,0);
 await f.client.prepareMicrophone();assert.equal(f.statuses.at(-1).microphoneReady,true);assert.equal(f.track.enabled,false);
 for(let i=0;i<6;i++){await f.client.start(i%2?'private':'public');await new Promise(setImmediate);assert.equal(f.track.enabled,true);f.client.stop();assert.equal(f.track.enabled,false);assert.equal(f.track.stopped,false);}
 await f.client.floorTask;assert.equal(f.micCalls(),1);assert.equal(f.calls.filter(c=>c.path==='voice/floor').length,6);assert.equal(f.calls.filter(c=>c.path==='voice/release').length,6);
 f.client.releaseMicrophone();assert.equal(f.track.stopped,true);assert.equal(f.statuses.at(-1).microphoneReady,false);
});
test('prepared microphone is never enabled by a late floor grant after release',async t=>{
 const f=setup(t);f.client.requirePreparation();await f.client.prepareMicrophone();let grant;
 f.client.request=async(path,method,body)=>{f.calls.push({path,body});return path==='voice/floor'?new Promise(r=>grant=r):{};};
 const press=f.client.start('public');await new Promise(setImmediate);f.client.stop();grant(floor('a'));await press;
 assert.equal(f.track.enabled,false);assert.equal(f.track.stopped,false);assert.equal(f.client.floor,null);assert.ok(f.calls.some(c=>c.path==='voice/release'));
});
test('a permission result after call suspension stops its track and cannot resurrect prepared PTT',async t=>{
 const f=setup(t);let grant;navigator.mediaDevices.getUserMedia=()=>new Promise(r=>grant=r);
 const preparing=f.client.prepareMicrophone();f.client.suspendForCall();grant(f.stream);await preparing;
 assert.equal(f.track.stopped,true);assert.equal(f.client.stream,null);assert.equal(f.statuses.at(-1).microphoneReady,false);
 await f.client.start('public');assert.equal(f.calls.filter(c=>c.path==='voice/floor').length,0);
});
test('permission revocation releases prepared driver hardware and cancels transmission',async t=>{
 const f=setup(t);f.client.requirePreparation();await f.client.prepareMicrophone();await f.client.start('public');
 await f.client.apply({...state(peer('a'),[],8),access:{...defaultVoiceAccess,isVoiceBlocked:true}});
 assert.equal(f.track.stopped,true);assert.equal(f.track.enabled,false);assert.equal(f.client.stream,null);assert.equal(f.client.floor,null);assert.equal(f.statuses.at(-1).microphoneReady,false);
});

test('an unauthorized voice watch releases prepared hardware and cached media immediately',async t=>{
 const f=setup(t);await f.client.prepareMicrophone();f.client.controller=null;
 let rejectWatch;
 f.client.request=async(path,method,body,signal)=>path.startsWith('voice/updates')?new Promise((resolve,reject)=>{rejectWatch=reject;signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});}):{peer:peer('a'),iceServers:[]};
 const connecting=f.client.connect();
 try{await new Promise(setImmediate);rejectWatch(Object.assign(Error('revoked'),{status:403}));await new Promise(setImmediate);assert.equal(f.track.stopped,true);assert.equal(f.client.stream,null);assert.equal(f.client.connections.size,0);assert.equal(f.client.peer,null);}
 finally{f.client.dispose();await connecting;}
});
