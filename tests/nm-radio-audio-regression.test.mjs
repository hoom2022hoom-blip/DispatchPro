import test from 'node:test';
import assert from 'node:assert/strict';
import {VoiceClient,defaultVoiceAccess} from '../src/lib/voice-client.ts';

const empty='00000000-0000-0000-0000-000000000000';
const office={id:'office',actorId:'o',office:true,driverId:null,name:'office'};
const self={id:'radio',actorId:'r',office:false,driverId:'driver',name:'radio'};
const view=(floors=[],access=defaultVoiceAccess)=>({self,peers:[self,office],floors,signals:[],revision:20,access,publicMuted:false,serverTime:new Date().toISOString()});
const floor=(id,speaker=self.id,channel='public')=>({id,speaker,channel,driverId:channel==='public'?null:self.driverId,name:speaker,revision:20,expiresAt:new Date(Date.now()+6000).toISOString()});
const flush=()=>new Promise(setImmediate);
function fixture(t){
 const saved={navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator'),Audio:globalThis.Audio,RTCPeerConnection:globalThis.RTCPeerConnection,RTCRtpSender:globalThis.RTCRtpSender};
 const calls=[],pcs=[];let microphones=0;
 const track={enabled:false,readyState:'live',stop(){this.readyState='ended';}},stream={getAudioTracks:()=>[track],getTracks:()=>[track]};
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>{microphones++;return stream;}}}});
 globalThis.Audio=class{muted=false;plays=0;pause(){}async play(){this.plays++;}};
 globalThis.RTCRtpSender={getCapabilities:()=>({codecs:[]})};
 globalThis.RTCPeerConnection=class{
  connectionState='connected';signalingState='stable';remoteDescription=null;localDescription=null;closed=false;offers=0;
  constructor(){pcs.push(this);}
  addTransceiver(){return {sender:{replaceTrack:async()=>{}},setCodecPreferences(){}};}
  async createOffer(){this.offers++;return {type:'offer',sdp:'test'};}async createAnswer(){return {type:'answer',sdp:'test'};}
  async setRemoteDescription(d){this.remoteDescription=d;}async setLocalDescription(d){this.localDescription=d;}
  async addIceCandidate(){}close(){this.closed=true;}
 };
 let sequence=0;
 const client=new VoiceClient(async(path,method,body)=>{calls.push({path,body});if(path==='voice/floor')return floor('floor-'+(++sequence),self.id,body.channel==='private'?'private:driver':'public');return {held:true};},()=>{});
 client.peer=self;client.state=view();client.controller=new AbortController();client.status={connected:true,state:client.state};client.requirePreparation();
 t.after(async()=>{client.dispose();await client.floorTask;if(saved.navigator)Object.defineProperty(globalThis,'navigator',saved.navigator);else delete globalThis.navigator;for(const key of ['Audio','RTCPeerConnection','RTCRtpSender'])globalThis[key]=saved[key];});
 return {client,calls,pcs,track,stream,microphones:()=>microphones};
}

