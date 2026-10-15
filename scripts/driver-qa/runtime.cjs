const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),https=require('node:https'),{spawn}=require('node:child_process');
const configPath=process.argv[2],config=JSON.parse(fs.readFileSync(configPath,'utf8'));
const tlsOptions=require('./runtime-preflight.cjs')(config),env=require('./environment.cjs')(config);
const children=[];
function start(name,program,args,overrides={}){
 const child=spawn(program,args,{windowsHide:true,cwd:config.root,env:{...env,...overrides},stdio:['ignore','pipe','pipe']});children.push(child);
 const log=fs.createWriteStream(path.join(config.out,'private',name+'.log'),{flags:'a'});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});child.on('exit',code=>{log.end();console.error(name+' exited '+code);});return child.pid;
}
const apiPid=start('api','dotnet',[config.apiDll||path.join(config.out,'api/DispatchPro.Api.dll'),'--contentRoot',path.join(config.root,'backend/DispatchPro.Api')]);
const webPid=start('web',process.execPath,['--require',path.join(__dirname,'web-guard.cjs'),path.join(config.root,'node_modules/next/dist/bin/next'),'start','-H','127.0.0.1','-p',String(config.webPort)],{QA_GUARD_LOG:path.join(config.out,'private/web-egress.jsonl')});
const banner='<div style="position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#fef3c7;color:#713f12;text-align:center;font:700 13px sans-serif;padding:6px">QA — بيئة اختبار معزولة — لا بيانات تشغيل · <a href="/qa/station">محطة اختبار الصوت والرسائل</a></div><script src="/qa/browser-guard.js"></script>';
const browserGuard="document.addEventListener('click',e=>{const a=e.target.closest('a');if(a&&(/^(tel:|sms:|mailto:)/i.test(a.href)||/wa\\.me|whatsapp\\.com/i.test(a.href))){e.preventDefault();e.stopImmediatePropagation();alert('الإرسال الخارجي معطل في QA');}},true);const qaOpen=window.open;window.open=function(url,...rest){if(url&&(/^(tel:|sms:)/i.test(String(url))||/wa\\.me|whatsapp\\.com/i.test(String(url))))return null;return qaOpen.call(window,url,...rest);};";
const handler=async(req,res)=>{
 const current=JSON.parse(fs.readFileSync(configPath,'utf8')),host=req.headers.host||'',origin=req.headers.origin;
 if(origin&&origin!==`https://${host}`&&origin!==`http://${host}`){res.writeHead(403);res.end();return;}
 const route=new URL(req.url,'http://localhost').pathname;
 if(route==='/qa/browser-guard.js'){res.setHeader('Content-Type','text/javascript');res.end(browserGuard);return;}
 if(route==='/qa/station'||route==='/qa/station.js'||route==='/qa/station.css'){
  const file=route.endsWith('.js')?'station.js':route.endsWith('.css')?'station.css':'station.html';
  try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(path.join(config.out,'station',file)));}catch{res.writeHead(503);res.end('QA station preparing');}return;
 }
 const api=route.startsWith('/api/v1/')||route.startsWith('/health/')||route.startsWith('/qa/');
 const headers={...req.headers,host,'x-forwarded-host':host,'x-forwarded-proto':req.headers['cf-visitor']||current.publicOrigin?'https':'http','accept-encoding':'identity'};delete headers['connection'];
 const upstream=http.request({hostname:'127.0.0.1',port:api?config.apiPort:config.webPort,path:req.url,method:req.method,headers},answer=>{
  const html=!api&&(answer.headers['content-type']||'').includes('text/html');
  res.statusCode=answer.statusCode||502;for(const [key,value]of Object.entries(answer.headers))if(value!==undefined&&!['content-length','transfer-encoding','connection','content-encoding'].includes(key))res.setHeader(key,value);
  res.setHeader('X-DispatchPro-QA','isolated');
  if(html){const parts=[];answer.on('data',b=>parts.push(b));answer.on('end',()=>res.end(Buffer.concat(parts).toString('utf8').replace('</body>',banner+'</body>')));}else answer.pipe(res);
 });upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({code:'QA_UPSTREAM_UNAVAILABLE',error:'خدمة الاختبار متوقفة؛ شغّل بيئة QA ثم أعد المحاولة'}));});req.pipe(upstream);
};
const server=http.createServer(handler);
let tlsServer;
if(config.tlsPort){
 tlsServer=https.createServer(tlsOptions,handler);
 tlsServer.listen(config.tlsPort,'127.0.0.1');
}
server.listen(config.gatewayPort,'127.0.0.1',()=>{fs.writeFileSync(path.join(config.out,'runtime.json'),JSON.stringify({supervisor:process.pid,apiPid,webPid,gatewayPort:config.gatewayPort,database:config.database,tenant:config.tenant,isolated:true},null,2));console.log('QA runtime listening');});
function stop(){server.close();tlsServer?.close();for(const child of children)child.kill();process.exit();}process.on('SIGTERM',stop);process.on('SIGINT',stop);
