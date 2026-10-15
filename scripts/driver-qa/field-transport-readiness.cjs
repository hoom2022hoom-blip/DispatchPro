// Strict TLS health + real local ICE data-channel integration; no microphones,
// driver login, call endpoints, external STUN/TURN or phone interactions.
const fs=require('node:fs'),path=require('node:path'),https=require('node:https'),assert=require('node:assert/strict');
const c=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),out=path.resolve(process.argv[3]);
require('./runtime-preflight.cjs')(c);
function status(route='/qa/status',json=true){return new Promise((resolve,reject)=>{const r=https.get(c.publicOrigin+route,{ca:fs.readFileSync(c.tlsCa),timeout:8000},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>{try{assert.equal(res.statusCode,200);resolve(json?JSON.parse(body):body);}catch(e){reject(e);}});});r.on('error',reject);r.on('timeout',()=>r.destroy(Error('QA TLS timeout')));});}
(async()=>{
 const safe=await status();assert.equal(safe.database,c.database);assert.equal(safe.environment,'DriverQa');assert.equal(safe.externalPush,false);assert.equal(safe.externalSms,false);assert.equal(safe.outboundBlockInstalled,true);
 const [station,office]=await Promise.all([status('/qa/station',false),status('/login',false)]);
 assert.ok(station.includes('qaFixture'));assert.ok(office.includes('<html'));
 const effective=require('./environment.cjs')(c);
 // This describes launch inputs; no process restart or operational configuration edit.
 const configured=Object.keys(effective).filter(k=>/^(Voice|RideCalls)__(IceServers|Turn)/.test(k)&&effective[k]);
 const {chromium}=await import(require('node:url').pathToFileURL(path.join(c.root,'artifacts/maps-reception-20261006/browser-tools/node_modules/playwright/index.mjs')).href);
 const browser=await chromium.launch({channel:'chrome',headless:true,args:require('./local-browser.cjs').args(c)});
 let localIce;
 try{
  const context=await browser.newContext();
  await context.addInitScript({path:path.join(__dirname,'field-ice-observer.js')});
  await context.route('**/*',route=>new URL(route.request().url()).origin===c.publicOrigin?route.continue():route.abort());
  const page=await context.newPage();await page.goto(c.publicOrigin+'/qa/status');
  localIce=await page.evaluate(async()=>{
   const results=[];
   // Two fresh negotiations separated by teardown test reconnection without
   // retaining the old transport. No application call/session is created.
   for(let round=0;round<2;round++){
    const a=new RTCPeerConnection({iceServers:[]}),b=new RTCPeerConnection({iceServers:[]});
    try{
     const pendingA=[],pendingB=[];
     a.onicecandidate=e=>{if(e.candidate){if(b.remoteDescription)void b.addIceCandidate(e.candidate);else pendingB.push(e.candidate);}};
     b.onicecandidate=e=>{if(e.candidate){if(a.remoteDescription)void a.addIceCandidate(e.candidate);else pendingA.push(e.candidate);}};
     const data=a.createDataChannel('qa-local-diagnostic');
     const arrived=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Local ICE timeout')),8000);b.ondatachannel=e=>{e.channel.onmessage=m=>{clearTimeout(timer);resolve(m.data);};};});
     const opened=new Promise(resolve=>data.onopen=resolve);
     await a.setLocalDescription(await a.createOffer());await b.setRemoteDescription(a.localDescription);for(const v of pendingB)await b.addIceCandidate(v);
     await b.setLocalDescription(await b.createAnswer());await a.setRemoteDescription(b.localDescription);for(const v of pendingA)await a.addIceCandidate(v);
     await Promise.race([opened,arrived]);data.send('QA diagnostic '+round);
     const received=await arrived;if(received!=='QA diagnostic '+round)throw Error('Data mismatch');
     const stats=await a.getStats();let selected;
     for(const s of stats.values())if(s.type==='transport'&&s.selectedCandidatePairId)selected=stats.get(s.selectedCandidatePairId);
     if(!selected)for(const s of stats.values())if(s.type==='candidate-pair'&&s.state==='succeeded'&&s.nominated)selected=s;
     const local=selected?stats.get(selected.localCandidateId):null,remote=selected?stats.get(selected.remoteCandidateId):null;
     results.push({round,received:true,localCandidateType:local?.candidateType??null,remoteCandidateType:remote?.candidateType??null,protocol:local?.protocol??null});
    }finally{a.close();b.close();}
   }
   const observed=await globalThis.__qaIceRead();
   if(observed.length!==4||observed.some(row=>row.state!=='closed'))throw Error('Passive observer/cleanup failed');
   return results;
  });
  assert.equal(localIce.length,2);for(const r of localIce){assert.equal(r.received,true);assert.equal(r.localCandidateType,'host');assert.equal(r.remoteCandidateType,'host');}
 }finally{await browser.close();}
 const report={atUtc:new Date().toISOString(),status:'PASS',strictTls:true,qaOfficeAndStationHttp200:true,qaDatabaseMatched:true,externalPush:false,externalSms:false,outboundBlockInstalled:true,
  explicitVoiceIceLaunchKeys:configured.length,voiceIceDefault:'empty',callIceDefault:'public Google STUN fallback; not TURN',localDataChannelRounds:localIce,
  passiveIceObserverAndCleanupVerified:true,phoneMediaTested:false,microphoneUsed:false,newQaCallsMessagesRides:false,driverLoginPerformed:false,productionAccessed:false,settingsChanged:false,
  turnDecision:'Not yet required by evidence. USB reverse does not carry WebRTC media. Phone-office selected ICE pair must be verified in the approved session; relay is needed only if direct connectivity fails or network policy requires it.'};
 fs.writeFileSync(path.join(out,'field-transport-readiness.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error('Readiness failed: '+e.message);process.exitCode=1;});