test('cached receiver retains a late track silently when its old floor was released',async t=>{
 const f=fixture(t),old=floor('released','office');
 const c=f.client.connection('office',old,false);c.pc.ontrack({track:f.track,streams:[f.stream],receiver:{}});
 assert.equal(f.track.readyState,'live');assert.equal(c.audio.muted,true);
 await f.client.apply(view([floor('next','office')]));assert.equal(c.active,true);assert.equal(c.audio.muted,false);
});
test('new peers wait for matching receiver floor acknowledgement before enabling capture',async t=>{
 const f=fixture(t);await f.client.prepareMicrophone();f.client.transportWarmEnabled=true;
 const c=f.client.connection('office',floor(empty),true,true);c.pc.remoteDescription={type:'answer',sdp:'test'};c.remoteFloorBinding=true;c.remoteReadyAck=true;
 const channel={label:'floor-ready',readyState:'open',send(){},close(){}};f.client.floorChannel(c,channel);
 const start=f.client.start('public');await new Promise(r=>setTimeout(r,35));assert.equal(f.track.enabled,false);
 channel.onmessage({data:JSON.stringify({floorId:'old-floor'})});assert.equal(f.track.enabled,false);
 channel.onmessage({data:JSON.stringify({floorId:f.client.floor.id})});await start;assert.equal(f.track.enabled,true);assert.equal(f.client.metrics.pttReadyRecipients,1);
});
test('private floor acknowledgement is never sent for another driver',async t=>{
 const f=fixture(t),messages=[];const own=floor('own','office','private:driver');
 const c=f.client.connection('office',{...own,id:empty},false,true);c.pc.ontrack({track:f.track,streams:[f.stream],receiver:{}});
 f.client.floorChannel(c,{label:'floor-ready',readyState:'open',send:value=>messages.push(JSON.parse(value)),close(){}});
 await f.client.apply(view([{...own,id:'other',driverId:'other',channel:'private:other'}]));assert.equal(messages.length,0);
 await f.client.apply(view([own]));assert.ok(messages.some(x=>x.floorId==='own'));
});
test('receiver acknowledgement arriving before the HTTP grant is retained without authorizing capture',async t=>{
 const f=fixture(t);await f.client.prepareMicrophone();f.client.transportWarmEnabled=true;
 const c=f.client.connection('office',floor(empty),true,true);c.pc.remoteDescription={type:'answer',sdp:'test'};c.remoteFloorBinding=true;c.remoteReadyAck=true;
 const channel={label:'floor-ready',readyState:'open',send(){},close(){}};f.client.floorChannel(c,channel);
 channel.onmessage({data:JSON.stringify({floorId:'floor-1'})});assert.equal(f.client.floor,null);assert.equal(f.track.enabled,false);
 await f.client.start('public');assert.equal(f.client.floor.id,'floor-1');assert.equal(f.track.enabled,true);
});
test('listen-only radio warms incoming office transport without requesting microphone',async t=>{
 const f=fixture(t);f.client.transportWarmEnabled=true;
 await f.client.apply(view([],{...defaultVoiceAccess,canTalkPublic:false,canTalkPrivate:false}));
 assert.equal(f.microphones(),0);assert.equal(f.pcs.length,0);
 await f.client.receive({from:'office',floorId:empty,kind:'offer',channel:'public',warmSender:'office',data:JSON.stringify({type:'offer',sdp:'test',floorBinding:true})});
 const c=[...f.client.connections.values()][0];c.pc.ontrack({track:f.track,streams:[f.stream],receiver:{}});
 assert.equal(c.audio.muted,true);assert.equal(f.microphones(),0);
 const speaking=floor('office-1','office');await f.client.apply(view([speaking],{...defaultVoiceAccess,canTalkPublic:false,canTalkPrivate:false}));
 assert.equal(c.audio.muted,false);assert.equal(c.active,true);assert.equal(c.floorId,speaking.id);
 const access={...defaultVoiceAccess,canTalkPublic:false,canTalkPrivate:false};
 await f.client.apply(view([],access));assert.equal(c.audio.muted,true);assert.equal(c.active,false);
 await f.client.apply(view([floor('office-2','office')],access));assert.equal(c.active,true);assert.equal(f.pcs.length,1);assert.equal(f.microphones(),0);
});

test('cached private media cannot activate for a different driver or after listening revocation',async t=>{
 const f=fixture(t);const own=floor('own','office','private:driver');
 const c=f.client.connection('office',{...own,id:empty},false,true);c.pc.ontrack({track:f.track,streams:[f.stream],receiver:{}});
 const other={...floor('other','office','private:other'),driverId:'other'};
 await f.client.apply(view([other]));assert.equal(c.audio.muted,true);assert.equal(c.active,false);
 await f.client.apply(view([own]));assert.equal(c.audio.muted,false);
 await f.client.apply(view([own],{...defaultVoiceAccess,canListen:false}));assert.equal(c.pc.closed,true);assert.equal(c.audio.srcObject,null);
});

test('current peers reuse negotiated transports while older peers still receive per-floor SDP',async t=>{
 const f=fixture(t);await f.client.prepareMicrophone();f.client.transportWarmEnabled=true;
 // Preload one negotiated public transport to isolate the press path.
 const c=f.client.connection('office',floor(empty),true,true);c.pc.remoteDescription={type:'answer',sdp:'test'};c.remoteFloorBinding=true;
 await f.client.start('public');await flush();assert.equal(c.pc.offers,0);assert.equal(f.track.enabled,true);
 f.client.stop();assert.equal(f.track.enabled,false);await f.client.floorTask;
 await f.client.start('public');await flush();assert.equal(c.pc.offers,0);assert.equal(f.pcs.length,1);
 f.client.stop();await f.client.floorTask;c.remoteFloorBinding=false;
 await f.client.start('public');await flush();assert.equal(c.pc.offers,1);assert.ok(f.calls.some(c=>c.path==='voice/signal'&&JSON.parse(c.body.data).floorBinding));
});

