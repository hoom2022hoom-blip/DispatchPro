// Restart only the dedicated QA API. Office, gateway and production stay up.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn,spawnSync}=require('node:child_process');
const configPath=path.resolve(process.argv[2]),c=JSON.parse(fs.readFileSync(configPath)),dll=path.resolve(process.argv[3]);
(async()=>{
 assert.match(c.database,/^dispatchpro_driverqa_20261012_[a-f0-9]{8}$/);assert.equal(c.apiPort,9027);
 assert.ok(dll.startsWith(path.resolve(c.out)+path.sep));assert.ok(fs.existsSync(dll));
 const status=await fetch(`http://127.0.0.1:${c.apiPort}/qa/status`).then(r=>r.json());assert.equal(status.environment,'DriverQa');assert.equal(status.database,c.database);
 const runtimePath=path.join(c.out,'runtime.json'),runtime=JSON.parse(fs.readFileSync(runtimePath));assert.ok(Number.isInteger(runtime.apiPid));
 const cmd=spawnSync('powershell.exe',['-NoProfile','-Command',`(Get-CimInstance Win32_Process -Filter 'ProcessId=${runtime.apiPid}').CommandLine`],{windowsHide:true,encoding:'utf8'});assert.equal(cmd.status,0);assert.ok(cmd.stdout.includes(c.apiDll));
 process.kill(runtime.apiPid);c.apiDll=dll;fs.writeFileSync(configPath,JSON.stringify(c,null,2));
 const log=fs.openSync(path.join(c.out,'private/api.log'),'a');
 const child=spawn('dotnet',[dll,'--contentRoot',path.join(c.root,'backend/DispatchPro.Api')],{cwd:c.root,windowsHide:true,detached:true,env:require('./environment.cjs')(c),stdio:['ignore',log,log]});child.unref();fs.closeSync(log);runtime.apiPid=child.pid;fs.writeFileSync(runtimePath,JSON.stringify(runtime,null,2));
 for(let n=0;n<40;n++){await new Promise(r=>setTimeout(r,500));try{const s=await fetch(`http://127.0.0.1:${c.apiPort}/qa/status`).then(r=>r.json());assert.equal(s.database,c.database);assert.equal(s.environment,'DriverQa');console.log(JSON.stringify({status:'PASS',restarted:'QA API only',pid:child.pid,productionRestarted:false}));return;}catch{}}
 throw Error('QA API did not become ready');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
