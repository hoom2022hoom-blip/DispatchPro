import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {customerMobile} from './helpers/customer-mobile.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
for(const audience of ['driver','customer'])test(audience+' official config and generated Debug/Release resources select the matching client',()=>{
 const source=read('firebase-config/'+audience+'-google-services.json.json');assert.equal(read('driver-android/app/src/'+audience+'/google-services.json'),source);const config=JSON.parse(source),client=config.client.find(c=>c.client_info.android_client_info.package_name==='com.dispatchpro.'+audience);assert.ok(client);assert.equal(config.project_info.project_id,'nablus-taxi');
 for(const build of ['Debug','Release']){const xml=read('driver-android/app/build/generated/res/process'+audience[0].toUpperCase()+audience.slice(1)+build+'GoogleServices/values/values.xml');assert.ok(xml.includes(client.client_info.mobilesdk_app_id));assert.ok(xml.includes(config.project_info.project_number));assert.ok(xml.includes('nablus-taxi'));const other=config.client.find(c=>c.client_info.android_client_info.package_name!=='com.dispatchpro.'+audience);if(other)assert.ok(!xml.includes(other.client_info.mobilesdk_app_id));}
});
 test('FCM callbacks bind their installation before rendering and retain authenticated resync',()=>{
 for(const audience of ['driver','customer']){const s=read('driver-android/app/src/'+audience+'/java/com/dispatchpro/driver/'+(audience==='driver'?'Driver':'Customer')+'MessagingService.java');assert.match(s,/PushEnvelopePolicy.accepts/);assert.match(s,/MobileSyncJob.schedule/);assert.match(s,/onNewToken/);assert.ok(s.indexOf("PushEnvelopePolicy.accepts")<s.indexOf("NativeCommunicationPush.display"));assert.doesNotMatch(s,/Notifications\.(show|cancelCall)/);}
});
test('customer notification routing fetches the requested ride and rejects wrong backend identity',async()=>{
 const id='11111111-1111-1111-1111-111111111111';const handlers=new Map([['GET rides/'+id,()=>({body:{id,rideStatus:'COMPLETED',pickup:'البيت',destination:'الجامعة'}})]]);const h=await customerMobile({handlers});
 await vm.runInContext('openNotificationRide("'+id+'")',h.context);assert.ok(h.calls.some(c=>c.url.endsWith('/rides/'+id)));assert.match(h.text(h.nodes.get('rides')),/الجامعة/);assert.equal(h.nodes.get('journey-map').open,true);
 h.state.rides=[{id:'33333333-3333-3333-3333-333333333333',rideStatus:'COMPLETED',destination:'other latest trip'}];h.context.hooks.watch();await h.flush();assert.match(h.text(h.nodes.get('rides')),/الجامعة/);assert.doesNotMatch(h.text(h.nodes.get('rides')),/other latest trip/);
 const before=h.text(h.nodes.get('rides'));handlers.set('GET rides/'+id,()=>({body:{id:'22222222-2222-2222-2222-222222222222',rideStatus:'COMPLETED',destination:'wrong'}}));await vm.runInContext('openNotificationRide("'+id+'")',h.context);assert.equal(h.text(h.nodes.get('rides')),before);
 const requests=h.calls.length;await vm.runInContext('openNotificationRide("malformed")',h.context);assert.equal(h.calls.length,requests);
});
test('native arrival keeps backend event and ride IDs for the common persistent dedupe and route',async()=>{
 const h=await customerMobile();const messages=[];h.context.testPort={postMessage:m=>messages.push(JSON.parse(m))};vm.runInContext('arrivalPort=testPort',h.context);
 const ride={id:'11111111-1111-1111-1111-111111111111',rideStatus:'DRIVER_ARRIVED',arrivalEventId:'22222222-2222-2222-2222-222222222222'};h.context.hooks.notifyArrival(ride);assert.deepEqual(JSON.parse(JSON.stringify(messages[0])),{type:'arrival-event',rideId:ride.id,eventId:ride.arrivalEventId,driverName:''});h.context.hooks.notifyArrival({...ride,arrivalAcknowledged:true});assert.deepEqual(messages[1],{type:'arrival-ack',eventId:ride.arrivalEventId});
});
test('status, arrival, chat, VoIP and PTT retain separate Android channels and sounds',()=>{
 const communication=read('driver-android/app/src/main/java/com/dispatchpro/driver/CommunicationNotifications.java');for(const channel of ['ride_chat_v2','ride_calls_v1','ride_ptt_v1'])assert.ok(communication.includes(channel));for(const sound of ['chat_message','incoming_call','ptt_alert'])assert.ok(communication.includes('R.raw.'+sound));assert.match(read('driver-android/app/src/main/java/com/dispatchpro/driver/CustomerRideNotifications.java'),/customer_ride_status_v1/);assert.match(read('driver-android/app/src/main/java/com/dispatchpro/driver/CustomerArrivalNotifications.java'),/customer_arrival_v1/);
});