test('rapid release and repress serialize a late grant release before acquiring the next floor',async t=>{
 const f=fixture(t);await f.client.prepareMicrophone();let grant;let requests=0;let old;
 f.client.request=async(path,method,body)=>{f.calls.push({path,body});if(path==='voice/floor'){requests++;if(requests===1)return new Promise(r=>grant=r);return floor('new');}return {};};
 old=f.client.start('public');await flush();f.client.stop();const next=f.client.start('private');await flush();assert.equal(requests,1);
 grant(floor('old'));await old;await next;await flush();
 assert.deepEqual(f.calls.filter(c=>c.path==='voice/floor'||c.path==='voice/release').map(c=>[c.path,c.body.floorId]),[['voice/floor',undefined],['voice/release','old'],['voice/floor',undefined]]);
 assert.equal(f.client.floor.id,'new');assert.equal(f.track.enabled,true);
});

test('late heartbeat failure from previous press cannot stop the next transmission',async t=>{
 const f=fixture(t);await f.client.prepareMicrophone();const original=setInterval,clear=clearInterval;let callback,reject;
 globalThis.setInterval=fn=>(callback=fn,1);globalThis.clearInterval=()=>{};
 try{
  await f.client.start('public');const old=f.client.floor.id;
  const request=f.client.request;f.client.request=(path,...args)=>path==='voice/heartbeat'&&args[1]?.floorId===old?new Promise((r,j)=>reject=j):request(path,...args);
  const heartbeat=callback();await flush();f.client.stop();await f.client.start('private');const current=f.client.floor.id;
  assert.notEqual(old,current);reject(Error('old network failure'));await heartbeat;
  assert.equal(f.client.floor.id,current);assert.equal(f.track.enabled,true);
 }finally{f.client.stop();globalThis.setInterval=original;globalThis.clearInterval=clear;}
});

test('release during sender detachment frees its accepted grant before a new press',async t=>{
 const f=fixture(t);await f.client.prepareMicrophone();let held=null,sequence=0,detach;
 f.client.request=async(path,method,body)=>{f.calls.push({path,body});if(path==='voice/floor'){held??=floor('lease-'+(++sequence),self.id,body.channel);return held;}if(path==='voice/release'&&held?.id===body.floorId)held=null;return {};};
 await f.client.start('public');f.client.stop();await f.client.floorTask;
 const c=[...f.client.connections.values()][0];c.mediaTask=new Promise(r=>detach=r);
 const waiting=f.client.start('public');await flush();assert.equal(f.client.floor.id,'lease-2');assert.equal(f.track.enabled,false);
 f.client.stop();const next=f.client.start('private');await flush();assert.equal(held.id,'lease-3');
 detach();await waiting;await next;assert.equal(f.client.floor.id,'lease-3');assert.equal(f.track.enabled,true);
});

test('network recovery preserves connected cached media and peer identity',async t=>{
 const f=fixture(t);const c=f.client.connection('office',floor(empty,'office'),false,true);const peer=f.client.peer;
 f.client.networkChanged();assert.equal(f.client.peer,peer);assert.equal(c.pc.closed,false);assert.equal(f.client.connections.size,1);
});

test('idle failed ICE restarts its silent transport without a floor or microphone',async t=>{
 const f=fixture(t);f.client.transportWarmEnabled=true;
 const c=f.client.connection('office',floor(empty),true,true);c.pc.connectionState='failed';c.pc.onconnectionstatechange();await flush();
 assert.equal(f.microphones(),0);assert.equal(f.client.floor,null);assert.equal(c.pc.offers,1);assert.equal(f.pcs.length,1);
 const signal=f.calls.find(x=>x.path==='voice/signal');assert.equal(signal.body.floorId,empty);assert.equal(signal.body.warmSender,self.id);
});

test('a stale watch still delivers a preparation answer without revoking a newer grant',async t=>{
 const f=fixture(t);await f.client.prepareMicrophone();await f.client.start('public');
 const c=[...f.client.connections.values()][0];
 await f.client.apply({...view(),revision:1,signals:[{from:'office',floorId:empty,kind:'answer',channel:'public',warmSender:self.id,data:JSON.stringify({type:'answer',sdp:'test',floorBinding:true})}]});
 assert.equal(f.client.floor.id,'floor-1');assert.equal(f.track.enabled,true);assert.equal(c.pc.remoteDescription.type,'answer');assert.equal(c.remoteFloorBinding,true);
});

