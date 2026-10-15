import test from 'node:test';
import assert from 'node:assert/strict';
import {mapFocusDuration} from '../src/lib/map-camera.ts';
test('off-screen selection avoids intermediate fly-over tiles; nearby selection stays animated',()=>{
 assert.equal(mapFocusDuration({x:300,y:200},780,620),450);
 for(const point of [{x:-1,y:200},{x:781,y:200},{x:300,y:621},{x:NaN,y:10}])assert.equal(mapFocusDuration(point,780,620),0);
});
test('nearby selection respects reduced motion',()=>{
 const previous=globalThis.window;try{globalThis.window={matchMedia:()=>({matches:true})};assert.equal(mapFocusDuration({x:50,y:50},393,740),0);}finally{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});
