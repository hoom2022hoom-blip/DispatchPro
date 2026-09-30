import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCallStore } from '../../src/lib/call-store.ts';
import { sendOfficeMirror } from './officecalls-mirror.mjs';

// OfficeCallsReceiver.ps1: one UTF-8 JSON line, number then caller, OK <eventId>.
// Preserve the Android ring ID; never deduplicate by phone or a time window.
export function parseOfficeCall(data, config) {
  if (!data || !['incoming_call', 'test'].includes(data.type)) throw Error('Invalid call type');
  const raw = typeof data.number === 'string' && data.number.trim() ? data.number : data.caller;
  if (typeof raw !== 'string' || raw.length > 80) throw Error('Missing phone');
  // Only discard formatting, not arbitrary text that might become a different phone.
  const normalized = raw.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
  if (!/^[+0-9][0-9 ()-]*$/.test(normalized)) throw Error('Invalid phone');
  let phone = normalized.replace(/[^0-9]/g, '');
  if (/^0097[02]/.test(phone)) phone = phone.slice(5);
  else if (/^97[02]/.test(phone)) phone = phone.slice(3);
  if (phone.length === 9 && !phone.startsWith('0')) phone = '0' + phone;
  if (phone.length < 3 || phone.length > 20) throw Error('Invalid phone length');
  if (!Number.isSafeInteger(data.timestamp) || !Number.isFinite(new Date(data.timestamp).getTime())) throw Error('Invalid timestamp');
  if(config.requireEventId && !data.eventId)throw Error('OfficeCalls ring eventId required');
  const eventId = data.eventId || 'legacy-' + createHash('sha256').update(JSON.stringify([config.siteId,config.officeId,data.device??'',phone,data.timestamp])).digest('hex');
  if (typeof eventId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(eventId)) throw Error('Invalid ring ID');
  return {eventId,source:'WHATSAPP',phone,timestamp:new Date(data.timestamp).toISOString(),siteId:config.siteId,officeId:config.officeId};
}

export function createOfficeCallsTcpReceiver(config, {directory, host='0.0.0.0', report=()=>{}, mirror=config.mirror?.enabled?event=>sendOfficeMirror(event,{directory,host:config.mirror.host,port:config.mirror.port}):null}) {
  if (!config.siteId || !config.officeId || config.officeId !== config.tenantId) throw Error('Site and office identity required');
  const port = config.whatsappTcpPort ?? 5050;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid whatsappTcpPort');
  const store = createCallStore(directory);
  let writes=Promise.resolve();
  const server = createServer(socket => {
    let buffer=Buffer.alloc(0), handled=false;
    socket.setTimeout(2500,()=>socket.destroy());
    socket.on('error',()=>{});
    socket.on('data',chunk=>{
      if(handled)return;
      buffer=Buffer.concat([buffer,chunk]);
      if(buffer.length>16384){handled=true;socket.destroy();return;}
      const end=buffer.indexOf(10);if(end<0)return;
      handled=true;socket.pause();
      void (async()=>{
        try {
          const event=parseOfficeCall(JSON.parse(buffer.subarray(0,end).toString('utf8').replace(/^\uFEFF/,'')),config);
          // ACK only after durable, idempotent storage in LANDLINE's existing inbox.
          const commit=writes.then(async()=>{
            let original;
            try{original=JSON.parse(await readFile(join(directory,createHash('sha256').update(event.eventId).digest('hex')+'.json'),'utf8')).event;}catch(error){if(error.code!=='ENOENT')throw error;}
            if(original){
              if(original.phone!==event.phone||original.source!==event.source||original.siteId!==event.siteId||original.officeId!==event.officeId)throw Error('EVENT_ID_CONFLICT');
              return {duplicate:true};
            }
            return store.append(event);
          });
          writes=commit.catch(()=>{});
          const result=await commit;
          socket.end(`OK ${event.eventId}\n`);
          report({type:result.duplicate?'whatsapp_tcp_duplicate':'whatsapp_tcp_stored'});
          // Mirror only a newly committed ring. Mirror errors never roll back or
          // re-send the successful central event; Android retries retain its ID.
          if (!result.duplicate && mirror) {
            try { await mirror(event); report({type:'whatsapp_office_mirrored'}); }
            catch { report({type:'whatsapp_office_mirror_failed'}); }
          }
        } catch { socket.destroy();report({type:'whatsapp_tcp_rejected'}); }
      })();
    });
  });
  server.maxConnections=64;
  return {server,listen:()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.removeListener('error',reject);resolve();});}),close:()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}