test('audio focus loss releases capture but preserves reception session for regain',async t=>{const f=fixture(t);const c=f.client.connection('office',floor(empty,'office'),false,true);c.pc.ontrack({track:f.track,streams:[f.stream],receiver:{}});await f.client.apply(view([floor('incoming','office')]));assert.equal(c.audio.muted,false);const peer=f.client.peer;f.client.setAudioAvailable(false);assert.equal(c.audio.muted,true);assert.equal(c.pc.closed,false);assert.equal(f.client.peer,peer);await f.client.start('public');assert.equal(f.client.floor,null);assert.equal(f.microphones(),0);f.client.setAudioAvailable(true);await flush();assert.equal(c.audio.muted,false);assert.equal(c.pc.closed,false);});

test('first press during silent negotiation preserves the connection and accepts its answer',async t=>{
 const f=fixture(t);await f.client.prepareMicrophone();f.client.transportWarmEnabled=true;
 const c=f.client.connection('office',floor(empty),true,true);c.pc.signalingState='have-local-offer';
 const press=f.client.start('public');await flush();
 assert.equal(c.pc.closed,false,'pending warm offer must not be destroyed by the first press');
 await f.client.receive({from:'office',floorId:empty,kind:'answer',channel:'public',warmSender:self.id,data:JSON.stringify({type:'answer',sdp:'test',floorBinding:true})});
 c.pc.signalingState='stable';await press;assert.equal(f.pcs.length,1);assert.equal(f.track.enabled,true);
});

test('stale state after floor release cannot resurrect an incoming busy floor',async t=>{
 const f=fixture(t);await f.client.apply({...view(),revision:30});
 await f.client.apply({...view([floor('obsolete','office')]),revision:29});
 assert.equal(f.client.state.revision,30);assert.equal(f.client.state.floors.length,0);
});

test('release aborts a stalled acquisition and sends its cancellation before the next press',async t=>{
 const f=fixture(t);await f.client.prepareMicrophone();f.client.cancellableFloor=true;let requests=0;
 f.client.request=async(path,method,body,signal)=>{f.calls.push({path,body});if(path==='voice/floor'){
  if(++requests===1)return new Promise((r,j)=>signal.addEventListener('abort',()=>j(new DOMException('Aborted','AbortError')),{once:true}));
  return floor('next',self.id,'private:driver');
 }return {};};
 const old=f.client.start('public');await flush();const oldAttempt=f.calls.find(c=>c.path==='voice/floor').body.attemptId;
 f.client.stop();const next=f.client.start('private');await old;await next;
 assert.equal(f.client.floor.id,'next');assert.equal(f.track.enabled,true);
 const cancel=f.calls.find(c=>c.path==='voice/release'&&c.body.attemptId===oldAttempt);assert.ok(cancel);
 assert.ok(f.calls.indexOf(cancel)<f.calls.findIndex(c=>c.path==='voice/floor'&&c.body.channel==='private'));
});

test('20 prepared presses alternate public/private with one grant and one release per press',async t=>{
 const f=fixture(t);await f.client.prepareMicrophone();f.client.transportWarmEnabled=true;
 const c=f.client.connection('office',floor(empty),true,true);c.remoteFloorBinding=true;c.pc.remoteDescription={type:'answer',sdp:'test'};
 for(let i=0;i<20;i++){
  await f.client.start(i%2?'private':'public');assert.equal(f.track.enabled,true);assert.equal(f.client.transmitting,true);
  f.client.stop();assert.equal(f.track.enabled,false);await f.client.floorTask;
 }
 assert.equal(f.calls.filter(c=>c.path==='voice/floor').length,20);assert.equal(f.calls.filter(c=>c.path==='voice/release').length,20);
 assert.equal(new Set(f.calls.filter(c=>c.path==='voice/floor').map(c=>c.body.attemptId)).size,20);assert.equal(f.microphones(),1);
});

test('expired public floor cannot block the first valid press',async t=>{
 const f=fixture(t);await f.client.prepareMicrophone();f.client.state=view([{...floor('expired','office'),expiresAt:new Date(Date.now()-1).toISOString()}]);
 await f.client.start('public');assert.equal(f.track.enabled,true);assert.ok(f.client.floor);
});
