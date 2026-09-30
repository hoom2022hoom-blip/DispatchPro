import test from 'node:test';
import assert from 'node:assert/strict';
import {reportCsv,printReportPage} from '../src/lib/office-report-export.ts';
import {proxyReception} from '../src/lib/reception-proxy.ts';
test('Administration proxy preserves user authorization and rejects unintended routes',async()=>{
 const seen=[];const fetcher=async(url,init)=>{seen.push({url,init});return Response.json({ok:true});};
 for(const [method,path] of [['GET','administration/access'],['GET','administration/users'],['GET','administration/roles'],['GET','administration/notifications'],['POST','users'],['POST','roles'],['GET','offices'],['PUT','administration/roles/11111111-1111-1111-1111-111111111111']]){
  const response=await proxyReception(new Request('http://localhost/api/reception/'+path,{method,headers:{Authorization:'Bearer employee'}}),path.split('/'),'http://127.0.0.1:9010',fetcher);assert.equal(response.status,200);assert.equal(seen.at(-1).init.headers.Authorization,'Bearer employee');
 }
 assert.equal((await proxyReception(new Request('http://localhost/api/reception/administration/users'),['administration','users'],'http://127.0.0.1:9010',fetcher)).status,401);
 assert.equal((await proxyReception(new Request('http://localhost/api/reception/permissions',{method:'POST',headers:{Authorization:'Bearer employee'}}),['permissions'],'http://127.0.0.1:9010',fetcher)).status,404);
});
test('CSV and print escape customer content, export only supplied page and label total',()=>{
 const rows=[{passengerName:'=CMD("x")',passengerPhone:'+970599999999',addressText:'<script>alert(1)</script>'}];
 const csv=reportCsv(rows);assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"\'=CMD(""x"")"'));assert.ok(csv.includes('"\'+970'));assert.equal(csv.split('\r\n').length,2);
 let html='',printed=false;globalThis.window={open:()=>({document:{write:v=>html=v,close(){}},focus(){},print(){printed=true;}})};
 try{assert.equal(printReportPage(rows,100),true);assert.ok(printed);assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('100'));}finally{delete globalThis.window;}
});
