import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('customer Safari fallback cancels requests without AbortSignal.any/timeout',()=>{
 class Signal extends EventTarget {aborted=false;}
 class Controller {signal=new Signal();abort(){this.signal.aborted=true;this.signal.dispatchEvent(new Event('abort'));}}
 const timers=[];
 const source=readFileSync(new URL('../public/customer-mobile/app.js',import.meta.url),'utf8').replace(/^import .*\r?\n/gm,'').split('const $=')[0];
 const context={AbortSignal:Signal,AbortController:Controller,setTimeout:fn=>timers.push(fn)};
 vm.runInNewContext(source,context);
 const a=new Controller(),b=new Controller();const combined=Signal.any([a.signal,b.signal]);
 assert.equal(combined.aborted,false);b.abort();assert.equal(combined.aborted,true);
 assert.equal(Signal.any([b.signal]).aborted,true);
 const timeout=Signal.timeout(35);assert.equal(timeout.aborted,false);timers[0]();assert.equal(timeout.aborted,true);
});

test('both mobile entrypoints use standard web APIs and iPhone safe areas',()=>{
 for(const app of ['customer','driver']){
  const html=readFileSync(new URL(`../public/${app}-mobile/index.html`,import.meta.url),'utf8');
  const css=readFileSync(new URL(`../public/${app}-mobile/app.css`,import.meta.url),'utf8');
  assert.match(html,/dir="rtl"/);assert.match(html,/viewport-fit=cover/);
  assert.doesNotMatch(html,/maximum-scale=1|user-scalable=no/);
  for(const edge of ['top','right','bottom','left'])assert.match(css,new RegExp(`safe-area-inset-${edge}`));
 }
 for(const path of ['public/customer-mobile/app.js','driver-mobile/main.tsx','src/lib/driver-api.ts','src/lib/driver-location.ts']){
  assert.doesNotMatch(readFileSync(new URL('../'+path,import.meta.url),'utf8'),/window\.Android|AndroidBridge|intent:\/\/|adb reverse|navigator\.userAgent.*Android/);
 }
});
