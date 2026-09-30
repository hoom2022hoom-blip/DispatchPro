// Launched only by the isolated PostgreSQL integration test. Uses actual HTTP and the actual JS provider.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createReceptionWorker } from '../scripts/lib/reception-worker.mjs';
import { createCallStore } from '../src/lib/call-store.ts';
import { createApiReceptionBackend } from '../src/lib/reception-api.ts';
import { proxyReception } from '../src/lib/reception-proxy.ts';
import { createOfficeBridge } from '../scripts/lib/office-bridge.mjs';

const apiUrl = process.env.RECEPTION_TEST_URL;
assert.ok(apiUrl?.startsWith('http://127.0.0.1:'));
const directory = await mkdtemp(join(tmpdir(), 'dispatchpro-live-reception-'));
try {
  const event = { eventId: 'live-worker-event', source: 'WHATSAPP', phone: '0598888888', timestamp: new Date().toISOString() };
  await createCallStore(join(directory, 'calls')).append(event);
  const options = { directory, apiUrl, tenant: 'reception-a', username: 'admin', password: 'Reception-test-password!' };
  assert.deepEqual(await createReceptionWorker(options).runOnce(), { delivered: 1, failed: 0 });
  assert.deepEqual(await createReceptionWorker(options).runOnce(), { delivered: 0, failed: 0 });
  const provider = createApiReceptionBackend((path, init) => proxyReception(new Request(`http://localhost:9005${path}`, init), new URL(path,'http://localhost:9005').pathname.replace('/api/reception/', '').split('/'), apiUrl));
  await provider.login('reception-a', 'admin', 'Reception-test-password!');
  const snapshot = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error('Snapshot timeout')); }, 10000);
    const unsubscribe = provider.subscribe(data => { clearTimeout(timer); unsubscribe(); resolve(data); }, failure => { clearTimeout(timer); unsubscribe(); reject(failure); });
  });
  let data = await snapshot();
  const order = data.rides.find(r => r.callEventId === event.eventId);
  assert.ok(order); assert.ok(order.createdAt instanceof Date);
  await provider.saveRide({ ...order, pickup: { name: 'عنوان من الموفر الحقيقي', coords: { x: 0, y: 0 } }, receptionPending: false });
  await provider.receiveCall(event);
  data = await snapshot();
  assert.equal(data.rides.filter(r => r.callEventId === event.eventId).length, 1);
  assert.equal(data.rides.find(r => r.id === order.id).pickup.name, 'عنوان من الموفر الحقيقي');
  const login = await fetch(`${apiUrl}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenant: 'reception-a', username: 'admin', password: 'Reception-test-password!' }) });
  const adminToken = (await login.json()).accessToken;
  const headers = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };
  const call = async (path, method='GET', body) => { const response = await fetch(`${apiUrl}/api/v1/${path}`, { method, headers, ...(body ? {body:JSON.stringify(body)} : {}) }); assert.ok(response.ok, `${path} ${response.status}`); return response.json(); };
  const identity = await call('me');
  await call('features/CallerId?enabled=true','PUT');
  const role = await call('roles','POST',{name:'Bridge ingestion only'});
  await call('permissions','POST',{roleId:role.id,code:'reception.ingest'});
  const credentials = {username:'bridge-agent',password:'Bridge-test-only-password!'};
  await call('users','POST',{...credentials,roleId:role.id});
  const inbox=join(directory,'bridge-source');const source=createCallStore(inbox);
  const config={apiUrl,tenant:'reception-a',tenantId:identity.tenantId,sourceDirectory:inbox,stateDirectory:join(directory,'bridge-state'),startAfter:'2020-01-01T00:00:00Z'};
  let loseAck=true;
  const bridge=()=>createOfficeBridge(config,credentials,{fetchImpl:async (url,init)=>{const response=await fetch(url,init);if(url.endsWith('/bridge/calls')&&response.ok&&loseAck){loseAck=false;throw Error('Simulated lost ACK after commit');}return response;}});
  for(const kind of ['LANDLINE_ICALL','WHATSAPP']) {
    const event={eventId:`bridge-${kind}`,source:kind,phone:'0597777777',timestamp:new Date().toISOString()};
    await source.append(event);await source.append(event);
    await bridge().runOnce();await bridge().runOnce();assert.equal((await bridge().runOnce()).delivered,0);
    const data=await snapshot();assert.equal(data.rides.filter(r=>r.callEventId===event.eventId).length,1);
    assert.ok(data.rides.find(r=>r.callEventId===event.eventId).rideRequestId);
    await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{stop();reject(Error('Latest call timeout'));},5000);const stop=provider.watchLatest(reject);const unsubscribe=provider.subscribeLatest(()=>{if(provider.getLatestCall()?.eventId===event.eventId){clearTimeout(timeout);stop();unsubscribe();resolve();}});});
  }
  const wrongTenant=await fetch(`${apiUrl}/api/v1/reception/bridge/calls`,{method:'POST',headers,body:JSON.stringify({source:'LANDLINE',callerNumber:'0597777777',eventId:'wrong-office',receivedAt:new Date().toISOString(),tenantId:'11111111-1111-1111-1111-111111111111'})});assert.equal(wrongTenant.status,403);
  console.log('PASS Office Bridge LANDLINE + WHATSAPP: lost ACK/restart, one request per event, tenant rejection, ReceptionBackend and latest-call notification');
  provider.logout();
  console.log('PASS: journal -> independent worker -> authenticated API -> PostgreSQL -> proxy -> ReceptionBackend read/edit/replay');
} finally { await rm(directory, { recursive: true, force: true }); }
