import { mkdirSync, appendFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const logs=join(root,'logs');mkdirSync(logs,{recursive:true});
function record(level,args){
 const date=new Date().toISOString(),day=date.slice(0,10);let index=0,file;
 do{file=join(logs,`receiver-${day}${index?'-'+index:''}.log`);index++;}while(existsSync(file)&&statSync(file).size>10*1024*1024);
 appendFileSync(file,JSON.stringify({at:date,level,message:args.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ')})+'\n',{mode:0o600});
}
console.log=(...args)=>record('INFO',args);console.error=(...args)=>record('ERROR',args);console.warn=(...args)=>record('WARN',args);
process.chdir(root);process.argv.push('--config',join(root,'config.json'));
await import('./scripts/central-icall.mjs');
