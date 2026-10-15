import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
const output=path.resolve('artifacts/whatsapp-office/DispatchPro-WhatsApp-Receiver-Dual-Output');
await fs.mkdir(output,{recursive:true});
const currentRoot=path.resolve('artifacts/whatsapp-office/DispatchPro-WhatsApp-Receiver');
const old=JSON.parse(await fs.readFile(path.join(currentRoot,'config.json'),'utf8'));
if(old.apiUrl!=='https://api.nablustaxi.com')throw Error('Central API required');
const credentials=JSON.parse(await fs.readFile(path.resolve(currentRoot,old.credentialsFile),'utf8'));
const config={...old,stateDirectory:'data',credentialsFile:'credentials.json'};
for(const [name,value] of [['config.json',config],['credentials.json',{username:credentials.username,password:credentials.password}]]){
 try{await fs.writeFile(path.join(output,name),JSON.stringify(value,null,2),{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
}
const files=['scripts/whatsapp-office.mjs','scripts/lib/reception-worker.mjs','DispatchPro-Site-Bridge/scripts/lib/officecalls-tcp.mjs','DispatchPro-Site-Bridge/scripts/lib/officecalls-mirror.mjs','DispatchPro-Site-Bridge/src/lib/call-store.ts'];
for(const file of files){
 let content=await fs.readFile(file,'utf8');
 if(file.endsWith('.ts'))content=ts.transpileModule(content,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 content=content.replaceAll('call-store.ts','call-store.mjs');
 const target=path.join(output,'app',file.replace(/\.ts$/,'.mjs'));
 await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,content);
}
await fs.mkdir(path.join(output,'runtime'),{recursive:true});
await fs.copyFile('DispatchPro-Office-Bridge-FINAL/runtime/node.exe',path.join(output,'runtime/node.exe'));
await fs.copyFile('artifacts/office-icall-package/NODE-LICENSE.txt',path.join(output,'runtime/NODE-LICENSE.txt'));
for(const name of ['run.mjs','Install.ps1','InstallerFiles.ps1','INSTALL.cmd']){
 const target=path.join(output,name==='run.mjs'?'app/run.mjs':name);
 const content=await fs.readFile(path.join('scripts/whatsapp-office-package',name),'utf8');
 await fs.writeFile(target,/\.(cmd|ps1)$/.test(name)?content.replace(/\r?\n/g,'\r\n'):content);
}
await fs.writeFile(path.join(output,'START.cmd'),'@echo off\r\ncall "%~dp0INSTALL.cmd"\r\n');
await fs.writeFile(path.join(output,'README.txt'),`WhatsApp incoming calls only. Private package: contains existing office credentials; do not publish.\nExtract on office PC and run START.cmd. No full project or Node installation needed.\nTCP 5050; central delivery exclusively https://api.nablustaxi.com.\nIn OfficeCalls select legacy TCP, enter the OFFICE PC current LAN address and 5050, then Save. No address is hardcoded.\nFor a stable address ask the network administrator for DHCP reservation; no network changes are performed by this package. Automatic discovery is not implemented.\nIf Windows blocks TCP 5050, obtain an explicit administrator change; this package does not change firewall settings.\nKeep config.json, credentials.json and data across upgrades. Failed delivery is retained and retried. Logs contain categories and counts only.\nExisting GRIDCMS output is reused: one UDP broadcast on 3520, line 04, per newly stored ring. No UDP listener or iCall changes. Run one receiver per office.\nA test button creates a synthetic call; it is not live acceptance. Place a real WhatsApp call and verify one event on all Office devices.\n`);
await fs.writeFile(path.join(output,'README.txt'),`DispatchPro WhatsApp Receiver\r\nRun INSTALL.cmd once on the OFFICE PC as administrator. Only installation is interactive.\r\nInstallation: %ProgramData%\\DispatchPro\\WhatsApp-Receiver\r\nTask: DispatchPro WhatsApp Receiver; SYSTEM at Windows startup without login.\r\nHidden noninteractive session, no Taskbar window, no popups. Restart on failure every minute.\r\nLogs: logs\\receiver-YYYY-MM-DD.log; rotated at 10 MB.\r\nTCP 5050 retained. Existing HTTPS delivery, dedupe, retry and central_acknowledged retained. GRIDCMS receives the legacy 83-byte UDP broadcast on 3520, line 04, once per new stored ring. No fixed office-PC IP; phone settings unchanged. No firewall/router/iCall/GridCMS configuration changes. Local output runs independently of internet and central output independently of GRIDCMS. UDP confirms sending only, not GRIDCMS receipt; failed local sends are logged and not replayed to avoid duplicate packets.\r\nSingle task instance plus process lock and exclusive TCP bind. An occupied port is not taken over.\r\nClose any previous manually running WhatsApp receiver before installation.\r\nExisting data and ACK checkpoints are migrated on first install and preserved on updates.\r\nPrivate credentials included: transfer privately. Do not publish. No full project installation required.\r\nRestart field verification is pending. START.cmd is an installer alias, not a manual receiver launcher.\r\n`);
console.log('Private lightweight WhatsApp receiver installer prepared; restart field verification pending.');
