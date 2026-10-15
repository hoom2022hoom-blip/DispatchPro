// One small supplemental batch; intentionally excludes all previously passed suites.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const cfg=process.argv[2],out=path.resolve(process.argv[3]);
const c=JSON.parse(fs.readFileSync(cfg,'utf8'));require('./runtime-preflight.cjs')(c);
const report={atUtc:new Date().toISOString(),phoneActions:false,newLiveQaCallsMessagesRides:false,priorSuccessfulSuitesReused:true,stages:[]};
for(const stage of [
 {name:'cross-module-fixtures',program:process.execPath,args:['--experimental-strip-types','--test','tests/qa-field-integration.test.mjs']},
 {name:'strict-tls-and-local-ice',program:process.execPath,args:['scripts/driver-qa/field-transport-readiness.cjs',cfg,out]}
]){
 const log=fs.openSync(path.join(out,'private',stage.name+'.log'),'w');
 const result=spawnSync(stage.program,stage.args,{cwd:c.root,windowsHide:true,timeout:30000,stdio:['ignore',log,log]});fs.closeSync(log);
 report.stages.push({name:stage.name,exitCode:result.status??-1});
}
report.status=report.stages.every(s=>s.exitCode===0)?'PASS':'FAIL';
report.nodeTestsPassed=report.stages[0].exitCode===0?2:0;
report.realLocalDataChannelNegotiationsPassed=report.stages[1].exitCode===0?2:0;
report.phoneAudibleOrMediaTestsPassed=0;
fs.writeFileSync(path.join(out,'field-acceptance-batch.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));process.exitCode=report.status==='PASS'?0:1;
