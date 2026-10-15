import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {mobileBrowserDefines} from './lib/mobile-browser-defines.mjs';

// Driver-only output, kept away from public files served by the running office.
const root=fileURLToPath(new URL('../',import.meta.url));
if(!process.argv[2])throw Error('Supply a separate QA assets directory');
const output=path.resolve(process.argv[2]);
if(output===root||output.startsWith(path.join(root,'public')+path.sep))throw Error('QA assets must not replace the running public directory');
await mkdir(output,{recursive:true});
await build({absWorkingDir:root,entryPoints:['driver-android/web/main.tsx'],outfile:path.join(output,'app.js'),bundle:true,minify:true,platform:'browser',target:'chrome100',jsx:'automatic',define:mobileBrowserDefines(),plugins:[{name:'qa-call-transport',setup(b){b.onResolve({filter:/customer-mobile\/communication\.js$/},()=>({path:path.join(root,'driver-android/web/qa-communication.js')}));}}],alias:{'@':path.join(root,'src'),'@/lib/notifications':path.join(root,'driver-android/web/notifications.ts')}});
const css=await postcss([tailwindcss({content:[path.join(root,'src/components/**/*.{tsx,ts}'),path.join(root,'driver-android/web/*.{tsx,html}')],theme:{extend:{colors:{background:'#fff',foreground:'#0f172a',border:'#cbd5e1',muted:{foreground:'#475569'},accent:'#f1f5f9',ring:'#2563eb'}}},plugins:[]})]).process(await readFile(path.join(root,'driver-android/web/styles.css'),'utf8'),{from:undefined});
const styles=await Promise.all(['public/taxi-theme.css','public/customer-mobile/communication.css','driver-android/web/communications.css'].map(name=>readFile(path.join(root,name),'utf8')));
await writeFile(path.join(output,'app.css'),[css.css,...styles].join('\n'));
await copyFile(path.join(root,'driver-android/web/index.html'),path.join(output,'index.html'));
console.log('Driver QA assets prepared; office, customer and radio outputs were not replaced.');
