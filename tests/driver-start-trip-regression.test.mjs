import test from 'node:test';
import assert from 'node:assert/strict';
import {driverTripMetrics} from '../src/lib/driver-trip-metrics.ts';

test('Start Trip GPS meter renders before its first sample, with nulls and invalid timestamps',()=>{
 const ride={id:'fixture',status:'InProgress',fareMode:'GPS_METER',distanceKm:null,durationSeconds:null,meterStartedAt:null,meterCalculatedFare:null};
 assert.deepEqual(driverTripMetrics(ride,Date.now()),{distance:'0.0',minutes:0,fare:null});
 assert.deepEqual(driverTripMetrics({...ride,distanceKm:'invalid',durationSeconds:NaN,meterStartedAt:'invalid',meterCalculatedFare:Infinity},NaN),{distance:'0.0',minutes:0,fare:null});
 assert.deepEqual(driverTripMetrics({...ride,distanceKm:2.5,durationSeconds:600,meterStartedAt:'2026-10-06T10:00:00Z',meterCalculatedFare:23},Date.parse('2026-10-06T10:12:00Z')),{distance:'2.5',minutes:12,fare:23});
});
