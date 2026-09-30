import {networkInterfaces} from 'node:os';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {createCallStore} from '../../src/lib/call-store.ts';
import {officePacketKey} from './officecalls-mirror.mjs';

const header=Buffer.from('5e5e3c553e0000000000013c533e17001607186024','hex');
// Exact legacy OfficeCalls output: 21-byte Whozz Calling header + 62-byte line 04.
export function parseOfficeOutput(packet) {
  if(packet.length!==83||!packet.subarray(0,21).equals(header))return null;
  const text=packet.subarray(21).toString('ascii');
  if(!/^04 I S 0000 G B1 \d{2}\/\d{2} \d{2}:\d{2} (AM|PM) /.test(text))return null;
  const formatted=text.slice(32,47).trim(),raw=text.slice(47,62).trim();
  if(!/^[0-9-]{3,15}$/.test(formatted)||!/^\d{3,15}$/.test(raw)||formatted.replaceAll('-','')!==raw)return null;
  return raw;
}

export function createOfficeOutputReceiver(config,{directory,localAddresses,report=()=>{}}) {
  if(!config.siteId||config.officeId!==config.tenantId)throw Error('Invalid office output identity');
  const locals=new Set(localAddresses??Object.values(networkInterfaces()).flat().filter(Boolean).map(i=>i.address));
  const store=createCallStore(directory);let queue=Promise.resolve();
  return {receive(packet,sourceIp,timestamp=new Date().toISOString()) {
    const task=async()=>{
      // This branch never accepts the physical LANDLINE device.
      if(sourceIp==='192.168.0.90'||!locals.has(sourceIp))return null;
      const phone=parseOfficeOutput(packet);if(!phone)return null;
      const now=new Date(timestamp);if(!Number.isFinite(now.getTime()))throw Error('Invalid capture time');
      const packetKey=officePacketKey(packet,now);
      try{await readFile(join(directory,'..','office-mirror-packets',packetKey+'.json'));report({type:'office_output_own_mirror_ignored'});return {ignored:true};}catch(e){if(e.code!=='ENOENT')throw e;}
      const eventId='office-output-'+createHash('sha256').update(`${config.siteId}\n${config.officeId}\n${packetKey}`).digest('hex');
      let event={eventId,source:'WHATSAPP',phone,timestamp:now.toISOString(),siteId:config.siteId,officeId:config.officeId};
      // Keep the first receive time across duplicate packets and restarts.
      try{event=JSON.parse(await readFile(join(directory,createHash('sha256').update(eventId).digest('hex')+'.json'),'utf8')).event;}catch(e){if(e.code!=='ENOENT')throw e;}
      const result=await store.append(event);
      report({type:result.duplicate?'office_output_duplicate':'office_output_stored'});
      return {event,duplicate:result.duplicate};
    };
    const result=queue.then(task);queue=result.catch(()=>{});return result;
  }};
}
