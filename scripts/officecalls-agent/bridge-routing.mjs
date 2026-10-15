import {readFile,readdir,open} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createCallStore} from '../../DispatchPro-Site-Bridge/src/lib/call-store.ts';
import {createReceptionWorker,digest} from '../lib/reception-worker.mjs';
import {createOfficeBridge} from '../lib/office-bridge.mjs';
import {createOfficeBridge as createSiteBridge} from '../../DispatchPro-Site-Bridge/scripts/lib/office-bridge.mjs';

export const bridgeEventId=event=>'oc-'+createHash('sha256').update(event.deviceId+':'+event.eventId).digest('hex');
/** Use the already authenticated reception API and its per-event checkpoints. */
export async function createBridgeRouting(receiver,configFile,{fetchImpl=fetch}={}) {
 const config=JSON.parse((await readFile(configFile,'utf8')).replace(/^\uFEFF/,'')),root=dirname(configFile);
 if(!config.tenant||!config.tenantId||config.officeId&&config.officeId!==config.tenantId)throw Error('BRIDGE_IDENTITY_REQUIRED');
 const credentials=config.credentials||JSON.parse((await readFile(resolve(root,config.credentialsFile),'utf8')).replace(/^\uFEFF/,''));
 const binding=JSON.stringify({apiUrl:new URL(config.apiUrl).href,tenant:config.tenant,tenantId:config.tenantId});
 const bindingFile=join(receiver.directory,'dispatch-binding.json');
 try{const handle=await open(bindingFile,'wx',0o600);try{await handle.writeFile(binding);await handle.sync();}finally{await handle.close();}}catch(e){if(e.code!=='EEXIST')throw e;}
 if(await readFile(bindingFile,'utf8')!==binding)throw Error('DISPATCH_OFFICE_IDENTITY_CHANGED');
 const directory=join(receiver.directory,'dispatch-outbox'),store=createCallStore(join(directory,'calls'));
 const worker=createReceptionWorker({directory,apiUrl:config.apiUrl,tenant:config.tenant,expectedTenantId:config.tenantId,...credentials,bridge:true,requiredFeature:'WhatsApp',immutableInbox:true,fetchImpl});
 const source=config.sourceDirectory?resolve(root,config.sourceDirectory):null;
 const state=config.stateDirectory?resolve(root,config.stateDirectory):null;
 let bindingSource=config.sourceDirectory;
 if(source&&state){
  try{const previous=JSON.parse(await readFile(join(state,'office-binding.json'),'utf8'));
   if(previous.apiUrl!==new URL(config.apiUrl).href||previous.tenant!==config.tenant||previous.tenantId!==config.tenantId||resolve(root,previous.source)!==source)throw Error('EXISTING_OFFICE_BINDING_CONFLICT');
   bindingSource=previous.source;
  }catch(error){if(error.code!=='ENOENT')throw error;}
 }
 const landline=source?(config.mode==='local-whatsapp'?createSiteBridge:createOfficeBridge)({...config,sourceDirectory:source,stateDirectory:state,bindingSource,immutableInbox:true},credentials,{fetchImpl}):null;
 const checkpoint=join(directory,'reception-worker',digest(`${new URL(config.apiUrl).href.replace(/\/$/,'')}\n${config.tenantId}`));
 let serial=Promise.resolve();let lastLandline=[];const staged=new Set(),seenLandlineFiles=new Set();
 async function cycle() {
  const run=async()=>{
   const rows=receiver.history().filter(r=>!r.redacted);
   for(const r of rows) {
    if(r.dispatch==='DELIVERED')continue;
    if(!r.event.number){await receiver.setDispatch(r.event,'NUMBER_UNAVAILABLE');continue;}
    const eventId=bridgeEventId(r.event);
    const event={eventId,source:'WHATSAPP',phone:r.event.number,timestamp:new Date(r.event.timestamp).toISOString()};
    // Name-only revisions do not alter the immutable reception event fingerprint.
    if(!staged.has(eventId)){await store.append(event);staged.add(eventId);}await receiver.setDispatch(r.event,'PENDING');
   }
   let result;try{result=await worker.runOnce();}catch{result={failed:1,delivered:0};}
   for(const r of rows.filter(r=>r.event.number&&r.dispatch!=='DELIVERED')) {
    const file=digest(bridgeEventId(r.event))+'.json';
    try {const saved=JSON.parse(await readFile(join(checkpoint,file),'utf8'));
     const event={eventId:bridgeEventId(r.event),source:'WHATSAPP',phone:r.event.number,timestamp:new Date(r.event.timestamp).toISOString()};
     if(saved.hash===digest(JSON.stringify(event)))await receiver.setDispatch(r.event,'DELIVERED');
    }catch(error){if(error.code!=='ENOENT')throw error;}
   }
   if(landline){try{const state=await landline.runOnce();receiver.bridgeStatus={configured:true,dispatch:result.failed?'RETRYING':'READY',landline:state.failed?'RETRYING':'READY'};}catch{receiver.bridgeStatus={configured:true,dispatch:result.failed?'RETRYING':'READY',landline:'RETRYING'};}
    const files=(await readdir(source).catch(()=>[])).filter(f=>/^[a-f0-9]{64}\.json$/.test(f));
    const fresh=files.filter(f=>!seenLandlineFiles.has(f));
    for(let offset=0;offset<fresh.length;offset+=16){
     const batch=await Promise.all(fresh.slice(offset,offset+16).map(async f=>{try{const record=JSON.parse(await readFile(join(source,f),'utf8'));seenLandlineFiles.add(f);return record;}catch{return null;}}));
     lastLandline=[...lastLandline,...batch.filter(r=>r?.event?.source==='LANDLINE_ICALL')].sort((a,b)=>Date.parse(b.event.timestamp)-Date.parse(a.event.timestamp)).slice(0,100);
    }
    for(const record of lastLandline){
     if(record.dispatch==='DELIVERED')continue;
     const file=digest(record.event.eventId)+'.json';
     try{const persisted=JSON.parse(await readFile(join(state,'calls',file),'utf8'));const ack=JSON.parse(await readFile(join(state,'reception-worker',digest(`${new URL(config.apiUrl).href.replace(/\/$/,'')}\n${config.tenantId}`),file),'utf8'));record.dispatch=ack.hash===digest(JSON.stringify(persisted.event))?'DELIVERED':'PENDING';}
     catch{record.dispatch='PENDING';}
    }
   }else receiver.bridgeStatus={configured:true,dispatch:result.failed?'RETRYING':'READY',landline:'NOT_CONFIGURED'};
   return result;
  };
  const next=serial.then(run);serial=next.catch(()=>{});return next;
 }
 return {cycle,landlineHistory:()=>lastLandline,config};
}
