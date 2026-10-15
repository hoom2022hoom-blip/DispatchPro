import test from 'node:test';
import assert from 'node:assert/strict';
import {VoiceClient,defaultVoiceAccess} from '../src/lib/voice-client.ts';
const tick=()=>new Promise(setImmediate),empty='00000000-0000-0000-0000-000000000000';
function fixture(t){
 const originals={navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator'),Audio:globalThis.Audio,RTCPeerConnection:globalThis.RTCPeerConnection,RTCRtpSender:globalThis.RTCRtpSender};
 const self={id:'self',actorId:'actor',office:false,driverId:'driver',name:'self'},office={id:'office',office:true,driverId:null,name:'office'};
 const track={enabled:false,readyState:'live',stop(){this.readyState='ended';}},stream={getAudioTracks:()=>[track],getTracks:()=>[track]},pcs=[],calls=[],statuses=[];
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>stream}}});
 globalThis.Audio=class{pause(){}async play(){}};globalThis.RTCRtpSender={getCapabilities:()=>({codecs:[]})};
 globalThis.RTCPeerConnection=class{connectionState='connected';signalingState='stable';remoteDescription=null;constructor(){pcs.push(this);}addTransceiver(){return {sender:{replaceTrack:async()=>{}},setCodecPreferences(){}};}async createOffer(){return {type:'offer',sdp:'test'};}async setLocalDescription(d){this.localDescription=d;}close(){this.closed=true;}};
 let sequence=0;
 const client=new VoiceClient(async(path,method,body)=>{calls.push({path,body});return path==='voice/floor'?{id:'floor-'+(++sequence),speaker:self.id,channel:body.channel,revision:10,expiresAt:new Date(Date.now()+6000).toISOString()}:{held:true};},s=>statuses.push(s));
 client.controller=new AbortController();client.peer=self;client.state={revision:10,self,peers:[self,office],floors:[],signals:[],access:defaultVoiceAccess,serverTime:new Date().toISOString()};client.status={connected:true};
 t.after(async()=>{client.dispose();await client.floorTask;Object.defineProperty(globalThis,'navigator',originals.navigator);for(const k of ['Audio','RTCPeerConnection','RTCRtpSender'])globalThis[k]=originals[k];});
 return {client,track,stream,pcs,calls,statuses,self,office};
}
test('UI never reports speaking while granted audio is still being prepared',async t=>{
 const f=fixture(t);let microphone;f.client.automaticMicrophone();navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>microphone=resolve);
 const start=f.client.start('public');await tick();assert.ok(f.client.floor);assert.ok(f.client.heartbeat);assert.equal(f.statuses.at(-1).talking,null);assert.equal(f.statuses.at(-1).pending,true);
 f.client.stop();microphone(f.stream);await start;assert.equal(f.track.enabled,false);assert.equal(f.client.floor,null);assert.equal(f.statuses.at(-1).pending,false);
});
test('unreachable signaling listener does not delay an already connected listener',async t=>{
 const f=fixture(t);f.client.state.peers.push({id:'bad',driverId:'bad',office:false});const original=f.client.request;
 f.client.request=(path,method,body)=>path==='voice/signal'&&body.to==='bad'?new Promise(()=>{}):original(path,method,body);
 const began=performance.now();await f.client.start('public');assert.ok(performance.now()-began<1000);assert.equal(f.track.enabled,true);assert.ok(f.statuses.at(-1).talking);
});
test('each transmission has a UUID and grant timing excludes delayed microphone capture',async t=>{
 const f=fixture(t);f.client.automaticMicrophone();navigator.mediaDevices.getUserMedia=async()=>{await new Promise(r=>setTimeout(r,90));return f.stream;};
 await f.client.start('public');const first=f.calls.find(c=>c.path==='voice/floor').body.attemptId;assert.match(first,/^[a-f0-9-]{36}$/);assert.ok(f.client.metrics.pttFloorGrantMs<50);assert.ok(f.client.metrics.pttPressToMicrophoneMs>=80);
 f.client.stop();f.track.readyState='live';await f.client.start('public');assert.notEqual(f.calls.filter(c=>c.path==='voice/floor').at(-1).body.attemptId,first);
});
test('silent preparation reaches all 50 drivers for office and stays bounded on a driver',async t=>{
 const f=fixture(t);const peers=Array.from({length:50},(_,i)=>({id:'driver-'+i,driverId:'d-'+i,office:false}));f.client.transportWarmEnabled=true;f.client.peer=f.office;f.client.state.peers=[f.office,...peers];
 f.client.warmConnections();await tick();assert.equal(f.pcs.length,100);assert.ok(f.calls.some(c=>c.path==='voice/signal'&&c.body.to==='driver-49'));
 f.client.clearConnections();f.client.peer=f.self;f.client.state.peers=[f.self,f.office,...peers];f.client.warmConnections();await tick();assert.equal(f.client.connections.size,2);assert.equal(f.track.enabled,false);
});
test('public and private reuse one transport only when both peers advertise multiplexing',async t=>{
 const f=fixture(t);f.client.multiplexedTransport=true;f.client.transportWarmEnabled=true;f.office.multiplexed=true;
 f.client.warmConnections();await tick();assert.equal(f.client.connections.size,1);const cached=[...f.client.connections.values()][0];cached.remoteFloorBinding=true;cached.pc.remoteDescription={type:'answer',sdp:'test'};
 await f.client.start('public');f.client.stop();await f.client.floorTask;await f.client.start('private');assert.equal(f.client.connections.size,1);assert.equal([...f.client.connections.values()][0],cached);assert.equal(f.track.enabled,true);
 f.client.stop();await f.client.floorTask;f.office.multiplexed=false;f.client.clearConnections();f.client.warmConnections();await tick();assert.equal(f.client.connections.size,2);
});
