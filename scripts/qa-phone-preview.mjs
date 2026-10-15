// Original project pages, local fixtures only. This tool never changes the firewall.
import http from 'node:http';
import {networkInterfaces} from 'node:os';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const upstream='http://127.0.0.1:19430',folder='artifacts/final-qa-mobile-20261015/phone';
export function privateIPv4(host){const a=host.split('.');if(a.length!==4||a.some(s=>!/^\d{1,3}$/.test(s)||String(Number(s))!==s||Number(s)>255))return false;return a[0]==='10'||a[0]==='192'&&a[1]==='168'||a[0]==='172'&&+a[1]>=16&&+a[1]<=31;}
export function safeStatus(value){return value?.mode==='offline-original-next-pages'&&value.mapboxRequests===0&&value.productionRequests===0;}
export function safeMethod(method){return method==='GET'||method==='HEAD';}
export function sameToken(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export function sessionExpiry(started,requested){const expiry=requested===undefined?started+30*60*1000:Date.parse(requested);if(!Number.isFinite(expiry)||expiry<=started||expiry>started+30*60*1000)throw Error('QA expiry must be in the future and within 30 minutes');return expiry;}
async function probe(){const r=await fetch(upstream+'/__qa_status',{redirect:'error',signal:AbortSignal.timeout(5000)});if(!r.ok||!safeStatus(await r.json()))throw Error('A running isolated offline QA gateway is required; no listener was started');}
async function main(){
 const args=process.argv.slice(2),host=args.find(s=>s.startsWith('--host='))?.slice(7);if(!host||!privateIPv4(host))throw Error('Specify a private computer LAN IPv4 address with --host=; wildcard/public/loopback listeners are refused');
 const local=Object.values(networkInterfaces()).flat().some(a=>a.address===host&&!a.internal);if(!local)throw Error('The requested LAN address is not assigned to this computer');
 await probe();
 if(args.includes('--check')){console.log(JSON.stringify({upstreamReady:true,host,port:19426,listenerStarted:false,firewallChanged:false,mapboxRequests:0}));return;}
 await mkdir(folder,{recursive:true});const manifestPath=folder+'/session.private.json';let session;
 if(args.includes('--prepare')){
  session={host,port:19426,capability:randomBytes(24).toString('base64url'),preparedAt:new Date().toISOString(),expiresAfterStartMinutes:30,active:false};
  session.url=`http://${host}:19426/__qa_phone/start?token=${session.capability}`;await writeFile(manifestPath,JSON.stringify(session,null,2));
  const qr=await import('qrcode');await qr.default.toFile(folder+'/phone-qr-pending.png',session.url,{width:420,margin:2});
  console.log(JSON.stringify({prepared:true,listenerStarted:false,firewallChanged:false,manifest:manifestPath,qr:folder+'/phone-qr-pending.png',note:'URL is inactive until an approved --listen --approved-lan run'}));return;
 }
 if(!args.includes('--listen')||!args.includes('--approved-lan'))throw Error('Prepare/check only by default; listening requires explicit user approval and --listen --approved-lan');
 session=JSON.parse(await readFile(manifestPath,'utf8'));if(session.host!==host||session.port!==19426)throw Error('Prepared host mismatch');
 const started=Date.now(),expiry=sessionExpiry(started,args.find(s=>s.startsWith('--expires-at='))?.slice('--expires-at='.length));
 const server=http.createServer(async(req,res)=>{
  const end=(code,message)=>{res.writeHead(code,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(message);};
  if(req.headers.host!==host+':19426')return end(403,'QA host required');
  if(Date.now()>=expiry)return end(410,'QA phone session expired');
  if(!safeMethod(req.method))return end(403,'Read-only QA preview: actions, audio and GPS writes disabled');
  const u=new URL(req.url,'http://'+host+':19426');
  if(u.pathname==='/__qa_phone/start'){
   if(!sameToken(u.searchParams.get('token'),session.capability))return end(403,'Invalid QA preview link');
   // A top-level link opened from another app must carry the new cookie through
   // this redirect. Strict stores it but omits it on the redirected navigation.
   const maxAge=Math.max(1,Math.ceil((expiry-Date.now())/1000));
   res.writeHead(303,{'location':'/driver','cache-control':'no-store','referrer-policy':'no-referrer','set-cookie':`dispatchpro_qa_phone=${session.capability}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`});res.end();return;
  }
  const cookie=req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('dispatchpro_qa_phone='))?.slice('dispatchpro_qa_phone='.length);
  if(!sameToken(cookie,session.capability))return end(403,'Open the prepared QA phone link first');
  if(u.pathname.startsWith('/__qa_')&&!u.pathname.startsWith('/__qa_mapbox/')&&!u.pathname.startsWith('/__qa_traccar/'))return end(403,'QA control endpoint blocked');
  if(u.pathname.startsWith('/api/')&&!u.pathname.startsWith('/api/reception/'))return end(403,'No operational APIs');
  try{const headers={...req.headers};for(const k of ['host','cookie','connection','accept-encoding'])delete headers[k];const r=await fetch(upstream+u.pathname+u.search,{method:req.method,headers,redirect:'manual',signal:AbortSignal.timeout(90000)}),body=Buffer.from(await r.arrayBuffer()),h=Object.fromEntries(r.headers);for(const k of ['content-encoding','content-length','transfer-encoding','set-cookie'])delete h[k];h['cache-control']='no-store';h['referrer-policy']='no-referrer';res.writeHead(r.status,h);res.end(body);}catch{end(502,'Local QA preview unavailable');}
 });
 const watchdog=setInterval(()=>{void probe().catch(()=>server.close());},10000);watchdog.unref();setTimeout(()=>server.close(),expiry-started).unref();
 server.on('close',()=>{clearInterval(watchdog);void writeFile(manifestPath,JSON.stringify({...session,active:false,closedAt:new Date().toISOString()},null,2));});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(19426,host,resolve);});await writeFile(manifestPath,JSON.stringify({...session,active:true,expiresAt:new Date(expiry).toISOString()},null,2));
 console.log(JSON.stringify({ready:true,host,port:19426,expiresAt:new Date(expiry).toISOString(),firewallChanged:false,urlFile:manifestPath}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
