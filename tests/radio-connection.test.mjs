import test from 'node:test';import assert from 'node:assert/strict';
import {radioResponse,radioPollDelay,radioTemporaryError,radioReady} from '../driver-android/web/radio-connection.ts';
import {VoiceClient,defaultVoiceAccess} from '../src/lib/voice-client.ts';
test('radio gateway errors preserve status while withholding raw Cloudflare HTML and JSON',async()=>{
 for(const body of ['<html>The origin web server returned an invalid or incomplete response to Cloudflare</html>',JSON.stringify({detail:'The origin web server returned an invalid or incomplete response to Cloudflare'})]){const r=await radioResponse(new Response(body,{status:520}));assert.equal(r.status,520);assert.deepEqual(await r.json(),{error:radioTemporaryError});}
 const busy=new Response(JSON.stringify({error:'الموجة مشغولة'}),{status:409});assert.equal(await radioResponse(busy),busy);
});
test('radio polls back off after failures and return to the normal interval after success',()=>{assert.deepEqual([0,1,2,3,9].map(radioPollDelay),[20000,20000,40000,60000,60000]);});
test('radio readiness needs current control state and both permitted office audio directions',()=>{
 const v=new VoiceClient(async()=>{},()=>{});v.status.connected=true;v.peer={id:'radio',office:false};v.state={self:v.peer,peers:[{id:'office',office:true}],floors:[],access:defaultVoiceAccess};
 const status={connected:true,state:v.state};assert.equal(radioReady(v,status,true,true),false);
 v.connections.set('in',{peerId:'office',outgoing:false,pc:{connectionState:'connected'}});assert.equal(radioReady(v,status,true,true),false);
 v.connections.set('out',{peerId:'office',outgoing:true,pc:{connectionState:'connected'}});assert.equal(radioReady(v,status,true,true),true);
 v.connections.get('in').pc.connectionState='disconnected';assert.equal(radioReady(v,status,true,true),false);
 v.connections.get('in').pc.connectionState='connected';assert.equal(radioReady(v,{...status,connected:false},true,true),false);
 assert.equal(radioReady(v,status,true,false),false);v.state.peers=[];assert.equal(radioReady(v,status,true,true),false);
});
