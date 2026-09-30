import test from 'node:test';
import assert from 'node:assert/strict';
import {createDriverApi,DriverApiError} from '../src/lib/driver-api.ts';
import {proxyReception} from '../src/lib/reception-proxy.ts';
import {sendBrowserNotification,enableBrowserNotifications} from '../src/lib/notifications.ts';

test('Driver API validates driver login, forwards version, history and availability, and clears authorization on logout',async()=>{
 const calls=[];
 const api=createDriverApi(async(url,options)=>{
  calls.push({url,options});
  return Response.json(url.endsWith('auth/login')?{accessToken:'driver-token'}:url.endsWith('driver/me')?{id:'driver',status:'Offline'}:{items:[]});
 });
 await assert.rejects(()=>api.history(),e=>e.status===401);
 await api.login('office','driver','password');
 assert.equal(calls[0].options.headers.Authorization,undefined);
 assert.equal(calls[1].options.headers.Authorization,'Bearer driver-token');
 await api.availability('Available');await api.transition({id:'ride',version:4},'Accepted');await api.reject({id:'ride',version:5});await api.history(2);
 assert.deepEqual(JSON.parse(calls[3].options.body),{status:'Accepted',version:4});
 assert.deepEqual(JSON.parse(calls[4].options.body),{version:5});
 assert.match(calls[5].url,/history\?page=2$/);
 api.logout();await assert.rejects(()=>api.updates(),e=>e.status===401);
});

test('Rejected driver identity and conflict are not automatically retried',async()=>{
 let calls=0;
 const denied=createDriverApi(async url=>{calls++;return url.endsWith('auth/login')?Response.json({accessToken:'token'}):Response.json({},{status:403});});
 await assert.rejects(()=>denied.login('office','user','password'),e=>e instanceof DriverApiError&&e.status===403);
 await assert.rejects(()=>denied.history(),e=>e.status===401);assert.equal(calls,2);
 let writes=0;const api=createDriverApi(async(url,options)=>url.endsWith('auth/login')?Response.json({accessToken:'token'}):options.method==='PUT'?(writes++,Response.json({error:'changed'},{status:409})):Response.json({id:'driver'}));
 await api.login('office','driver','password');await assert.rejects(()=>api.reject({id:'ride',version:1}),e=>e.status===409);assert.equal(writes,1);
});

test('Driver proxy permits only scoped routes and preserves bearer, cancellation, and no-store',async()=>{
 const id='11111111-1111-1111-1111-111111111111';let last;
 const fetcher=async(url,init)=>{last={url,init};return Response.json({ok:true});};
 for(const [method,path] of [['GET','driver/me'],['GET','driver/updates'],['GET','driver/history'],['GET',`driver/rides/${id}`],['PUT','driver/availability'],['PUT',`driver/rides/${id}/reject`],['PUT',`rides/${id}/status`],['GET','notifications/updates']]){
  const controller=new AbortController();const response=await proxyReception(new Request('http://localhost/api/reception/'+path,{method,signal:controller.signal,headers:{Authorization:'Bearer driver'}}),path.split('/'),'http://127.0.0.1:9010',fetcher);
  assert.equal(response.status,200);assert.equal(last.init.headers.Authorization,'Bearer driver');assert.equal(last.init.cache,'no-store');controller.abort();assert.equal(last.init.signal.aborted,true);
 }
 assert.equal((await proxyReception(new Request('http://localhost/api/reception/driver/me'),['driver','me'],'http://127.0.0.1:9010',fetcher)).status,401);
 assert.equal((await proxyReception(new Request('http://localhost/api/reception/driver/users',{headers:{Authorization:'Bearer driver'}}),['driver','users'],'http://127.0.0.1:9010',fetcher)).status,404);
});

test('Browser notifications do not wait forever for an absent service worker or request permission from events',async()=>{
 const oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');let shown=0,requested=0;
 class NotificationMock {static permission='default';static async requestPermission(){requested++;return 'granted';}constructor(){shown++;}}
 globalThis.window={Notification:NotificationMock};globalThis.Notification=NotificationMock;
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{serviceWorker:{getRegistration:async()=>undefined}}});
 try{await sendBrowserNotification('new','ride');assert.equal(requested,0);assert.equal(shown,0);assert.equal(await enableBrowserNotifications(),'granted');NotificationMock.permission='granted';await sendBrowserNotification('new','ride');assert.equal(shown,1);assert.equal(requested,1);}
 finally{delete globalThis.window;delete globalThis.Notification;if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator;}
});
