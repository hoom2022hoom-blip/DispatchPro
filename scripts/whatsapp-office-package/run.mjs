import {mkdirSync,appendFileSync,existsSync,statSync,openSync,readFileSync,writeFileSync,closeSync,unlinkSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const logs=join(root,'logs');
mkdirSync(logs,{recursive:true});
function record(level,args){
 const at=new Date().toISOString();let index=0,file;
 do{file=join(logs,`receiver-${at.slice(0,10)}${index?'-'+index:''}.log`);index++;}while(existsSync(file)&&statSync(file).size>10485760);
 appendFileSync(file,JSON.stringify({at,level,message:args.join(' ')})+'\n',{mode:0o600});
}
console.log=(...args)=>record('INFO',args);
console.error=(...args)=>record('ERROR',args);
console.warn=(...args)=>record('WARN',args);
process.on('uncaughtException',()=>{try{record('ERROR',['receiver_uncaught_exception']);}finally{process.exit(1);}});
process.on('unhandledRejection',()=>{try{record('ERROR',['receiver_unhandled_rejection']);}finally{process.exit(1);}});
const state=join(root,'data');mkdirSync(state,{recursive:true});
const lockFile=join(state,'receiver.lock');let lock;
try{
 try{lock=openSync(lockFile,'wx',0o600);}catch(error){
  if(error.code!=='EEXIST')throw error;
  const pid=Number(readFileSync(lockFile,'utf8'));let active=false;
  if(Number.isInteger(pid)&&pid>0){try{process.kill(pid,0);active=true;}catch(error){if(error.code!=='ESRCH')active=true;}}
  if(active){record('INFO',['receiver_already_running']);process.exit(0);}
  unlinkSync(lockFile);lock=openSync(lockFile,'wx',0o600);
 }
 writeFileSync(lock,String(process.pid));
 process.chdir(root);process.argv.push('--config',join(root,'config.json'));
 await import('./scripts/whatsapp-office.mjs');
}catch{record('ERROR',['receiver_startup_failed']);process.exitCode=1;}
finally{if(lock!==undefined){closeSync(lock);try{unlinkSync(lockFile);}catch{}}}
