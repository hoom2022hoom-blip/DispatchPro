// Customer-only phone test host. Reuses the existing backend and customer proxy.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {proxyCustomer} from '../src/lib/customer-proxy.ts';
const files={'maps.js':'text/javascript','maplibre-gl.js':'text/javascript','maplibre-gl.css':'text/css','index.html':'text/html; charset=utf-8','app.js':'text/javascript','app.css':'text/css','manifest.webmanifest':'application/manifest+json','sw.js':'text/javascript','icon.svg':'image/svg+xml'};
http.createServer(async(req,res)=>{
  const controller=new AbortController();res.on('close',()=>controller.abort());
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  try{
    const url=new URL(req.url,`${req.headers['x-forwarded-proto']==='https'?'https':'http'}://${req.headers.host}`);
    const name=url.pathname.slice('/customer-mobile/'.length);
    if(url.pathname.startsWith('/customer-mobile/')&&Object.hasOwn(files,name)&&['GET','HEAD'].includes(req.method)){
      const data=await readFile(new URL('../public/customer-mobile/'+name,import.meta.url));res.writeHead(200,{'Content-Type':files[name]});res.end(req.method==='HEAD'?undefined:data);return;
    }
    if(!url.pathname.startsWith('/api/customer/')){res.writeHead(404);res.end();return;}
    const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>16384){res.writeHead(413);res.end();return;}chunks.push(chunk);}
    const request=new Request(url,{method:req.method,headers:req.headers,signal:controller.signal,...(size?{body:Buffer.concat(chunks)}:{})});
    const response=await proxyCustomer(request,url.pathname.slice('/api/customer/'.length).split('/'),process.env.DISPATCHPRO_API_URL||'http://127.0.0.1:9010');
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{if(!res.headersSent)res.writeHead(503);res.end();}
}).listen(9013,'127.0.0.1',()=>console.log('Customer phone host ready on 127.0.0.1:9013'));
