import test from 'node:test';
import assert from 'node:assert/strict';
import {officeDriverStatus} from '../src/lib/office.ts';
test('Driver Offline overrides an old shift or queue entry in office availability',()=>{
 const driver={id:'driver',active:true,status:'Offline'};
 const data={reception:{rides:[],queue:[{driverId:'driver'}],shifts:[{driverId:'driver',status:'active'}]}};
 assert.equal(officeDriverStatus(driver,data),'OFFLINE');
 assert.equal(officeDriverStatus({...driver,status:'Available'},data),'AVAILABLE');
});
