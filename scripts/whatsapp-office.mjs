import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createOfficeCallsTcpReceiver} from '../DispatchPro-Site-Bridge/scripts/lib/officecalls-tcp.mjs';
import {createReceptionWorker} from './lib/reception-worker.mjs';
import {sendOfficeMirror} from '../DispatchPro-Site-Bridge/scripts/lib/officecalls-mirror.mjs';

let receiver;
const abort=new AbortController();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>abort.abort());
try {
  const index=process.argv.indexOf('--config');
  if(index<0 || !process.argv[index+1])throw Error('Config required');
  const file=resolve(process.argv[index+1]);
  const config=JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));
  if(config.apiUrl!=='https://api.nablustaxi.com' || !config.tenant || !/^[a-f0-9-]{36}$/i.test(config.tenantId))throw Error('Central office identity required');
  const directory=resolve(dirname(file),config.stateDirectory);
  const credentials=JSON.parse(await readFile(resolve(dirname(file),config.credentialsFile),'utf8'));
  if(!credentials.username || !credentials.password)throw Error('Credentials required');
  await mkdir(directory,{recursive:true});
  const binding=JSON.stringify({apiUrl:config.apiUrl,tenant:config.tenant,tenantId:config.tenantId,siteId:config.siteId});
  const manifest=resolve(directory,'whatsapp-binding.json');
  try{await writeFile(manifest,binding,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
  if(await readFile(manifest,'utf8')!==binding)throw Error('State belongs to another office');
  // Reuse the legacy GRIDCMS line-04 broadcast. No UDP listener or iCall changes.
  // TCP receiver mirrors only new durable rings; central retry never mirrors again.
  receiver=createOfficeCallsTcpReceiver({...config,officeId:config.tenantId,requireEventId:true}, {directory:resolve(directory,'calls'),host:config.bindAddress??'0.0.0.0',mirror:event=>sendOfficeMirror(event,{directory:resolve(directory,'calls')}),report:event=>console.log(event.type)});
  await receiver.listen();
  receiver.server.on('error',()=>{process.exitCode=1;abort.abort();});
  const worker=createReceptionWorker({directory,apiUrl:config.apiUrl,tenant:config.tenant,expectedTenantId:config.tenantId,...credentials,bridge:true,requiredFeature:'WhatsApp',report:()=>console.log('central_delivery_pending')});
  console.log(`LISTENING TCP ${config.whatsappTcpPort??5050}; central HTTPS; real call acceptance pending`);
  let failures=0;
  while(!abort.signal.aborted){
    let result;
    try{result=await worker.runOnce();}catch{result={failed:1,delivered:0};}
    failures=result.failed?Math.min(failures+1,6):0;
    if(result.delivered)console.log(`central_acknowledged ${result.delivered}`);
    if(result.failed)console.log('central_delivery_pending; retained for retry');
    try{await delay(failures?Math.min(60000,1000*2**failures):500,undefined,{signal:abort.signal});}catch{break;}
  }
}catch{console.error('WhatsApp receiver could not start; verify configuration, credentials and free TCP port.');process.exitCode=1;}
finally{if(receiver?.server.listening)await receiver.close();}
