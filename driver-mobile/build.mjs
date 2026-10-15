import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mobileBrowserDefines } from '../scripts/lib/mobile-browser-defines.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const mobile = path.join(root, 'driver-mobile');
const output = path.join(root, 'public/driver-mobile');
await mkdir(output, { recursive: true });
await build({ absWorkingDir: root, entryPoints: [path.join(mobile, 'main.tsx')], outfile: path.join(output, 'app.js'), bundle: true, minify: true, platform: 'browser', target: ['safari15', 'chrome100'], jsx: 'automatic', define: mobileBrowserDefines(), alias: { '@': path.join(root, 'src'), '@/lib/notifications': path.join(mobile, 'notifications.ts') } });
// Radix dialogs are portalled into body. Their shared CSS must be included in
// the standalone app; otherwise clicking opens an unpositioned/invisible form.
const css = await postcss([tailwindcss({ content: [path.join(root,'src/components/driver-diagnostics.tsx'),path.join(root,'src/components/ride-chat.tsx'),path.join(root, 'src/components/ptt-control.tsx'), path.join(root, 'src/components/driver-earnings.tsx'), path.join(root, 'src/components/driver-api-dashboard.tsx'), path.join(root, 'src/components/driver-journey-map.tsx'), path.join(root, 'src/components/ride-location-editor.tsx'), path.join(root, 'src/components/driver-street-ride-form.tsx'), path.join(root, 'src/components/location-point-picker.tsx'), path.join(root, 'src/components/ui/dialog.tsx'), path.join(root, 'src/components/suggested-place-search.tsx'), path.join(mobile, 'index.html')], theme: {extend:{colors:{background:'#ffffff',foreground:'#0f172a',border:'#cbd5e1',muted:{foreground:'#475569'},accent:'#f1f5f9',ring:'#2563eb'}}}, plugins: [] })]).process(await readFile(path.join(root, 'driver-android/web/styles.css'), 'utf8'), { from: undefined });
await writeFile(path.join(output, 'app.css'), css.css + '\n#app{padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);box-sizing:border-box} main{min-width:0;overflow-wrap:anywhere} input{min-width:0;font-size:16px} button,a{touch-action:manipulation} a[href^="tel:"],a[href*="maps/"]{min-height:44px;display:flex;align-items:center}');
for (const name of ['index.html', 'manifest.webmanifest', 'install.js', 'sw.js', 'icon-192.png', 'icon-512.png']) await copyFile(path.join(mobile, name), path.join(output, name));
console.log('Driver mobile web built for Android/iOS browsers; existing API proxy required on same HTTPS origin.');

for (const name of ['maps.js','maplibre-gl.js','maplibre-gl.css']) await copyFile(path.join(root,'public/customer-mobile',name),path.join(output,name));

await copyFile(path.join(root,'public/customer-mobile/office-logo.webp'),path.join(output,'office-logo.webp'));
await writeFile(path.join(output,'app.css'),(await readFile(path.join(output,'app.css'),'utf8'))+'\n'+(await readFile(path.join(root,'public/taxi-theme.css'),'utf8'))+'\n'+(await readFile(path.join(root,'public/customer-mobile/communication.css'),'utf8'))+'\n'+(await readFile(path.join(root,'driver-android/web/communications.css'),'utf8')));
