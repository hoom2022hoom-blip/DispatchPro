// Trust exactly the local QA server key in a separate Chrome profile. No global
// certificate store changes and no general ignore-certificate-errors flag.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{X509Certificate,createHash}=require('node:crypto'),{spawn}=require('node:child_process');
function args(c){
 assert.equal(c.publicOrigin,'https://localhost:9443');
 const leaf=new X509Certificate(fs.readFileSync(c.tlsCert)),ca=new X509Certificate(fs.readFileSync(c.tlsCa));
 assert.equal(leaf.checkHost('localhost'),'localhost');assert.ok(leaf.verify(ca.publicKey));
 assert.ok(Date.parse(leaf.validTo)>Date.now());assert.ok(Date.parse(leaf.validFrom)<=Date.now());
 const pin=createHash('sha256').update(leaf.publicKey.export({type:'spki',format:'der'})).digest('base64');
 return ['--ignore-certificate-errors-spki-list='+pin,'--no-first-run','--disable-background-networking'];
}
module.exports={args};
if(require.main===module){
 const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),options=args(config);
 assert.equal(process.argv[3],'--open','Explicit --open required; no browser started');
 const chrome=path.join(process.env.ProgramFiles,'Google/Chrome/Application/chrome.exe');assert.ok(fs.existsSync(chrome));
 const profile=path.join(path.dirname(process.argv[2]),'local-office-browser');
 const child=spawn(chrome,[...options,'--user-data-dir='+profile,config.publicOrigin+'/qa/station'],{windowsHide:true,detached:true,stdio:'ignore'});child.unref();
 console.log('Opened only the isolated QA office profile; no calls/messages/trips initiated.');
}
