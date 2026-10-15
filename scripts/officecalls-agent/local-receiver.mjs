import {open,readFile,mkdir,truncate,rename,unlink} from 'node:fs/promises';
import {createHash,randomBytes,createCipheriv,createDecipheriv,timingSafeEqual} from 'node:crypto';
import {createServer} from 'node:https';
import {join,resolve,dirname} from 'node:path';
import {sendOfficeMirror} from '../../DispatchPro-Site-Bridge/scripts/lib/officecalls-mirror.mjs';
import {createPairingOffer} from './local-pairing.mjs';
import {formatCallTime,CALL_TIME_ZONE} from './call-time.mjs';
import {parsePhone,gridPhone} from './phone.mjs';

export const VERSION='3.2.5';
export function isLocalAddress(ip) {
 ip=ip.replace(/^::ffff:/,'');
 return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) || ip==='::1';
}
function validate(event) {
 if(!event || !/^[\w.:-]{1,160}$/.test(event.eventId) || !/^[a-f\d-]{36}$/i.test(event.deviceId) ||
 !['com.whatsapp','com.whatsapp.w4b'].includes(event.package) || !Number.isSafeInteger(event.timestamp) || event.timestamp<=0 ||
 !Number.isInteger(event.revision) || event.revision<1 || event.revision>10000 || typeof event.number!=='string' ||
 (event.number && !parsePhone(event.number))) throw Error('INVALID_EVENT');
 const input=event.phoneE164||event.phoneIdentity||event.number;
 const phone=input?parsePhone(input):null;
 if(input&&!phone)throw Error('INVALID_PHONE_IDENTITY');
 if(event.phoneE164 && phone.e164!==event.phoneE164)throw Error('INVALID_E164');
 if((event.phoneIdentity||event.phoneE164)&&event.number!==phone.display)throw Error('PHONE_DISPLAY_CONFLICT');
 const result={eventId:event.eventId,deviceId:event.deviceId,revision:event.revision,package:event.package,timestamp:event.timestamp,
 number:event.number,displayName:String(event.displayName||'').replace(/[\x00-\x1f]/g,'').slice(0,160),device:String(event.device||'').slice(0,100),
 originalPhone:String(event.originalPhone||'').slice(0,160),resolutionSource:String(event.resolutionSource||'').slice(0,100),
 confidence:event.number?'HIGH':'NONE',failureReason:event.number?'':String(event.failureReason||'PHONE_NOT_EXPOSED').slice(0,100)};
 if(event.phoneIdentity!==undefined||event.phoneE164!==undefined||event.number.startsWith('+')||event.number.startsWith('00')) {
  result.number=phone?.display||'';result.phoneIdentity=phone?.identity||'';result.phoneE164=phone?.e164||'';result.phoneFormatReason=phone?.reason||'';
 }
 return result;
}
/** Fsync journal is the ACK boundary. Encryption key is protected by the Windows user via DPAPI. */
export async function createLocalReceiver({directory,key,token,deliver,clock=Date.now,retentionDays=30,gridMaxAgeMs=300000,dispatchConfigured=false,gridEnabled=true,pin='',qrEncoder}) {
 if(!Buffer.isBuffer(key)||key.length!==32||!/^\w{64}$/.test(token)||retentionDays<1||retentionDays>365) throw Error('INVALID_CONFIGURATION');
 await mkdir(directory,{recursive:true});const journal=join(directory,'events.enc');const records=new Map();let serial=Promise.resolve();let gridSerial=Promise.resolve();let closing=false;let sequence=0;
 const exclusive=fn=>{const next=serial.then(fn);serial=next.catch(()=>{});return next;};
 let statusSerial=Promise.resolve();let journalBroken=false;
 const id=e=>`${e.deviceId}:${e.eventId}`;
 const devices=new Map();let pairing=null;let pairingBusy=false;let pairingReads=0;let pairingReadWindow=0;
 const encrypt=value=>{const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key,iv);const bytes=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64');};
 const decrypt=line=>{const bytes=Buffer.from(line,'base64');const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'));};
 let data='';try{data=await readFile(journal,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
 const boundary=data.lastIndexOf('\n')+1;
 // Only an incomplete last write can be discarded; corruption of a committed row fails visibly.
 for(const line of data.slice(0,boundary).split('\n').filter(Boolean)){const r=decrypt(line);records.set(id(r.event),r);sequence=Math.max(sequence,r.sequence||0);}
 if(boundary<data.length)await truncate(journal,Buffer.byteLength(data.slice(0,boundary)));
 async function append(record) {
  if(journalBroken)throw Error('JOURNAL_UNAVAILABLE');
  record.sequence=++sequence;
  const handle=await open(journal,'a',0o600);
  try{await handle.writeFile(encrypt(record)+'\n');await handle.sync();}catch(error){journalBroken=true;throw error;}finally{await handle.close();}
  records.set(id(record.event),record);
 }
 async function atomicJson(path,value){const temp=path+'.tmp';const h=await open(temp,'w',0o600);try{await h.writeFile(JSON.stringify(value));await h.sync();}finally{await h.close();}await rename(temp,path);}
 function status() {
  const next=statusSerial.catch(()=>{}).then(async()=>{
  const all=[...records.values()].sort((a,b)=>b.sequence-a.sequence);
  // No pairing secret or phone data in disk status. UI requests decrypted events on loopback TLS.
  await atomicJson(join(directory,'status.json'),{service:'OfficeCalls Local Receiver',version:VERSION,at:clock(),events:records.size,
   unresolved:all.filter(r=>!r.redacted&&!r.event.number).length,pendingGrid:all.filter(r=>r.grid==='PENDING').length,
   uncertainGrid:all.filter(r=>r.grid==='UDP_UNCERTAIN').length,blockedGrid:all.filter(r=>r.grid==='GRID_BLOCKED').length,lastSequence:sequence});
  });statusSerial=next;return next;
 }
 async function deliverOne(keyId) {
  let snapshot=await exclusive(async()=>{
   const r=records.get(keyId);if(!r || r.grid!=='PENDING' || !r.event.number)return null;
   if(clock()-r.event.timestamp>gridMaxAgeMs || r.event.timestamp>clock()+120000){await append({...r,grid:'HISTORY_ONLY',error:'LATE_EVENT_NOT_CURRENT'});return null;}
   try{gridPhone(r.event.number);}catch(e){await append({...r,grid:'GRID_BLOCKED',error:e.message});return null;}
   // Persist intent BEFORE UDP. Interrupted attempts remain visible, never replayed blindly.
   const next={...r,grid:'UDP_UNCERTAIN',error:'DISPLAY_NOT_CONFIRMED'};await append(next);return next;
  });
  if(!snapshot){await status();return;}
  try {await (deliver || (event=>sendOfficeMirror({eventId:event.eventId,phone:event.number},{directory})))(snapshot.event);
   await exclusive(async()=>{const r=records.get(keyId);await append({...r,grid:'UDP_SENT',error:'DISPLAY_NOT_CONFIRMED'});});
  }catch{await exclusive(async()=>{const r=records.get(keyId);await append({...r,grid:'UDP_UNCERTAIN',error:'UDP_ATTEMPT_FAILED_OR_UNCERTAIN'});});}
  await status();
 }
 const queueGrid=keyId=>{gridSerial=gridSerial.then(()=>closing?undefined:deliverOne(keyId)).catch(()=>{});};
 async function accept(input) {
  const event=validate(input);
  const result=await exclusive(async()=>{
   const keyId=id(event);const previous=records.get(keyId);
   if(previous) {
    const old=previous.event;
    if(old.package!==event.package || old.timestamp!==event.timestamp)throw Error('EVENT_ID_CONFLICT');
    if(previous.redacted || event.revision<old.revision)return {eventId:event.eventId,revision:event.revision,receiverAcknowledged:true,gridCms:previous.grid,gridVisibleConfirmed:false};
    if(!previous.redacted && old.number && (old.number!==event.number || ((old.phoneIdentity||old.number)!==(event.phoneIdentity||event.number))))throw Error('NUMBER_IDENTITY_CONFLICT');
    // Older receivers incorrectly stored PHONE_NOT_EXPOSED on successful extraction.
    // This derived diagnostic must not turn an identical lost-ACK retry into a conflict.
    if(event.revision===old.revision && !previous.redacted && JSON.stringify({...old,failureReason:old.number?'':old.failureReason})!==JSON.stringify(event))throw Error('REVISION_CONFLICT');
    if(previous.redacted || event.revision<=old.revision)return {eventId:event.eventId,revision:event.revision,receiverAcknowledged:true,gridCms:previous.grid,gridVisibleConfirmed:false};
   }
   const r={event,receivedAt:previous?.receivedAt||clock(),grid:previous?.grid||(gridEnabled?'NUMBER_UNAVAILABLE':'DISABLED'),dispatch:previous?.dispatch||(dispatchConfigured?'PENDING':'NOT_CONFIGURED'),error:'',sequence:0};
   if(event.number && r.grid==='NUMBER_UNAVAILABLE')r.grid='PENDING';
   await append(r);queueGrid(keyId);
   return {eventId:event.eventId,revision:event.revision,receiverAcknowledged:true,gridCms:r.grid,gridVisibleConfirmed:false};
  });
  // Status failure must not turn a durably committed event into an unacknowledged delivery.
  status().catch(()=>{});return result;
 }
 async function prune() {await exclusive(async()=>{
  let changed=false;
  for(const r of [...records.values()])if(!r.redacted && clock()-r.receivedAt>retentionDays*86400000 && r.grid!=='PENDING' && !['PENDING','RETRYING'].includes(r.dispatch)){
   await append({...r,redacted:true,event:{...r.event,number:'',displayName:'',device:'',originalPhone:'',phoneIdentity:'',phoneE164:'',resolutionSource:'',failureReason:''}});changed=true;
  }
  if(changed){const temp=journal+'.compact';const h=await open(temp,'w',0o600);try{for(const r of records.values())await h.writeFile(encrypt(r)+'\n');await h.sync();}finally{await h.close();}await rename(temp,journal);}
 });}
 function authorized(req){const given=Buffer.from(String(req.headers.authorization||''));const expected=Buffer.from('Bearer '+token);return given.length===expected.length&&timingSafeEqual(given,expected);}
 function listen({port=5051,host='0.0.0.0',tls}) {
  const server=createServer(tls,async(req,res)=>{
   try {
    if(!isLocalAddress(req.socket.remoteAddress||'')){res.writeHead(403);return res.end();}
    const loopback=/^(127\.|::1$)/.test((req.socket.remoteAddress||'').replace(/^::ffff:/,''));
    if(req.method==='GET' && req.url==='/pairing/offer'){
     if(clock()-pairingReadWindow>60000){pairingReads=0;pairingReadWindow=clock();}
     if(++pairingReads>30){res.writeHead(429);return res.end();}
     if(!pairing||pairing.expiresAt<=clock()){res.writeHead(404);return res.end();}
     res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify(pairing.offer));
    }
    if(!authorized(req)){res.writeHead(403);return res.end();}
    const deviceId=String(req.headers['x-officecalls-device']||'');
    if(/^[a-f\d-]{36}$/i.test(deviceId)&&devices.size<256)devices.set(deviceId,{deviceId,lastSeen:clock()});
    let result;
    if(req.method==='GET' && req.url==='/health')result={service:'OfficeCalls Local Receiver',version:VERSION,storageHealthy:!journalBroken,serverTime:clock(),timeZone:CALL_TIME_ZONE};
    else if(req.method==='GET' && req.url==='/history' && loopback)result=journalBroken?{error:'JOURNAL_UNAVAILABLE'}:{events:[...records.values()].filter(r=>!r.redacted).sort((a,b)=>b.event.timestamp-a.event.timestamp).slice(0,200).map(r=>({...r,event:{...r.event,failureReason:r.event.number?'':r.event.failureReason},callTime:formatCallTime(r.event.timestamp)})),timeZone:CALL_TIME_ZONE,devices:[...devices.values()],bridge:api.bridgeStatus||{configured:dispatchConfigured},landline:api.landlineHistory?.()||[]};
    else if(req.method==='GET' && req.url?.startsWith('/pairing/confirm?')){
     const query=new URL(req.url,'https://127.0.0.1').searchParams;
     if(!pairing||pairing.expiresAt<=clock()||query.get('pairId')!==pairing.payload.pairId||query.get('expiresAt')!==String(pairing.expiresAt)) {res.writeHead(410);return res.end();}
     result={pairingConfirmed:true,pairId:pairing.payload.pairId,expiresAt:pairing.expiresAt};
    }
    else if(req.method==='POST' && req.url?.startsWith('/pairing/start?host=') && loopback){
     if(pairingBusy){res.writeHead(429);return res.end();}
     const address=new URL(req.url,'https://127.0.0.1').searchParams.get('host');
     if(!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address||''))throw Error('INVALID_PAIRING_HOST');
     pairingBusy=true;
     try{pairing=await createPairingOffer({host:address,port:server.address().port,token,pin},{clock});
      result={code:pairing.code,expiresAt:pairing.expiresAt,qr:qrEncoder?await qrEncoder(JSON.stringify(pairing.payload)):null};
     }finally{pairingBusy=false;}
    }
    else if(req.method==='POST' && req.url==='/events'){
     let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>16384){res.writeHead(413);res.end();req.destroy();return;}chunks.push(chunk);}
     result=await accept(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    }else{res.writeHead(404);return res.end();}
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(result));
   }catch(e){res.writeHead(e.message.includes('CONFLICT')?409:400);res.end(JSON.stringify({error:'EVENT_REJECTED'}));}
  });
  server.requestTimeout=7000;server.headersTimeout=5000;server.timeout=7000;server.maxConnections=32;server.listen(port,host);return server;
 }
 await prune();await status();for(const [keyId,r] of records)if(r.grid==='PENDING')queueGrid(keyId);
 const api={directory,accept,listen,prune,setDispatch:async(event,value)=>exclusive(async()=>{const r=records.get(id(event));if(!r||r.redacted||r.dispatch===value||r.dispatch==='DELIVERED')return;await append({...r,dispatch:value});}),history:()=>[...records.values()].map(r=>structuredClone(r)),idle:async()=>{await serial;await gridSerial;await serial;await statusSerial;},close:async()=>{closing=true;await serial;await gridSerial;await statusSerial;}};
 return api;
}

