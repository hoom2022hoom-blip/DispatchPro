import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const mobile = path.join(root, 'driver-mobile');
const output = path.join(root, 'public/driver-mobile');
await mkdir(output, { recursive: true });
await build({ absWorkingDir: root, entryPoints: [path.join(mobile, 'main.tsx')], outfile: path.join(output, 'app.js'), bundle: true, minify: true, platform: 'browser', target: ['safari15', 'chrome100'], jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, alias: { '@': path.join(root, 'src'), '@/lib/notifications': path.join(mobile, 'notifications.ts') } });
const css = await postcss([tailwindcss({ content: [path.join(root, 'src/components/driver-api-dashboard.tsx'), path.join(root, 'src/components/driver-journey-map.tsx'), path.join(mobile, 'index.html')], theme: {}, plugins: [] })]).process(await readFile(path.join(root, 'driver-android/web/styles.css'), 'utf8'), { from: undefined });
await writeFile(path.join(output, 'app.css'), css.css + '\n#app{padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);box-sizing:border-box}');
for (const name of ['index.html', 'manifest.webmanifest', 'install.js', 'sw.js', 'icon-192.png', 'icon-512.png']) await copyFile(path.join(mobile, name), path.join(output, name));
console.log('Driver mobile web built for Android/iOS browsers; existing API proxy required on same HTTPS origin.');

for (const name of ['maps.js','maplibre-gl.js','maplibre-gl.css']) await copyFile(path.join(root,'public/customer-mobile',name),path.join(output,name));
