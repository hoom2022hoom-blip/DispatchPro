import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {mobileBrowserDefines} from '../../scripts/lib/mobile-browser-defines.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const mobile=path.join(root,'driver-android');
const output=path.join(mobile,'app/src/main/assets');
await mkdir(output,{recursive:true});
await build({absWorkingDir:root,entryPoints:[path.join(mobile,'web/main.tsx')],outfile:path.join(output,'app.js'),bundle:true,minify:true,platform:'browser',target:'chrome100',jsx:'automatic',define:mobileBrowserDefines(),alias:{'@':path.join(root,'src'),'@/lib/notifications':path.join(mobile,'web/notifications.ts')},metafile:true}).then(result=>writeFile(path.join(output,'bundle-meta.json'),JSON.stringify(result.metafile)));
const css=await postcss([tailwindcss({content: [path.join(root,'src/components/driver-diagnostics.tsx'),path.join(root,'src/components/ride-chat.tsx'),path.join(root,'src/components/ride-communication.tsx'),path.join(root,'src/components/ptt-control.tsx'),path.join(root,'src/components/driver-api-dashboard.tsx'),path.join(root,'src/components/driver-earnings.tsx'),path.join(root,'src/components/driver-journey-map.tsx'),path.join(root,'src/components/ride-location-editor.tsx'),path.join(root,'src/components/driver-street-ride-form.tsx'),path.join(root,'src/components/driver-start-destination.tsx'),path.join(root,'src/components/location-point-picker.tsx'),path.join(root,'src/components/suggested-place-search.tsx'),path.join(root,'src/components/ui/dialog.tsx'),path.join(mobile,'web/*.{tsx,html}')],theme:{extend:{colors:{background:'#ffffff',foreground:'#0f172a',border:'#cbd5e1',muted:{foreground:'#475569'},accent:'#f1f5f9',ring:'#2563eb'}}},plugins:[]})]).process(await readFile(path.join(mobile,'web/styles.css'),'utf8'),{from:undefined});
await writeFile(path.join(output,'app.css'),css.css);await copyFile(path.join(mobile,'web/index.html'),path.join(output,'index.html'));
console.log('Bundled the existing DriverApiDashboard and driver-api; no Next.js or backend build.');
const customerOutput=path.join(mobile,'app/src/customer/assets/customer-mobile');
if(!process.argv.includes('--ptt-only')){
await mkdir(customerOutput,{recursive:true});
for(const name of ['index.html','app.js','app.css','theme.css','reference.css','final.css','communication.css','communication.js','chat.js','session.js','place-search.js','maps.js','maplibre-gl.js','maplibre-gl.css','office-logo.webp','icon.svg','icon-192.png','icon-512.png','manifest.webmanifest','nm-upgrade.css']){
 if(name==='index.html'){const html=await readFile(path.join(root,'public/customer-mobile',name),'utf8');await writeFile(path.join(customerOutput,name),html.replace('<head>','<head><script>window.dispatchProCustomerNative=true;</script>'));}
 else await copyFile(path.join(root,'public/customer-mobile',name),path.join(customerOutput,name));
}
}
for(const directory of ['driver-mobile','customer-mobile']){
 await mkdir(path.join(output,directory),{recursive:true});
 for(const name of ['maps.js','maplibre-gl.js','maplibre-gl.css'])await copyFile(path.join(root,'public/customer-mobile',name),path.join(output,directory,name));
}

await copyFile(path.join(root,'public/customer-mobile/office-logo.webp'),path.join(output,'office-logo.webp'));
await writeFile(path.join(output,'app.css'),(await readFile(path.join(output,'app.css'),'utf8'))+'\n'+(await readFile(path.join(root,'public/taxi-theme.css'),'utf8'))+'\n'+(await readFile(path.join(root,'public/customer-mobile/communication.css'),'utf8'))+'\n'+(await readFile(path.join(mobile,'web/communications.css'),'utf8')));

// Independent RADIO assets reuse the same VoiceClient and authenticated native bridge.
const radioOutput=path.join(mobile,'app/src/radio/assets');
await mkdir(radioOutput,{recursive:true});
await build({absWorkingDir:root,entryPoints:[path.join(mobile,'web/radio-main.tsx')],outfile:path.join(radioOutput,'app.js'),bundle:true,minify:true,platform:'browser',target:'chrome100',jsx:'automatic',define:mobileBrowserDefines(),alias:{'@':path.join(root,'src'),'@/lib/notifications':path.join(mobile,'web/notifications.ts')}});
await writeFile(path.join(radioOutput,'app.css'),await readFile(path.join(mobile,'web/radio.css'),'utf8'));
await writeFile(path.join(radioOutput,'index.html'),(await readFile(path.join(mobile,'web/index.html'),'utf8')).replace('تكسي نابلس والمهندس · السائق','مخشير TNM · تكسي نابلس والمهندس').replace('جارٍ فتح تطبيق السائق','جارٍ فتح المخشير'));
await copyFile(path.join(root,'public/customer-mobile/office-logo.webp'),path.join(radioOutput,'office-logo.webp'));
