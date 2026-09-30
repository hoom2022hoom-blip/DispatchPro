import test from 'node:test';
import assert from 'node:assert/strict';
import {createDriverApi} from '../src/lib/driver-api.ts';

test('Offer countdown uses server UTC across phone skew, long polls, timezone offsets and wall-clock changes',async(t)=>{
  let elapsed=1000;
  t.mock.method(performance,'now',()=>elapsed);
  t.mock.method(Date,'now',()=>Date.parse('2026-10-02T12:00:00Z'));
  let serverTime='2026-10-01T15:00:00+03:00';
  const api=createDriverApi(async url=>{
    if(url.includes('updates')){elapsed+=25000;return Response.json({serverTime,cursor:'same',data:{rides:[]}});}
    return Response.json(url.endsWith('auth/login')?{accessToken:'token'}:{id:'driver'});
  });
  await api.login('office','driver','password');
  await api.updates();
  const expiration=Date.parse('2026-10-01T12:00:30Z');
  assert.equal(expiration-api.offerNow(),30000);
  elapsed+=29000;
  t.mock.method(Date,'now',()=>Date.parse('2026-09-01T00:00:00Z'));
  assert.equal(expiration-api.offerNow(),1000);
  elapsed+=1000;
  assert.equal(expiration-api.offerNow(),0);
  serverTime='2026-10-01T12:00:55Z';
  await api.updates('same');
  assert.equal(expiration-api.offerNow(),-25000);
});
