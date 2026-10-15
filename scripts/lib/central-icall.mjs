import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { isIP } from 'node:net';
import { createSocket } from 'node:dgram';
import { createServer } from 'node:http';
import { createCallerProcessor } from './icall-caller.mjs';
import { createCallStore } from '../../src/lib/call-store.ts';
import { createReceptionWorker, digest } from './reception-worker.mjs';
import { localCallToken, validToken } from '../../src/lib/local-call-security.ts';

export function validateCentralConfig(config) {
  const url = new URL(config.apiUrl);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname)))) throw Error('HTTPS API origin required');
  if (isIP(config.bindAddress) !== 4 || !Number.isInteger(config.udpPort) || config.udpPort < 0 || config.udpPort > 65535 ||
      !Number.isInteger(config.healthPort) || config.healthPort < 0 || config.healthPort > 65535 || !config.stateDirectory ||
      !Array.isArray(config.sources) || !config.sources.length || config.sources.length > 32) throw Error('Invalid central receiver configuration');
  const ids = new Set(), ips = new Set();
  for (const source of config.sources) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(source.id) || isIP(source.sourceIp) !== 4 || ids.has(source.id) || ips.has(source.sourceIp) ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(source.tenantId) || typeof source.tenant !== 'string' || !source.tenant.trim() ||
        typeof source.credentialsFile !== 'string' || !source.credentialsFile || (source.sourcePort !== undefined && (!Number.isInteger(source.sourcePort) || source.sourcePort < 1 || source.sourcePort > 65535))) throw Error('Each Caller-ID source needs a unique IP/id and explicit office binding');
    ids.add(source.id); ips.add(source.sourceIp);
  }
}

