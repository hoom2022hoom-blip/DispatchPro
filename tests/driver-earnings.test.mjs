import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {receptionRenderHooks} from './helpers/reception-render.mjs';
import {createDriverApi} from '../src/lib/driver-api.ts';
import {proxyReception} from '../src/lib/reception-proxy.ts';

test('earnings API and proxy preserve driver authorization and paging',async()=>{
 const calls=[];
 const api=createDriverApi(async(url,options)=>{calls.push({url,options});return Response.json(url.endsWith('auth/driver-login')?{accessToken:'driver-token'}:{});});
 await assert.rejects(()=>api.earnings(),e=>e.status===401);
 await api.login('office','driver','password');await api.earnings(3);
 assert.equal(calls.at(-1).url,'/api/reception/driver/earnings?page=3&period=today');assert.equal(calls.at(-1).options.headers.Authorization,'Bearer driver-token');
 let forwarded;
 const response=await proxyReception(new Request('http://localhost/api/reception/driver/earnings?page=3',{headers:{Authorization:'Bearer driver-token'}}),['driver','earnings'],'http://127.0.0.1:5000',async(url,options)=>{forwarded={url,options};return Response.json({});});
 assert.equal(response.status,200);assert.match(forwarded.url,/driver\/earnings\?page=3$/);assert.equal(forwarded.options.headers.Authorization,'Bearer driver-token');
});

test('earnings UI distinguishes missing prices, real zero, multiple currencies and empty/loading states',async()=>{
 const hooks=receptionRenderHooks();
 try{
  const {EarningsCards,EarningsPage}=await import('../src/components/driver-earnings.tsx');
  const summary={date:'2026-10-03',timeZone:'Asia/Jerusalem',completedTrips:4,missingFareTrips:1,totals:[{currency:'ILS',amount:22},{currency:'USD',amount:10}]};
  const data={summary,page:1,total:4,items:[{id:'missing',pickup:'A',destination:'B',finalFare:null},{id:'zero',pickup:'C',destination:'D',finalFare:0,currency:'ILS',fareSource:'DRIVER_MANUAL'}]};
  const html=renderToStaticMarkup(React.createElement(EarningsPage,{data,page:1,setPage(){},connected:true}));
  assert.match(html,/السعر النهائي غير متوفر/);assert.match(html,/[0٠] ₪/);assert.match(html,/USD/);assert.match(html,/لم تدخل في مجموع الأرباح/);
  assert.match(renderToStaticMarkup(React.createElement(EarningsCards,{})),/—/);
  assert.match(renderToStaticMarkup(React.createElement(EarningsCards,{summary:{...summary,completedTrips:1,missingFareTrips:1,totals:[]}})),/السعر غير متوفر/);
  assert.match(renderToStaticMarkup(React.createElement(EarningsCards,{summary:{...summary,completedTrips:0,missingFareTrips:0,totals:[]}})),/لا توجد أرباح/);
 }finally{hooks.deregister();}
});
