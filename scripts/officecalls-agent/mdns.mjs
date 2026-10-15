import {createSocket} from 'node:dgram';
import {networkInterfaces} from 'node:os';
// DNS-SD response uses PTR, SRV, TXT and A records; discovery failure never blocks cloud polling.
const name=s=>Buffer.concat(s.replace(/\.$/,'').split('.').map(part=>Buffer.concat([Buffer.from([Buffer.byteLength(part)]),Buffer.from(part)] )).concat([Buffer.from([0])]));
function record(owner,type,data){const head=Buffer.alloc(10);head.writeUInt16BE(type,0);head.writeUInt16BE(type===12?1:0x8001,2);head.writeUInt32BE(60,4);head.writeUInt16BE(data.length,8);return Buffer.concat([name(owner),head,data]);}
export function advertise({officeId,instanceId,port,report=()=>{}}){
 const service='_officecalls._tcp.local',instance=`OfficeCalls-${instanceId}.${service}`,host=`officecalls-${instanceId}.local`;
 const addresses=Object.values(networkInterfaces()).flat().filter(x=>x&&!x.internal&&x.family==='IPv4'&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(x.address)).map(x=>x.address);
 if(!addresses.length)return {close(){}};
 const txt=Buffer.from(`officeId=${officeId}`);const srv=Buffer.alloc(6);srv.writeUInt16BE(port,4);
 const records=[record(service,12,name(instance)),record(instance,33,Buffer.concat([srv,name(host)])),record(instance,16,Buffer.concat([Buffer.from([txt.length]),txt])),...addresses.map(address=>record(host,1,Buffer.from(address.split('.').map(Number))))];
 const header=Buffer.alloc(12);header.writeUInt16BE(0x8400,2);header.writeUInt16BE(records.length,6);
 const packet=Buffer.concat([header,...records]);const socket=createSocket({type:'udp4',reuseAddr:true});let ready=false;
 const send=()=>{if(ready)socket.send(packet,5353,'224.0.0.251',()=>{});};
 socket.on('error',()=>report({type:'MDNS_UNAVAILABLE'}));
 socket.on('message',data=>{if(data.length>=12&&(data.readUInt16BE(2)&0x8000)===0&&(data.includes(name(service))||data.includes(name(instance))||data.includes(name(host))))send();});
 socket.bind(5353,'0.0.0.0',()=>{try{socket.addMembership('224.0.0.251');socket.setMulticastTTL(255);ready=true;send();}catch{report({type:'MDNS_UNAVAILABLE'});}});
 const timer=setInterval(send,30000);timer.unref();return {close(){clearInterval(timer);socket.close();}};
}
