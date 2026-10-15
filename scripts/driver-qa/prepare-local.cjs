// Preserve the existing QA database, credentials, DP keyring and APK signing key.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const original=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const previous=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
const out=path.resolve(process.argv[4]);
assert.equal(original.tenant,'driver-qa');assert.match(original.database,/^dispatchpro_driverqa_20261012_[a-f0-9]{8}$/);assert.match(original.role,/^driverqa_[a-f0-9]{8}$/);
assert.ok(out.startsWith(path.resolve(original.root,'../DispatchPro-audit')+path.sep));
const privateDir=path.join(out,'private');fs.mkdirSync(privateDir,{recursive:true});
const who=spawnSync('whoami',['/user','/fo','csv','/nh'],{encoding:'utf8'});assert.equal(who.status,0);const sid=who.stdout.match(/S-1-5-[0-9-]+/)[0];
const acl=spawnSync('icacls.exe',[privateDir,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{encoding:'utf8',windowsHide:true});assert.equal(acl.status,0,'Private ACL required');
const openssl='C:/Program Files/Git/usr/bin/openssl.exe';assert.ok(fs.existsSync(openssl));
const ca=path.join(privateDir,'qa-local-ca.pem'),caKey=path.join(privateDir,'qa-local-ca.key'),cert=path.join(privateDir,'qa-local-server.pem'),key=path.join(privateDir,'qa-local-server.key');
function ssl(args){const r=spawnSync(openssl,args,{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,'QA certificate operation failed');return r.stdout;}
if(!fs.existsSync(ca)){
 assert.ok(![caKey,cert,key].some(f=>fs.existsSync(f)),'Do not overwrite partial TLS state');
 ssl(['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-days','365','-keyout',caKey,'-out',ca,'-subj','/CN=DispatchPro Isolated USB QA CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign']);
 const csr=path.join(privateDir,'qa-local-server.csr'),ext=path.join(privateDir,'qa-local-server.ext');
 fs.writeFileSync(ext,'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n');
 ssl(['req','-new','-newkey','rsa:2048','-nodes','-sha256','-keyout',key,'-out',csr,'-subj','/CN=localhost']);
 ssl(['x509','-req','-in',csr,'-CA',ca,'-CAkey',caKey,'-set_serial','0x'+crypto.randomBytes(16).toString('hex'),'-days','365','-sha256','-extfile',ext,'-out',cert]);
}
ssl(['verify','-CAfile',ca,cert]);ssl(['x509','-in',cert,'-checkend','2592000','-noout']);
const tlsRes=path.join(out,'tls-res');fs.mkdirSync(path.join(tlsRes,'raw'),{recursive:true});fs.mkdirSync(path.join(tlsRes,'xml'),{recursive:true});fs.copyFileSync(ca,path.join(tlsRes,'raw/qa_local_ca.pem'));
fs.writeFileSync(path.join(tlsRes,'xml/qa_local_network.xml'),'<network-security-config><base-config cleartextTrafficPermitted="false"><trust-anchors><certificates src="system"/></trust-anchors></base-config><domain-config cleartextTrafficPermitted="false"><domain includeSubdomains="false">localhost</domain><trust-anchors><certificates src="@raw/qa_local_ca"/></trust-anchors></domain-config></network-security-config>');
const local={...original,publicOrigin:'https://localhost:9443',tlsPort:9443,tlsCert:cert,tlsKey:key,tlsCa:ca};
const build={...previous,...local,out,qaAssets:path.join(out,'qa-assets'),qaTlsRes:tlsRes,qaVersionName:'5.1.6-qa.7',qaVersionCode:6,qaApkName:'NM-Driver-QA-5.1.6-qa.7-vc6.apk',previousQaApk:path.join(previous.out,previous.qaApkName)};
fs.writeFileSync(path.join(privateDir,'runtime-config.private.json'),JSON.stringify(local,null,2));fs.writeFileSync(path.join(privateDir,'build-config.private.json'),JSON.stringify(build,null,2));
fs.writeFileSync(path.join(out,'local-https-setup.json'),JSON.stringify({https:local.publicOrigin,qaDatabase:local.database,qaVersion:build.qaVersionName,qaVersionCode:6,originalConfigChanged:false,credentialsChanged:false,databaseCreated:false,globalTrustStoreChanged:false,caSha256:crypto.createHash('sha256').update(fs.readFileSync(ca)).digest('hex'),privateKeyBundled:false},null,2));
console.log('Local HTTPS QA configuration ready; existing credentials/database/keyring preserved.');
