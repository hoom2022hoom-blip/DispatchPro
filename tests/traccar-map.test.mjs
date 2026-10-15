import test from 'node:test';import assert from 'node:assert/strict';
import {latestTraccarPositions,recordedSpeedLabel} from '../src/lib/traccar-map.ts';
const row=(id,time,extra={})=>({id,deviceId:1,valid:true,latitude:32.22,longitude:35.25,fixTime:time,serverTime:time,...extra});
test('one latest valid fix per device is selected independently of history response order',()=>{
 const older=row(1,'2026-10-15T10:00:00Z'),newer=row(2,'2026-10-15T10:01:00Z');
 for(const rows of [[newer,older],[older,newer]]){const result=latestTraccarPositions([...rows,row(3,'2026-10-15T10:02:00Z',{deviceId:2})]);assert.equal(result.size,2);assert.equal(result.get(1).id,2);}
});
test('invalid and placeholder later fixes do not replace recorded valid coordinates',()=>{
 const valid=row(1,'2026-10-15T10:00:00Z');const result=latestTraccarPositions([valid,row(2,'2026-10-15T10:01:00Z',{valid:false}),row(3,'2026-10-15T10:02:00Z',{latitude:91}),row(4,'2026-10-15T10:03:00Z',{latitude:0,longitude:0})]);assert.equal(result.size,1);assert.equal(result.get(1),valid);
});
test('missing GPS time stays missing and unavailable speed is not presented as a stopped vehicle',()=>{
 const record=row(1,'',{serverTime:'2026-10-15T10:00:00Z'});assert.equal(latestTraccarPositions([record]).get(1).fixTime,'');assert.equal(recordedSpeedLabel(undefined),'غير متاحة');assert.equal(recordedSpeedLabel(NaN),'غير متاحة');assert.equal(recordedSpeedLabel(-1),'غير متاحة');assert.equal(recordedSpeedLabel(0),'0 كم/س');assert.equal(recordedSpeedLabel(10),'19 كم/س');
});
