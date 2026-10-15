import test from 'node:test';
import assert from 'node:assert/strict';
import {receptionRenderHooks} from './helpers/reception-render.mjs';
const hooks=receptionRenderHooks();
const {fleetFeatures,fleetDiff,fleetRenderKey,hasFleetDiff,interpolatedFleetFeature,withFleetOverlay}=await import('../src/lib/fleet-map-render.ts');
const {mapPlaceResults}=await import('../src/lib/map-place-search.ts');hooks.deregister();
const at=Date.parse('2026-10-15T10:00:00Z');
const fleet=()=>Array.from({length:100},(_,i)=>({id:'qa-'+i,fullName:'QA vehicle '+i,active:true,status:'Available',currentRide:null,waitingCount:0,locationStatus:'FRESH',location:{latitude:32.22+i*.0001,longitude:35.25,accuracy:5,updatedAt:new Date(at).toISOString()}}));
test('staggered GPS updates preserve other vehicles animation and stop at confirmed coordinates',()=>{
 const feature=fleetFeatures(fleet(),null,at,120)[0],target={...feature,geometry:{...feature.geometry,coordinates:[35.251,32.22]}},transitions=new Map([[feature.id,{origin:[35.25,32.22],started:0}]]);
 const halfway=interpolatedFleetFeature(target,transitions,325);assert.equal(halfway.geometry.coordinates[0],35.2505);
 transitions.set('another-car',{origin:[35.3,32.2],started:325});assert.ok(interpolatedFleetFeature(target,transitions,400).geometry.coordinates[0]>35.2505);
 assert.deepEqual(interpolatedFleetFeature(target,transitions,700).geometry.coordinates,target.geometry.coordinates);assert.equal(transitions.has(feature.id),false);
});
test('100 isolated vehicles: only changed geometry/status is sent; stationary updates send no source traffic',()=>{
 const drivers=fleet(),before=fleetFeatures(drivers,null,at,120),cache=new Map(before.map(f=>[f.id,f]));assert.equal(before.length,100);assert.equal(hasFleetDiff(fleetDiff(cache,fleetFeatures(drivers,null,at+1000,120))),false);
 drivers[40]={...drivers[40],status:'Busy',location:{...drivers[40].location,longitude:35.251}};
 const next=fleetFeatures(drivers,null,at+1000,120),diff=fleetDiff(cache,next);assert.equal(diff.update.length,1);assert.equal(diff.update[0].id,'qa-40');assert.deepEqual(diff.update[0].newGeometry.coordinates,[35.251,drivers[40].location.latitude]);assert.equal(diff.add.length,0);assert.equal(diff.remove.length,0);assert.ok(JSON.stringify(diff).length<JSON.stringify({type:'FeatureCollection',features:next}).length/20);
});
test('selection, speaker, deletions, stale GPS and invalid accuracy do not invent positions',()=>{
 const drivers=fleet(),before=fleetFeatures(drivers,null,at,120),cache=new Map(before.map(f=>[f.id,f]));let next=fleetFeatures(drivers,'qa-1',at,120,'qa-2');assert.equal(fleetDiff(cache,next).update.length,2);assert.equal(next[2].properties.talking,true);
 drivers[0].location.accuracy=200;next=fleetFeatures(drivers,null,at,120);assert.equal(next[0].properties.icon,'taxi-gray');assert.deepEqual(next[0].geometry.coordinates,before[0].geometry.coordinates);assert.equal(next[0].properties.fresh,false);
 assert.ok(fleetFeatures(drivers,null,at+121000,120).every(f=>!f.properties.fresh));drivers[1].location.latitude=91;drivers[2].location=null;assert.deepEqual(fleetDiff(cache,fleetFeatures(drivers,null,at,120)).remove,['qa-1','qa-2']);
});
test('search uses supplied Arabic or English names and valid map geometry without fabricated addresses',()=>{
 const features=[{properties:{'name:ar':'نابلس','name:en':'Nablus'},geometry:{type:'Point',coordinates:[35.25,32.22]}},{properties:{'name:ar':'شارع الجامعة','name:en':'University street'},geometry:{type:'LineString',coordinates:[[35.25,32.22],[35.26,32.23]]}},{properties:{name:'Invalid'},geometry:{type:'Point',coordinates:[NaN,95]}}];
 assert.equal(mapPlaceResults(features,'Nablus')[0].name,'نابلس');assert.equal(mapPlaceResults(features,'الجامعة')[0].longitude,35.26);assert.equal(mapPlaceResults(features,'غير مسجل').length,0);assert.equal(mapPlaceResults(features,'Invalid').length,0);
});

test('1000 vehicles preserve 999 stationary entries when one GPS fix changes',()=>{
 const drivers=Array.from({length:10},(_,group)=>fleet().map((d,i)=>({...d,id:`qa-${group*100+i}`}))).flat();
 const before=fleetFeatures(drivers,null,at,120),cache=new Map(before.map(f=>[f.id,f]));
 drivers[501]={...drivers[501],location:{...drivers[501].location,longitude:35.252}};
 const diff=fleetDiff(cache,fleetFeatures(drivers,null,at+1000,120));
 assert.equal(before.length,1000);assert.equal(diff.update.length,1);assert.equal(diff.update[0].id,'qa-501');assert.equal(diff.add.length,0);assert.equal(diff.remove.length,0);
 assert.ok(JSON.stringify(diff).length<JSON.stringify(before).length/200);
});

test('recorded heading is normalized, updated incrementally and hidden for stale GPS',()=>{
 const drivers=fleet();drivers[0].recordedHeading=450;
 const initial=fleetFeatures(drivers,null,at,120);assert.equal(initial[0].properties.heading,90);
 drivers[0].recordedHeading=180;const next=fleetFeatures(drivers,null,at,120);
 assert.equal(fleetDiff(new Map(initial.map(f=>[f.id,f])),next).update.length,1);
 assert.equal(fleetFeatures(drivers,null,at+121000,120)[0].properties.heading,0);
});

test('stationary heartbeat timestamps and unrelated metadata do not invalidate rendered geometry',()=>{
 const drivers=fleet().map(d=>({...d,previousLocation:null})),key=fleetRenderKey(drivers,at,120);
 const refreshed=drivers.map(d=>({...d,fullName:'Updated name',location:{...d.location,updatedAt:new Date(at+1000).toISOString()}}));
 assert.equal(fleetRenderKey(refreshed,at+1000,120),key);assert.notEqual(fleetRenderKey(refreshed,at+122000,120),key);
 refreshed[0].location.longitude+=.001;assert.notEqual(fleetRenderKey(refreshed,at+1000,120),key);
});
test('close zoom separates vehicles and clusters have independent touch targets',()=>{
 const style=withFleetOverlay({version:8,sources:{},layers:[]});
 assert.equal(style.sources['office-taxis'].clusterMaxZoom,13);assert.equal(style.sources['office-taxis'].clusterRadius,56);
 assert.equal(style.layers.find(l=>l.id==='office-taxi-cluster-hit').paint['circle-radius'],24);
 assert.notEqual(style.layers.find(l=>l.id==='office-taxi-clusters').paint['circle-color'],'#1d4ed8');
});
test('unknown device connectivity stays visually unknown and zero placeholders are omitted',()=>{
 const rows=fleet();rows[0].connectionStatus='unknown';rows[0].status='Offline';assert.equal(fleetFeatures(rows,null,at,120)[0].properties.icon,'taxi-gray');
 rows[1].location={...rows[1].location,latitude:0,longitude:0};assert.equal(fleetFeatures(rows,null,at,120).length,99);
});
