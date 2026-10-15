import test from 'node:test';
import assert from 'node:assert/strict';
import {customerMobile} from './helpers/customer-mobile.mjs';

test('customer account opens GPS and submits mapped destination with its own token only',async()=>{
 const app=await customerMobile({handlers:new Map([['POST rides',({init,state})=>{const body=JSON.parse(init.body);const ride={id:body.id,rideStatus:'SEARCHING_DRIVER',pickup:body.pickup.addressText,destination:body.destination};state.rides=[ride];return {body:ride};}]])});const {nodes,context,maps,calls}=app;let gpsRequests=0;
 context.navigator.geolocation={getCurrentPosition(ok){gpsRequests++;ok({coords:{latitude:32.22,longitude:35.25,accuracy:8},timestamp:Date.now()});}};
 assert.equal(gpsRequests,0,'Opening an account does not prompt for GPS');nodes.get('locate').onclick();assert.equal(gpsRequests,1);assert.equal(nodes.get('ride-form').elements.pickup.value,'موقعي الحالي');
 nodes.get('pick-destination').onclick();await app.flush();maps[0].onPick({latitude:32.23,longitude:35.27,locationSource:'MAP_PIN'});
 assert.equal(nodes.get('ride-form').elements.destination.value,'','Map points remain drafts');nodes.get('confirm-map').onclick();await app.submit('ride-form');
 assert.equal(calls.filter(c=>c.url.endsWith('/rides')).length,1);assert.equal(nodes.get('ride-summary').hidden,true);
 await nodes.get('confirm-ride').onclick();const request=calls.find(c=>c.url.endsWith('/rides'));assert.ok(request);assert.equal(request.init.headers.Authorization,'Bearer isolated-customer-token');
 const body=JSON.parse(request.init.body);assert.equal(body.pickup.locationSource,'CUSTOMER_GPS');assert.equal(body.pickup.latitude,32.22);assert.equal(body.destinationLocation.longitude,35.27);assert.ok(calls.every(c=>c.url.startsWith('/api/customer/')));
 nodes.get('ride-form').elements.pickup.oninput();await app.submit('ride-form');await nodes.get('confirm-ride').onclick();assert.equal(calls.filter(c=>c.url.endsWith('/rides')).length,1,'Repeated confirmation cannot create an additional request');assert.equal(nodes.get('journey-status').hidden,false);assert.match(nodes.get('journey-status').textContent,/البحث/);
});
