import {readFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {connect} from 'node:net';

/** Own only the existing Caller-ID executable launched by this instance.
 * Never stop, replace, or duplicate a capture service already running at the office. */
export async function startLandlineRuntime(config) {
 if(!config.capturePackageDirectory||!config.startLandlineCapture)return {status:()=>config.capturePackageDirectory?'EXISTING_INBOX_ONLY':'NOT_CONFIGURED',stop:async()=>{}};
 const root=config.capturePackageDirectory,exe=join(root,'DispatchPro-Icall-Test.exe');await access(exe);
 const port=config.landlineHttpPort||9007;
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('INVALID_LANDLINE_PORT');
 try {
  const pid=Number(await readFile(join(root,'data/bridge-start.lock'),'utf8'));
  if(Number.isSafeInteger(pid)&&pid>0){try{process.kill(pid,0);return {status:()=> 'EXISTING_CAPTURE_OBSERVED',stop:async()=>{}};}catch(e){if(e.code!=='ESRCH')throw e;}}
 }catch(e){if(e.code!=='ENOENT')throw e;}
 const occupied=await new Promise(resolve=>{const socket=connect(port,'127.0.0.1');socket.setTimeout(1000);socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(true);});});
 if(occupied)return {status:()=> 'EXISTING_CAPTURE_OR_PORT_OCCUPIED',stop:async()=>{}};
 let error=false;
 const child=spawn(exe,[],{cwd:root,env:{...process.env,DISPATCHPRO_ICALL_HTTP_PORT:String(port)},windowsHide:true,stdio:'ignore'});
 child.on('error',()=>{error=true;});
 return {status:()=>error||child.exitCode!==null?'CAPTURE_STOPPED':'CAPTURE_PROCESS_RUNNING_UNVERIFIED',stop:async()=>{
  if(child.pid&&child.exitCode===null)await new Promise(resolve=>{const kill=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});kill.on('exit',resolve);kill.on('error',resolve);});
 }};
}
