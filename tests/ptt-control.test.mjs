import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {receptionRenderHooks} from './helpers/reception-render.mjs';
import {defaultVoiceAccess} from '../src/lib/voice-client.ts';
test('hold button handles pointer cancellation, keyboard repeat and lost focus',async()=>{
 const hooks=receptionRenderHooks();let view;const calls=[];
 try{
  const {PttButton}=await import('../src/components/ptt-control.tsx');
  const client={start:(...args)=>calls.push(args),stop:()=>calls.push('stop'),unlock:()=>calls.push('listen')};
  const status={connected:true,talking:null,state:{self:{office:true},access:defaultVoiceAccess},needsPlayback:false};
  await act(async()=>{view=TestRenderer.create(React.createElement(PttButton,{client,status,channel:'private',driverId:'selected'},'خاص'));});
  const button=view.root.findByType('button');
  await act(async()=>button.props.onPointerDown({button:0,pointerId:1,preventDefault(){},currentTarget:{setPointerCapture(){}}}));
  assert.deepEqual(calls.at(-1),['private','selected']);
  await act(async()=>button.props.onPointerCancel());assert.equal(calls.at(-1),'stop');
  const before=calls.length;await act(async()=>button.props.onKeyDown({key:' ',repeat:true,preventDefault(){}}));assert.equal(calls.length,before);
  await act(async()=>button.props.onKeyDown({key:'Enter',repeat:false,preventDefault(){}}));assert.deepEqual(calls.at(-1),['private','selected']);
  await act(async()=>button.props.onKeyUp({key:'Enter',preventDefault(){}}));assert.equal(calls.at(-1),'stop');
  await act(async()=>button.props.onLostPointerCapture());assert.equal(calls.at(-1),'stop');
  await act(async()=>button.props.onBlur());assert.equal(calls.at(-1),'stop');
 }finally{await act(async()=>view?.unmount());hooks.deregister();}
});
test('listening-only user cannot acquire a microphone or floor through forbidden PTT buttons',async()=>{
 const hooks=receptionRenderHooks();let view;let starts=0,unlocks=0;
 try{
  const {PttButton,DriverVoice}=await import('../src/components/ptt-control.tsx');
  const client={start:()=>starts++,stop(){},unlock:()=>unlocks++};
  const status={connected:true,talking:null,needsPlayback:true,state:{self:{office:false},access:{...defaultVoiceAccess,canTalkPublic:false,canTalkPrivate:false}}};
  await act(async()=>{view=TestRenderer.create(React.createElement(PttButton,{client,status,channel:'public'},'عام'));});
  const button=view.root.findByType('button');assert.equal(button.props.disabled,true);
  await act(async()=>button.props.onPointerDown({button:0,pointerId:1,preventDefault(){},currentTarget:{}}));assert.equal(starts,0);assert.equal(unlocks,1);
  await act(async()=>view.update(React.createElement(DriverVoice,{request:undefined})));
  assert.equal(view.root.findAllByType('button').length,2);
 }finally{await act(async()=>view?.unmount());hooks.deregister();}
});
test('server permissions disable the appropriate driver channel and block all transmission',async()=>{
 const hooks=receptionRenderHooks();let view,starts=0;
 try{const {PttButton}=await import('../src/components/ptt-control.tsx');const client={start(){starts++},stop(){},unlock(){}};
 for(const [access,channel] of [[{canTalkPublic:false},'public'],[{canTalkPrivate:false},'private'],[{voiceEnabled:false},'public'],[{isVoiceBlocked:true},'private']]){
 const status={connected:true,talking:null,needsPlayback:false,state:{self:{office:false},access:{...defaultVoiceAccess,...access}}};
 await act(async()=>{view?.unmount();view=TestRenderer.create(React.createElement(PttButton,{client,status,channel},'PTT'))});const button=view.root.findByType('button');assert.equal(button.props.disabled,true);await act(async()=>button.props.onPointerDown({button:0,pointerId:1,preventDefault(){},currentTarget:{}}));assert.equal(starts,0);
 }}finally{await act(async()=>view?.unmount());hooks.deregister();}
});

