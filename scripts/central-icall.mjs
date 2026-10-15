import { readFile, mkdir, open, unlink } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createCentralIcall, validateCentralConfig } from './lib/central-icall.mjs';

const index=process.argv.indexOf('--config');
if(index<0||!process.argv[index+1]){console.error('Usage: node --experimental-strip-types scripts/central-icall.mjs --config <config.json>');process.exit(1);}
const path=resolve(process.argv[index+1]);
let receiver,lock,lockPath,stopped=false;
const abort=new AbortController();
async function stop(){if(stopped)return;stopped=true;abort.abort();await receiver?.stop();if(lock){await lock.close();await unlink(lockPath).catch(()=>{});}}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void stop();});
try{
  const config=JSON.parse(await readFile(path,'utf8'));validateCentralConfig(config);
  const directory=resolve(dirname(path),config.stateDirectory);await mkdir(directory,{recursive:true});lockPath=join(directory,'receiver.lock');
  try{lock=await open(lockPath,'wx');}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    const pid=Number(await readFile(lockPath,'utf8'));let alive=true;
    try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}
    if(alive)throw Error('Central receiver is already running; no duplicate started');
    await unlink(lockPath);lock=await open(lockPath,'wx');
  }
  await lock.writeFile(String(process.pid));
  receiver=await createCentralIcall(config,{configDirectory:dirname(path),report:event=>console.log(JSON.stringify({at:new Date().toISOString(),...event}))});
  await receiver.start();
  let failures=0,previous;
  while(!stopped){
    await receiver.cycle();const status=receiver.status();
    const summary=JSON.stringify({transportReady:status.transportReady,ingestionReady:status.ingestionReady,packets:status.packets,unknownSourcePackets:status.unknownSourcePackets,sources:status.sources.map(({id,packets,parsed,duplicates,unrecognized,delivered,pending,upstream,upstreamError})=>({id,packets,parsed,duplicates,unrecognized,delivered,pending,upstream,upstreamError}))});
    if(summary!==previous){console.log(summary);previous=summary;}
    failures=status.ingestionReady?0:Math.min(failures+1,5);
    try{await delay(failures?Math.min(30000,1000*2**failures):1000,undefined,{signal:abort.signal});}catch{break;}
  }
  await stop();
}catch(error){console.error(error.code==='EADDRINUSE'?'Central receiver port is occupied; no service was replaced.':`Central receiver could not start (${error.code||error.name}); verify config, office binding and storage.`);await stop();process.exitCode=1;}
