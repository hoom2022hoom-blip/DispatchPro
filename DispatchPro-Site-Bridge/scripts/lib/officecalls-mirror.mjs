import {createSocket} from 'node:dgram';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export function officePacketKey(payload, now=new Date()) {
  return createHash('sha256').update(`${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()}\n`).update(payload).digest('hex');
}

// Byte-for-byte wire format from OfficeCallsReceiver.ps1 New-WhozzCallingPayload.
// Line 04 is WhatsApp. The destination is the old receiver's existing destination.
export function officeMirrorPayload(phone, now=new Date()) {
  const header=Buffer.from([0x5e,0x5e,0x3c,0x55,0x3e,0,0,0,0,0,1,0x3c,0x53,0x3e,0x17,0,0x16,7,0x18,0x60,0x24]);
  const digits=phone.replace(/[^0-9]/g,'').slice(0,15);
  const dashed=(digits.length===10?`${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`:digits.length===9?`${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`:digits).slice(0,15);
  const pad=value=>String(value).padStart(2,'0');
  const stamp=`${pad(now.getMonth()+1)}/${pad(now.getDate())} ${pad(now.getHours()%12||12)}:${pad(now.getMinutes())} ${now.getHours()<12?'AM':'PM'}`;
  const record=Buffer.from(`04 I S 0000 G B1 ${stamp} ${dashed.padEnd(15)}${digits.padEnd(15)}`,'ascii');
  if(record.length!==62)throw Error('Invalid office mirror record');
  return Buffer.concat([header,record]);
}

export async function sendOfficeMirror(event,{host='255.255.255.255',port=3520,directory}={}) {
  const payload=officeMirrorPayload(event.phone);
  if(directory){
    const markers=join(directory,'..','office-mirror-packets');
    await mkdir(markers,{recursive:true});
    // Persist before sending: the UDP reader must not ingest our own mirror.
    await writeFile(join(markers,officePacketKey(payload)+'.json'),JSON.stringify({eventId:event.eventId}));
  }
  return new Promise((resolve,reject)=>{
    const udp=createSocket('udp4');let finished=false;
    const finish=error=>{if(finished)return;finished=true;clearTimeout(timer);udp.close();error?reject(error):resolve();};
    const timer=setTimeout(()=>finish(Error('Office mirror timeout')),1500);
    udp.on('error',finish);
    udp.bind(0,()=>{try{udp.setBroadcast(true);udp.send(payload,port,host,finish);}catch(error){finish(error);}});
  });
}
