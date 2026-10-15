import test from 'node:test';
import assert from 'node:assert/strict';
import preflight from '../scripts/driver-qa/runtime-preflight.cjs';
const qa={tenant:'driver-qa',tenantId:'test-only',database:'dispatchpro_driverqa_test',role:'driverqa_a812aa81'};
test('QA runtime rejects operational identity before child processes start',()=>{
 for(const changed of [{database:'DispatchProTaxi'},{role:'postgres'},{tenant:'real-office'},{tenantId:''}])assert.throws(()=>preflight({...qa,...changed}));
 assert.equal(preflight(qa),undefined);
});
test('Local TLS refuses unexpected ports/origin and missing certificates',()=>{
 const local={...qa,tlsPort:9443,publicOrigin:'https://localhost:9443',apiPort:9027,webPort:9025,gatewayPort:9028,tlsKey:'missing-qa-test.key',tlsCert:'missing-qa-test.pem'};
 for(const changed of [{apiPort:9010},{webPort:9005},{gatewayPort:9010},{tlsPort:443},{publicOrigin:'https://office.nablustaxi.com'}])assert.throws(()=>preflight({...local,...changed}),assert.AssertionError);
 assert.throws(()=>preflight(local),e=>e.code==='ENOENT');
});