export async function runLocalReceiver(config,secrets) {
 await mkdir(config.directory,{recursive:true});const lock=join(config.directory,'receiver.lock');let handle;
 try{handle=await open(lock,'wx');}catch(e){
  if(e.code!=='EEXIST')throw e;const pid=Number(await readFile(lock,'utf8'));
  if(!Number.isSafeInteger(pid)||pid<1)throw Error('INVALID_RECEIVER_LOCK');
  try{process.kill(pid,0);throw Error('RECEIVER_ALREADY_RUNNING');}catch(error){if(error.code!=='ESRCH')throw error;}
  await unlink(lock);handle=await open(lock,'wx');
 }
 await handle.writeFile(String(process.pid));await handle.sync();await handle.close();
 let routing;let legacy;let landline;
 const qr=await import('qrcode');
 const bridgeConfig=config.bridgeConfigFile?JSON.parse((await readFile(config.bridgeConfigFile,'utf8')).replace(/^\uFEFF/,'')):null;
 const mirror=bridgeConfig?.mirror||config.mirror;
 const mirrorDirectory=bridgeConfig?.sourceDirectory?resolve(dirname(config.bridgeConfigFile),bridgeConfig.sourceDirectory):config.directory;
 const receiver=await createLocalReceiver({...config,gridEnabled:mirror?.enabled!==false,deliver:event=>sendOfficeMirror({eventId:event.deviceId+':'+event.eventId,phone:event.number},{directory:mirrorDirectory,host:mirror?.host,port:mirror?.port}),dispatchConfigured:!!config.bridgeConfigFile,key:Buffer.from(secrets.key,'hex'),token:secrets.token,qrEncoder:text=>qr.default.toDataURL(text,{errorCorrectionLevel:'M',width:600,margin:4})});
 if(config.bridgeConfigFile){const {createBridgeRouting}=await import('./bridge-routing.mjs');routing=await createBridgeRouting(receiver,config.bridgeConfigFile);receiver.landlineHistory=routing.landlineHistory;}
 if(config.legacyTcpPort){
  const {createOfficeCallsTcpReceiver}=await import('../../DispatchPro-Site-Bridge/scripts/lib/officecalls-tcp.mjs');
  const {createHash}=await import('node:crypto');
  const office=routing?.config||{tenantId:'local-office'};
  const identity={...office,siteId:office.siteId||'office-'+office.tenantId,officeId:office.officeId||office.tenantId};
  legacy=createOfficeCallsTcpReceiver({...identity,whatsappTcpPort:config.legacyTcpPort,requireEventId:true},{directory:config.directory,host:config.legacyTcpHost||'127.0.0.1',mirror:null,acceptEvent:async(event,raw)=>{
   const hash=createHash('sha256').update(String(raw.device||'legacy')+identity.officeId).digest('hex').slice(0,32);const deviceId=hash.slice(0,8)+'-'+hash.slice(8,12)+'-'+hash.slice(12,16)+'-'+hash.slice(16,20)+'-'+hash.slice(20);
   return receiver.accept({eventId:event.eventId,deviceId,revision:1,package:raw.package==='com.whatsapp.w4b'?'com.whatsapp.w4b':'com.whatsapp',timestamp:Date.parse(event.timestamp),number:event.phone,...(event.phoneIdentity?{phoneIdentity:event.phoneIdentity,phoneE164:event.phoneE164}:{}),displayName:raw.displayName||'',device:raw.device||'Legacy TCP',resolutionSource:'LEGACY_TCP'});
  }});await legacy.listen();
 }
 const server=receiver.listen({port:config.port,tls:{pfx:await readFile(config.certificateFile),passphrase:secrets.password,minVersion:'TLSv1.2'}});
 await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
 if(config.capturePackageDirectory){const {startLandlineRuntime}=await import('./landline-runtime.mjs');landline=await startLandlineRuntime(config);}
 const timer=setInterval(()=>receiver.prune().catch(()=>{}),3600000);timer.unref();
 let dispatchPromise;
 const cycle=()=>{
  if(!routing)return Promise.resolve();if(dispatchPromise)return dispatchPromise;
  dispatchPromise=(async()=>{try{await routing.cycle();}catch{receiver.bridgeStatus={configured:true,dispatch:'RETRYING',landline:'RETRYING'};}finally{if(landline)receiver.bridgeStatus={...receiver.bridgeStatus,capture:landline.status()};}})().finally(()=>{dispatchPromise=undefined;});
  return dispatchPromise;
 };
 const dispatchTimer=setInterval(cycle,2000);dispatchTimer.unref();void cycle();
 let stopped=false;
 const stop=async()=>{if(stopped)return;stopped=true;clearInterval(timer);clearInterval(dispatchTimer);if(server.listening)await new Promise(r=>server.close(r));if(legacy?.server.listening)await legacy.close();await landline?.stop();await receiver.close();await unlink(lock).catch(()=>{});};
 server.on('error',()=>{process.exitCode=1;void stop();});
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
 return {receiver,server,stop,cycle};
}