// One service owns UDP. Every device is bound by server configuration to one office;
// neither Caller-ID payloads nor browsers choose a tenant or hold bridge credentials.
export async function createCentralIcall(config, { configDirectory = process.cwd(), fetchImpl = fetch, report = () => {}, clock = () => Date.now() } = {}) {
  validateCentralConfig(config);
  const stateRoot = resolve(configDirectory, config.stateDirectory);
  await mkdir(stateRoot, { recursive: true });
  const binding = JSON.stringify({ apiUrl: new URL(config.apiUrl).origin, sources: config.sources.map(({id,sourceIp,sourcePort,tenant,tenantId}) => ({id,sourceIp,...(sourcePort===undefined?{}:{sourcePort}),tenant,tenantId})).sort((a,b)=>a.id.localeCompare(b.id)) });
  const manifest = join(stateRoot, 'office-binding.json');
  try { await writeFile(manifest, binding, { flag:'wx',mode:0o600 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  if (await readFile(manifest,'utf8') !== binding) throw Error('Receiver state belongs to different sources/offices; preserve it and use an explicitly separate state directory');
  const token = await localCallToken(stateRoot);
  const channels = new Map();
  const stats = { startedAt:new Date(clock()).toISOString(), packets:0, unknownSourcePackets:0, oversizedPackets:0, overloadPackets:0, lastPacketAt:null, lastUnknownSourceIp:null };
  let socket, http, socketReady=false, closing=false, cyclePromise;
  for (const source of config.sources) {
    const credentials = JSON.parse(await readFile(resolve(configDirectory,source.credentialsFile),'utf8'));
    if (!credentials.username || !credentials.password) throw Error('Bridge credentials are missing');
    const directory = join(stateRoot,source.id), outbox = join(directory,'outbox');
    const journal = createCallStore(join(outbox,'calls'));
    const state = { id:source.id, sourceIp:source.sourceIp, tenantId:source.tenantId, packets:0, parsed:0, duplicates:0, unrecognized:0, storageFailures:0, storageError:null, delivered:0, pending:0, lastPacketAt:null, lastParsedAt:null, lastAckAt:null, upstream:'NOT_CHECKED', upstreamError:null };
    const processor = await createCallerProcessor({ directory:join(directory,'parser'),sourceIp:source.sourceIp,clock,
      send:async event=>{await journal.append(event);report({type:'call_persisted',sourceId:source.id,eventId:event.eventId,callerMasked:'***'+event.phone.slice(-3)});},
    });
    const worker = createReceptionWorker({directory:outbox,apiUrl:config.apiUrl,tenant:source.tenant,expectedTenantId:source.tenantId,username:credentials.username,password:credentials.password,bridge:true,requiredFeature:'CallerId',fetchImpl,
      onDelivered:event=>report({type:'call_delivered',sourceId:source.id,eventId:event.eventId}),
      report:()=>{state.upstreamError='DELIVERY_RETRY';report({type:'delivery_retry',sourceId:source.id});} });
    channels.set(source.sourceIp,{source,state,processor,worker,outbox,inflight:0});
  }
  function status() {
    return { mode:'CENTRAL_ICALL', transportReady:socketReady, ingestionReady:socketReady&&[...channels.values()].every(c=>c.state.upstream==='READY'&&!c.state.storageError),
      liveCallVerified:false, ...stats, sources:[...channels.values()].map(c=>({...c.state})) };
  }
  async function receive(packet, remoteIp, remotePort) {
    stats.packets++;stats.lastPacketAt=new Date(clock()).toISOString();
    const channel=channels.get(remoteIp);
    if(!channel){stats.unknownSourcePackets++;stats.lastUnknownSourceIp=remoteIp;return {accepted:false,reason:'UNCONFIGURED_SOURCE'};}
    if(channel.source.sourcePort!==undefined&&remotePort!==channel.source.sourcePort){stats.unknownSourcePackets++;return {accepted:false,reason:'UNCONFIGURED_SOURCE_PORT'};}
    report({type:'packet_received',sourceId:channel.source.id,sourceIp:remoteIp,sourcePort:remotePort,bytes:packet.length});
    const {state,processor}=channel;state.packets++;state.lastPacketAt=stats.lastPacketAt;
    if(packet.length>4096){stats.oversizedPackets++;return {accepted:false,reason:'OVERSIZED_PACKET'};}
    if(channel.inflight>=128){stats.overloadPackets++;return {accepted:false,reason:'RECEIVER_OVERLOAD'};}
    channel.inflight++;
    try {
      const result=await processor.receive(packet,remoteIp,stats.lastPacketAt);
      if(!result){state.unrecognized++;return {accepted:false,reason:'UNRECOGNIZED_PROTOCOL'};}
      if(result.event){state.lastParsedAt=new Date(clock()).toISOString();if(result.duplicate)state.duplicates++;else state.parsed++;}
      // Parse state persists before this journal write; retry recovers a failed write.
      await processor.retry();
      state.storageError=null;
      return {accepted:true,duplicate:!!result.duplicate,ended:!!result.ended};
    }catch{state.storageFailures++;state.storageError='JOURNAL_RETRY';report({type:'storage_retry',sourceId:state.id});return {accepted:false,reason:'STORAGE_RETRY'};}
    finally{channel.inflight--;}
  }
  async function pendingCount(channel) {
    const files=(await readdir(join(channel.outbox,'calls')).catch(e=>{if(e.code==='ENOENT')return [];throw e;})).filter(f=>/^[a-f0-9]{64}\.json$/.test(f));
    const checkpoints=join(channel.outbox,'reception-worker',digest(`${new URL(config.apiUrl).href.replace(/\/$/,'')}\n${channel.source.tenantId}`));
    const done=new Set((await readdir(checkpoints).catch(e=>{if(e.code==='ENOENT')return [];throw e;})).filter(f=>/^[a-f0-9]{64}\.json$/.test(f)));
    const pending=new Set(files.filter(f=>!done.has(f)));
    for(const id of await channel.processor.pendingIds())pending.add(digest(id)+'.json');
    return pending.size;
  }
  async function cycle() {
    if(cyclePromise)return cyclePromise;
    cyclePromise=Promise.all([...channels.values()].map(async channel=>{
      const {state,processor,worker}=channel;
      try {
        try{await processor.retry();state.storageError=null;}catch{state.storageError='JOURNAL_RETRY';state.storageFailures++;throw Error('Parser journal unavailable');}
        const result=await worker.runOnce();state.upstream=result.failed?'RETRYING':'READY';state.upstreamError=result.failed?'DELIVERY_RETRY':null;
        state.delivered+=result.delivered;if(result.delivered)state.lastAckAt=new Date(clock()).toISOString();
      }catch(error){state.upstream='RETRYING';state.upstreamError=/tenant identity/.test(error.message)?'TENANT_IDENTITY_REJECTED':/feature is disabled/.test(error.message)?'CALLER_ID_DISABLED':'AUTH_OR_API_UNAVAILABLE';}
      try{state.pending=await pendingCount(channel);}catch{state.upstream='RETRYING';state.upstreamError='OUTBOX_UNAVAILABLE';}
    })).finally(()=>{cyclePromise=undefined;});
    return cyclePromise;
  }
  async function start() {
    if(socket)throw Error('Receiver already started');
    // Field-confirmed limited broadcast; allow GridCMS to keep UDP 3520.
    socket=createSocket({type:'udp4',reuseAddr:true});
    socket.on('message',(packet,remote)=>{if(!closing)void receive(packet,remote.address,remote.port);});
    await new Promise((resolveReady,reject)=>{socket.once('error',reject);socket.once('listening',()=>{socket.removeListener('error',reject);socketReady=true;resolveReady();});socket.bind(config.udpPort,config.bindAddress);});
    socket.on('error',()=>{socketReady=false;report({type:'udp_error'});});
    http=createServer((req,res)=>{
      res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
      const path=new URL(req.url,'http://127.0.0.1').pathname;
      if(req.method!=='GET'){res.writeHead(405);res.end('{}');return;}
      if(path==='/health/live'||path==='/health/ready'){
        const current=status(),ready=path.endsWith('live')?socketReady:current.ingestionReady;
        res.writeHead(ready?200:503);res.end(JSON.stringify({mode:current.mode,transportReady:current.transportReady,ingestionReady:current.ingestionReady,liveCallVerified:false}));return;
      }
      if(path!=='/status'){res.writeHead(404);res.end('{}');return;}
      if(!validToken(new Request('http://127.0.0.1/status',{headers:req.headers}),token)){res.writeHead(401);res.end('{}');return;}
      res.end(JSON.stringify(status()));
    });
    try{await new Promise((ready,reject)=>{http.once('error',reject);http.listen(config.healthPort,'127.0.0.1',ready);});}
    catch(error){await stop();throw error;}
    report({type:'transport_bound',udpPort:socket.address().port,healthPort:http.address().port});
    return {udpPort:socket.address().port,healthPort:http.address().port};
  }
  async function stop(){closing=true;socketReady=false;await Promise.all([socket?new Promise(r=>{try{socket.close(r);}catch{r();}}):null,http?.listening?new Promise(r=>http.close(r)):null]);}
  return {receive,cycle,status,start,stop};
}
