import {mkdir,readFile,writeFile,rename,readdir,open,unlink} from 'node:fs/promises';
import {createHash,createPublicKey,verify,randomUUID} from 'node:crypto';
import {createConnection} from 'node:net';
import {createServer} from 'node:https';
import {join} from 'node:path';
import {normalizePhone,parsePhone} from './phone.mjs';
import {advertise} from './mdns.mjs';
import {sendOfficeMirror} from '../../DispatchPro-Site-Bridge/scripts/lib/officecalls-mirror.mjs';

export async function receiverTcp(event,{host='127.0.0.1',port=5050}={}) {
 // Existing TCP/5050 schema and OK eventId ACK. A localhost-only destination needs no router port.
 const payload={eventId:event.eventId,type:'incoming_call',caller:event.phone,number:event.phone,displayName:'',package:event.sourcePackage||'com.whatsapp.w4b',timestamp:Date.parse(event.timestamp),device:'OfficeCalls Windows Agent 3.0'};
 return new Promise((resolve,reject)=>{
  let response='',done=false;const socket=createConnection({host,port});
  const finish=error=>{if(done)return;done=true;socket.destroy();error?reject(error):resolve();};
  socket.setTimeout(5000,()=>finish(Error('RECEIVER_ACK_TIMEOUT')));socket.on('error',()=>finish(Error('RECEIVER_UNAVAILABLE')));socket.on('end',()=>{if(!done)finish(Error('RECEIVER_CLOSED_WITHOUT_ACK'));});
  socket.on('connect',()=>socket.write(JSON.stringify(payload)+'\n'));
  socket.on('data',data=>{response+=data.toString('utf8');if(response.length>1024)return finish(Error('INVALID_RECEIVER_ACK'));if(response.includes('\n'))finish(response.split('\n')[0].trim()===`OK ${event.eventId}`?null:Error('INVALID_RECEIVER_ACK'));});
 });
}
export function createAgent({directory,officeId,token,mode='udp',receiverPort=5050,mirrorHost='255.255.255.255',mirrorDirectory,fetchImpl=fetch,deliver,report=()=>{},clock=()=>Date.now()}) {
 if(!/^[a-f0-9-]{36}$/i.test(officeId)||!/^oc3_[A-F0-9]{64}$/.test(token)||!['udp','tcp'].includes(mode))throw Error('INVALID_AGENT_CONFIGURATION');
 const base='https://api.nablustaxi.com/api/v1/officecalls';let roster;let serial=Promise.resolve();
 const exclusive=fn=>{const result=serial.then(fn);serial=result.catch(()=>{});return result;};
 const path=id=>join(directory,createHash('sha256').update(id).digest('hex')+'.json');
 async function save(value){await mkdir(directory,{recursive:true});const temp=path(value.event.eventId)+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value),{flag:'wx',mode:0o600});await rename(temp,path(value.event.eventId));}
 async function load(id){try{return JSON.parse(await readFile(path(id),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 async function api(route,body){const response=await fetchImpl(base+route,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error(`API_HTTP_${response.status}`);return response.json();}
 function validate(event){if(!event||!/^[A-Za-z0-9._:-]{1,160}$/.test(event.eventId)||parsePhone(event.phone)?.identity!==event.phone||!event.phone||!['com.whatsapp.w4b','com.whatsapp'].includes(event.sourcePackage)||!Number.isFinite(Date.parse(event.timestamp)))throw Error('INVALID_EVENT');}
 async function deliverOnce(record){
  if(record.officeId!==officeId)throw Error('JOURNAL_OFFICE_MISMATCH');
  if(record.delivery!=='PENDING')return record;
  if(clock()-Date.parse(record.event.timestamp)>300000||Date.parse(record.event.timestamp)>clock()+120000){record.delivery='EXPIRED';await save(record);return record;}
  // UDP/GRIDCMS has no idempotent ACK. Record intent first and never automatically replay an
  // uncertain attempt after process death. This makes uncertainty visible instead of duplicating calls.
  if(mode==='udp'){record.delivery='DELIVERY_UNKNOWN';await save(record);}
  try {if(deliver)await deliver(record.event);else if(mode==='tcp')await receiverTcp(record.event,{port:receiverPort});else await sendOfficeMirror(record.event,{host:mirrorHost,directory:mirrorDirectory||directory});
   record.delivery=mode==='tcp'?'RECEIVER_ACK':'UDP_SENT';record.error='';report({type:'GRID_DELIVERED',level:record.delivery,visibleConfirmed:false});
  }catch(error){record.error=error.message;record.delivery=mode==='tcp'?'PENDING':'DELIVERY_UNKNOWN';report({type:'GRID_DELIVERY_FAILED',error:record.error});}
  await save(record);return record;
 }
 async function accept(event,envelope){validate(event);let record=await load(event.eventId);
  if(record&&(record.event.phone!==event.phone||Date.parse(record.event.timestamp)!==Date.parse(event.timestamp)||record.event.sourcePackage!==event.sourcePackage))throw Error('EVENT_ID_CONFLICT');
  if(!record){record={officeId,event,envelope,delivery:'PENDING',serverAccepted:!envelope,acknowledged:false};await save(record);}
  return deliverOnce(record);
 }
 async function syncRecord(record){
  if(record.officeId!==officeId)throw Error('JOURNAL_OFFICE_MISMATCH');
  if(record.envelope&&!record.serverAccepted){await api('/agent/ingest',record.envelope);record.serverAccepted=true;await save(record);}
  if(record.serverAccepted&&!record.acknowledged&&['RECEIVER_ACK','UDP_SENT'].includes(record.delivery)){
   await api(`/agent/events/${record.event.eventId}/ack`,{status:record.delivery});record.acknowledged=true;await save(record);
  } else if(record.serverAccepted&&!record.acknowledged&&['PENDING','DELIVERY_UNKNOWN'].includes(record.delivery)&&clock()-Date.parse(record.event.timestamp)<=300000){
   await api(`/agent/events/${record.event.eventId}/ack`,{status:'FAILED',error:record.error||record.delivery});
  }
 }
 async function runOnce(){return exclusive(async()=>{
  // Local unsynced GRID delivery proceeds even when cloud or DispatchPro is unavailable.
  await mkdir(directory,{recursive:true});const journal=[];
  for(const file of (await readdir(directory)).filter(f=>/^[a-f0-9]{64}\.json$/.test(f))){try{let record=JSON.parse(await readFile(join(directory,file),'utf8'));
    if(clock()-Date.parse(record.event.timestamp)>30*86400000){if(!record.redacted){record.redacted=true;record.event.phone='';delete record.envelope;record.delivery=record.delivery==='PENDING'?'EXPIRED':record.delivery;await save(record);}continue;}
    record=await deliverOnce(record);journal.push(record.event.eventId);
  }catch(error){report({type:'LOCAL_SYNC_FAILED',error:error.message});}}
  // Complete independent local delivery first. One cloud outage must not impose
  // a separate ten-second timeout on every journal row or postpone fresh events.
  const health=await api('/health');if(health.officeId!==officeId)throw Error('OFFICE_IDENTITY_MISMATCH');
  roster=await api('/agent/devices');if(roster.officeId!==officeId)throw Error('ROSTER_OFFICE_MISMATCH');
  await writeFile(join(directory,'roster.json'),JSON.stringify(roster),{mode:0o600});
  const events=await api('/agent/events');
  const seen=new Set();let cloudFailure;
  const synchronize=async(record)=>{try{await syncRecord(record);}catch(error){report({type:'EVENT_DELIVERY_FAILED',error:error.message});if(!/^API_HTTP_(400|409)$/.test(error.message))cloudFailure=error;}};
  for(const event of events){try{const record=await accept(event);seen.add(event.eventId);if(!cloudFailure)await synchronize(record);}catch(error){report({type:'EVENT_DELIVERY_FAILED',error:error.message});}}
  for(const id of journal){if(cloudFailure)break;if(seen.has(id))continue;const record=await load(id);if(record)await synchronize(record);}
  if(cloudFailure){report({type:'CLOUD_SYNC_PENDING',error:cloudFailure.message});return events.length;}
  report({type:'CLOUD_CONNECTED',at:new Date(clock()).toISOString()});return events.length;
 });}
 async function receiveLocal(envelope){return exclusive(async()=>{
  if(!roster)try{roster=JSON.parse(await readFile(join(directory,'roster.json'),'utf8'));}catch{}
  if(!roster||roster.officeId!==officeId||!Number.isFinite(Date.parse(roster.validUntil))||Date.parse(roster.validUntil)<clock())throw Error('LOCAL_AUTHORIZATION_EXPIRED');
  if(typeof envelope?.payload!=='string'||envelope.payload.length>4096||typeof envelope.signature!=='string'||envelope.signature.length>1024)throw Error('INVALID_LOCAL_ENVELOPE');
  const device=roster.devices.find(d=>d.id===envelope.deviceId);if(!device)throw Error('DEVICE_NOT_AUTHORIZED');
  const key=createPublicKey({key:Buffer.from(device.publicKey,'base64'),format:'der',type:'spki'});
  if(!verify('RSA-SHA256',Buffer.from(envelope.payload),key,Buffer.from(envelope.signature,'base64')))throw Error('INVALID_DEVICE_SIGNATURE');
  const event=JSON.parse(envelope.payload);validate(event);
  if(clock()-Date.parse(event.timestamp)>300000||Date.parse(event.timestamp)>clock()+120000)throw Error('LOCAL_EVENT_EXPIRED');
  const result=await accept(event,envelope);
  return {eventId:event.eventId,receiverAcknowledged:true,gridCms:result.delivery,gridVisibleConfirmed:false};
 });}
 function listenLocal(port=5051,tls){
  if(!tls?.pfx||!tls?.passphrase)throw Error('LOCAL_TLS_CERTIFICATE_REQUIRED');
  const server=createServer(tls,async(req,res)=>{
   const ip=(req.socket.remoteAddress||'').replace(/^::ffff:/,'');
   if(req.method!=='POST'||req.url!=='/officecalls/events'||!/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)){res.writeHead(403);res.end();return;}
   try{let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>8192)throw Error('TOO_LARGE');chunks.push(chunk);}
    const result=await receiveLocal(JSON.parse(Buffer.concat(chunks).toString('utf8')));res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
   }catch{res.writeHead(401);res.end();}
  });server.requestTimeout=5000;server.headersTimeout=5000;server.maxConnections=32;
  server.listen(port,'0.0.0.0');return server;
 }
 return {runOnce,receiveLocal,listenLocal};
}
export async function startAgent(config){
 const directory=config.directory;await mkdir(directory,{recursive:true});const lock=join(directory,'agent.lock');
 let handle;
 try {handle=await open(lock,'wx');} catch(error) {
  if(error.code!=='EEXIST')throw error;
  const pid=Number(await readFile(lock,'utf8'));if(!Number.isSafeInteger(pid)||pid<0)throw Error('INVALID_AGENT_LOCK');
  if(pid>0){try{process.kill(pid,0);throw Error('AGENT_ALREADY_RUNNING');}catch(failure){if(failure.code!=='ESRCH')throw failure;}}
  await unlink(lock);handle=await open(lock,'wx');
 }
 await handle.writeFile(String(process.pid));await handle.close();let stopped=false;const history=[];
 const report=async entry=>{history.push({...entry,at:entry.at||new Date().toISOString()});if(history.length>200)history.shift();await writeFile(join(directory,'status.json'),JSON.stringify(entry),{mode:0o600});await writeFile(join(directory,'diagnostics.json'),JSON.stringify(history),{mode:0o600});};
 const agent=createAgent({...config,report});const server=config.localEnabled?agent.listenLocal(config.localPort||5051,{pfx:await readFile(config.certificateFile),passphrase:config.certificatePassword}):null;
 const discovery=config.localEnabled?advertise({officeId:config.officeId,instanceId:createHash('sha256').update(config.officeId).digest('hex').slice(0,12),port:config.localPort||5051,report}):null;
 const stop=()=>{stopped=true;server?.close();discovery?.close();};process.on('SIGINT',stop);process.on('SIGTERM',stop);
 let retry=0;
 while(!stopped){try{await agent.runOnce();retry=0;}catch(error){retry++;await report({type:'CLOUD_FAILED',error:error.message,at:new Date().toISOString()});}
  await new Promise(resolve=>setTimeout(resolve,Math.min(30000,2000*2**Math.min(retry,4))));}
 await writeFile(lock,'0');
}
