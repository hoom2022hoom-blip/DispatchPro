import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
try{
 const file=resolve(process.argv[2]);
 const config=JSON.parse(await readFile(file,'utf8'));
 if(config.apiUrl!=='https://api.nablustaxi.com')throw Error('Central URL required');
 const credentials=JSON.parse(await readFile(resolve(dirname(file),config.credentialsFile),'utf8'));
 const login=await fetch(config.apiUrl+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenant:config.tenant,...credentials}),redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!login.ok)throw Error('Authentication unavailable');
 const auth=await login.json();
 const options={headers:{Authorization:`Bearer ${auth.accessToken}`},redirect:'error',signal:AbortSignal.timeout(15000)};
 const me=await fetch(config.apiUrl+'/api/v1/me',options);
 if(!me.ok || (await me.json()).tenantId!==config.tenantId)throw Error('Tenant mismatch');
 const features=await fetch(config.apiUrl+'/api/v1/features',options);
 if(!features.ok || !(await features.json()).some(value=>value.key==='WhatsApp'&&value.enabled))throw Error('WhatsApp feature unavailable');
 console.log('Central HTTPS authentication, tenant identity and WhatsApp feature PASS. No call submitted.');
}catch{console.error('Central WhatsApp verification did not pass. No secret printed or call submitted.');process.exitCode=1;}
