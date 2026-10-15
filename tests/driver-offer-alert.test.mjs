import test from 'node:test';import assert from 'node:assert/strict';import {createDriverOfferAlert} from '../src/lib/driver-offer-alert.ts';
test('duplicate OrderId does not restart alert; expiry closes once and refreshes',()=>{
 const previous=setInterval,clear=clearInterval;let tick,refreshes=0,clock=100,closed=[];
 globalThis.setInterval=fn=>{tick=fn;return 1};globalThis.clearInterval=()=>{};
 try{const alert=createDriverOfferAlert({closeNotification:async id=>closed.push(id),now:()=>clock,refresh:()=>refreshes++});assert.equal(alert.offer({id:'one',expiresAt:200}),true);assert.equal(alert.offer({id:'one',expiresAt:200}),false);clock=201;tick();assert.equal(alert.currentId,null);assert.deepEqual(closed,['one']);assert.equal(refreshes,1);assert.equal(alert.offer({id:'one'}),false);alert.dispose();}finally{globalThis.setInterval=previous;globalThis.clearInterval=clear;}
});