test('circular controls keep hold/release semantics and only mark the granted channel pressed',async()=>{
 const hooks=receptionRenderHooks();let view;let holding=false,starts=0,stops=0;
 try{
  const {PttButton}=await import('../src/components/ptt-control.tsx');
  const client={unlock(){},isHolding:()=>holding,start(){starts++;holding=true;},stop(){stops++;holding=false;}};
  const status={connected:true,pending:true,talking:null,state:{self:{office:true,driverId:null},access:defaultVoiceAccess},needsPlayback:false};
  const render=(channel,extra={})=>React.createElement(PttButton,{client,status:{...status,...extra},channel,appearance:channel==='public'?'public-dial':'private-dial'},channel);
  await act(async()=>{view=TestRenderer.create(render('public'));});let button=view.root.findByType('button');
  assert.equal(button.props['aria-pressed'],false);assert.equal(button.props['aria-busy'],true);assert.match(button.props.className,/ptt-dial-public/);
  await act(async()=>button.props.onKeyDown({key:' ',repeat:false,preventDefault(){}}));assert.equal(starts,1);
  await act(async()=>button.props.onKeyDown({key:'Enter',repeat:false,preventDefault(){}}));assert.equal(starts,1);
  await act(async()=>button.props.onKeyUp({key:' ',preventDefault(){}}));assert.equal(stops,1);
  await act(async()=>view.update(render('private',{pending:false,talking:{channel:'public',driverId:null}})));button=view.root.findByType('button');assert.equal(button.props['aria-pressed'],false);
  await act(async()=>view.update(render('public',{pending:false,talking:{channel:'public',driverId:null}})));assert.equal(view.root.findByType('button').props['aria-pressed'],true);
 }finally{await act(async()=>view?.unmount());hooks.deregister();}
});

test('a held UI request is released once when disconnected or channel permission is removed',async()=>{
 const hooks=receptionRenderHooks();let view;try{
  const {PttButton}=await import('../src/components/ptt-control.tsx');
  for(const loss of ['disconnect','permission']){let starts=0,stops=0,held=false;const client={unlock(){},isHolding:()=>held,start(){held=true;starts++;},stop(source){assert.equal(source,'ui');held=false;stops++;}};
   const status={connected:true,talking:null,needsPlayback:false,state:{self:{office:false},access:{...defaultVoiceAccess,canTalkPrivate:true}}};
   const render=s=>React.createElement(PttButton,{client,status:s,channel:'private',driverId:'qa-only'},'QA');
   await act(async()=>{view=TestRenderer.create(render(status));});let b=view.root.findByType('button');assert.equal(b.props.onClick,undefined);
   await act(async()=>b.props.onPointerDown({button:0,pointerId:1,preventDefault(){},currentTarget:{setPointerCapture(){}}}));assert.equal(starts,1);
   await act(async()=>b.props.onPointerUp({pointerId:2}));assert.equal(stops,0);
   await act(async()=>view.update(render(loss==='disconnect'?{...status,connected:false}:{...status,state:{...status.state,access:{...status.state.access,canTalkPrivate:false}}})));
   b=view.root.findByType('button');assert.equal(b.props.disabled,true);assert.equal(stops,1);
   await act(async()=>b.props.onPointerCancel());await act(async()=>b.props.onLostPointerCapture());await act(async()=>view.unmount());assert.equal(stops,1);
  }
 }finally{await act(async()=>view?.unmount());hooks.deregister();}
});

test('unmounting a held public control releases its UI request without any media client',async()=>{
 const hooks=receptionRenderHooks();let view,stops=0;try{const {PttButton}=await import('../src/components/ptt-control.tsx');const client={unlock(){},start(){},stop(){stops++;}};const status={connected:true,needsPlayback:false,state:{self:{office:true},access:defaultVoiceAccess}};
 await act(async()=>{view=TestRenderer.create(React.createElement(PttButton,{client,status,channel:'public'},'QA'));});await act(async()=>view.root.findByType('button').props.onKeyDown({key:' ',repeat:false,preventDefault(){}}));await act(async()=>view.unmount());assert.equal(stops,1);
 }finally{await act(async()=>view?.unmount());hooks.deregister();}
});
