import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {build} from 'esbuild';import {readFileSync} from 'node:fs';
import {mobileBrowserDefines} from '../scripts/lib/mobile-browser-defines.mjs';
test('Standalone map configuration renders without Node process and excludes server secrets',async()=>{
 const defines=mobileBrowserDefines({NEXT_PUBLIC_GOOGLE_MAPS_API_KEY:'public-map-fixture',NEXT_PUBLIC_GOOGLE_MAPS_ROUTES:'true',Auth__SigningKey:'SECRET_SIGNING_KEY',ConnectionStrings__Taxi:'SECRET_DATABASE',GOOGLE_APPLICATION_CREDENTIALS:'SECRET_ADMIN'});
 const result=await build({stdin:{contents:"import {googleMapsKey} from './src/lib/google-maps';globalThis.result=googleMapsKey();",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'browser',define:defines});
 const code=result.outputFiles[0].text,context={};vm.runInNewContext(code,context);assert.equal(context.result,'public-map-fixture');assert.doesNotMatch(code,/SECRET_SIGNING_KEY|SECRET_DATABASE|SECRET_ADMIN/);
});
test('Complete Android driver bundle and PWA include the public environment replacement',async()=>{
 const result=await build({entryPoints:['driver-android/web/main.tsx'],bundle:true,write:false,outdir:'artifacts/browser-environment-test',minify:true,platform:'browser',define:mobileBrowserDefines({NEXT_PUBLIC_GOOGLE_MAPS_GEOCODING:'true'}),alias:{'@':process.cwd()+'/src','@/lib/notifications':process.cwd()+'/driver-android/web/notifications.ts'}});
 assert.doesNotMatch(result.outputFiles[0].text,/\bprocess\s*\.\s*env\b/);
 assert.equal(JSON.parse(mobileBrowserDefines({NEXT_PUBLIC_GOOGLE_MAPS_GEOCODING:'true'})['process.env']).NEXT_PUBLIC_GOOGLE_MAPS_GEOCODING,'true');
 assert.match(readFileSync('driver-mobile/build.mjs','utf8'),/define:\s*mobileBrowserDefines\(\)/);
});
test('Missing public map key is a supported unconfigured option in a standalone browser',async()=>{
 const result=await build({stdin:{contents:"import {googleMapsKey} from './src/lib/google-maps';globalThis.result=googleMapsKey();",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'browser',define:mobileBrowserDefines({})});
 const context={};vm.runInNewContext(result.outputFiles[0].text,context);assert.equal(context.result,'');
});
