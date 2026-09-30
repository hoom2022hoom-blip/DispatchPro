import {readFile,mkdir,appendFile,open,unlink,stat,rename} from 'node:fs/promises';
import {dirname,join,resolve,isAbsolute,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createOfficeCallsTcpReceiver} from './scripts/lib/officecalls-tcp.mjs';
import {createOfficeBridge} from './scripts/lib/office-bridge.mjs';

const root=dirname(fileURLToPath(import.meta.url));
process.chdir(root);
let receiver,lock,lockFile,logFile,stopping=false;
const abort=new AbortController();
function inside(path) {
  if(typeof path!=='string'||!path||isAbsolute(path)||path.includes(':')||relative(root,resolve(root,path)).startsWith('..'))throw Error('Paths must stay inside the portable package');
  return resolve(root,path);
}
async function log(message) {
  console.log(message);
  if(!logFile)return;
  try {
    if((await stat(logFile).catch(()=>({size:0}))).size>2097152)await rename(logFile,logFile+'.previous').catch(()=>{});
    await appendFile(logFile,`${new Date().toISOString()} ${message}\n`);
  }catch{/* A logging failure must not interrupt durable reception. */}
}
async function stop() {
  if(stopping)return;stopping=true;abort.abort();
  if(receiver?.server.listening)await receiver.close();
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void stop();});

try {
  const config=JSON.parse((await readFile(join(root,'site-config.json'),'utf8')).replace(/^\uFEFF/,''));
  const url=new URL(config.apiUrl);
  if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('This site requires the local DispatchPro API');
  if(!config.siteId||!config.tenant||config.officeId!==config.tenantId||!config.credentials?.username||!config.credentials?.password)throw Error('Complete local office identity and credentials in site-config.json');
  const source=inside(config.sourceDirectory),state=inside(config.stateDirectory);
  logFile=inside(config.logFile);
  await mkdir(dirname(logFile),{recursive:true});await mkdir(source,{recursive:true});await mkdir(state,{recursive:true});
  lockFile=join(state,'site.lock');
  try{lock=await open(lockFile,'wx');}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    const pid=Number(await readFile(lockFile,'utf8'));let active=false;
    if(Number.isInteger(pid)&&pid>0){try{process.kill(pid,0);active=true;}catch(e){if(e.code!=='ESRCH')active=true;}}
    if(active){await log('Site Bridge is already running.');process.exit(0);}
    await unlink(lockFile);lock=await open(lockFile,'wx');
  }
  await lock.writeFile(String(process.pid));
  receiver=createOfficeCallsTcpReceiver(config,{directory:source,host:config.whatsappTcpHost??'0.0.0.0',report:event=>{void log(event.type);}});
  // Bind first: calls are stored and ACKed even while the local API is restarting.
  await receiver.listen();
  receiver.server.on('error',error=>{void log(`TCP listener error: ${error.code??'unknown'}`);void stop();});
  const bridge=createOfficeBridge(config,config.credentials,{report:event=>{void log(event.type);}});
  await log(`READY: OfficeCalls TCP ${config.whatsappTcpPort}; local DispatchPro ${url.origin}; mirror ${config.mirror?.enabled?'enabled':'disabled'}`);
  let failures=0,connected=false;
  while(!stopping){
    let result;
    try{result=await bridge.runOnce();}catch{result={failed:1};}
    if(result.failed||result.rejected){failures=Math.min(failures+1,6);connected=false;await log('Local API delivery pending; calls retained for automatic retry.');}
    else{failures=0;if(!connected){await log('Local DispatchPro connected.');connected=true;}}
    if(result.imported||result.delivered)await log(JSON.stringify(result));
    try{await delay(failures?Math.min(15000,500*2**failures):500,undefined,{signal:abort.signal});}catch{break;}
  }
}catch(error){
  await log(error.code==='EADDRINUSE'?'TCP 5050 is occupied. Stop the old OfficeCalls receiver; Site Bridge is the official receiver.':`Site Bridge error: ${error.code??error.message}`);
  process.exitCode=1;
}finally{
  await stop();
  if(lock){await lock.close();await unlink(lockFile).catch(()=>{});}
}
