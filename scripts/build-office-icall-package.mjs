import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
const output=path.resolve('.dispatchpro-local/office-icall-package/DispatchPro-Office-iCall');
await fs.mkdir(output,{recursive:true});
const old=JSON.parse(await fs.readFile('DispatchPro-Office-Bridge-FINAL/config.json','utf8'));
if(old.apiUrl!=='https://api.nablustaxi.com')throw Error('Stable API binding required');
const credentials=JSON.parse(await fs.readFile(path.resolve('DispatchPro-Office-Bridge-FINAL',old.credentialsFile),'utf8'));
if(!credentials.username||!credentials.password)throw Error('Missing existing Bridge credentials');
const config={apiUrl:old.apiUrl,bindAddress:'0.0.0.0',udpPort:3520,healthPort:9007,stateDirectory:'data',sources:[{id:'office-caller-id',sourceIp:'192.168.0.90',sourcePort:3520,tenant:old.tenant,tenantId:old.tenantId,credentialsFile:'credentials.json'}]};
await fs.writeFile(path.join(output,'config.json'),JSON.stringify(config,null,2)+'\n');
await fs.writeFile(path.join(output,'credentials.json'),JSON.stringify({username:credentials.username,password:credentials.password},null,2)+'\n',{mode:0o600});
const files=['scripts/central-icall.mjs','scripts/lib/central-icall.mjs','scripts/lib/icall-caller.mjs','scripts/lib/icall-udp.mjs','scripts/lib/reception-worker.mjs','src/lib/call-store.ts','src/lib/local-call-security.ts'];
for(const file of files){let text=await fs.readFile(file,'utf8');if(file.endsWith('.ts'))text=ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 text=text.replaceAll('call-store.ts','call-store.mjs').replaceAll('local-call-security.ts','local-call-security.mjs');
 const target=path.join(output,'app',file.replace(/\.ts$/,'.mjs'));await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,text);
}
for(const name of ['run.mjs','INSTALL.cmd','START.cmd','Install.ps1']){
 const source=path.join('scripts/office-icall-package',name),target=path.join(output,name==='run.mjs'?'app/run.mjs':name);
 if(/\.(ps1|cmd)$/i.test(name)){
  const text=await fs.readFile(source,'utf8');if(/[^\x00-\x7f]/.test(text))throw Error('Installer scripts must be ASCII-safe: '+name);
  await fs.writeFile(target,text.replace(/\r?\n/g,'\r\n'),'ascii');
 }else await fs.copyFile(source,target);
}
await fs.writeFile(path.join(output,'package.json'),'{"name":"dispatchpro-office-icall","private":true,"type":"module"}\n');
await fs.mkdir(path.join(output,'runtime'),{recursive:true});
await fs.copyFile('DispatchPro-Office-Bridge-FINAL/runtime/node.exe',path.join(output,'runtime/node.exe'));
const license=path.resolve('artifacts/office-icall-package/NODE-LICENSE.txt');
await fs.copyFile(license,path.join(output,'runtime/NODE-LICENSE.txt'));
await fs.writeFile(path.join(output,'README.txt'),`DispatchPro Office iCall Receiver\r\nExtract the package on the OFFICE PC, then double-click INSTALL.cmd and approve Windows UAC once.\r\nInstallation: %ProgramData%\\DispatchPro\\Office-iCall\r\nTask: DispatchPro Office iCall Receiver; SYSTEM, at Windows startup, no login required.\r\nLogs: %ProgramData%\\DispatchPro\\Office-iCall\\logs\\receiver-YYYY-MM-DD.log\r\nPending state: data; preserve it across restarts and upgrades.\r\nSource allowed: 192.168.0.90:3520; UDP broadcast listener 0.0.0.0:3520 with reuseAddr.\r\nAPI: https://api.nablustaxi.com; authenticated ingestion using existing private Bridge credentials.\r\nNo Backend, PostgreSQL, Frontend, Node installation, npm install or Npcap required.\r\nGridCMS and Caller-ID are not changed. Do not run a second DispatchPro receiver for the same device.\r\nHealth is loopback only at http://127.0.0.1:9007/health/ready. No router port forwarding required.\r\nLogs contain packet receipt, masked caller, event ID, delivery acknowledgement and retry status; no credentials/tokens/full caller numbers.\r\nThe package contains private credentials. Keep the transfer archive private.\r\nPrepared package only; Live call acceptance is pending.\r\n`);
const manifest=[];
async function walk(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else if(file!==path.join(output,'manifest.json'))manifest.push({file:path.relative(output,file).replaceAll('\\','/'),sha256:crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')});}}
await walk(output);await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({package:output,files:manifest.length,api:config.apiUrl,source:'192.168.0.90:3520',credentialsCopied:true,livePass:false}));
