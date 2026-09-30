const fs = require('node:fs');
const ts = require('../../node_modules/typescript');
const path = require('node:path');
for (const [source, output] of [
  ['src/lib/call-events.ts', 'lib/call-events.mjs'],
  ['src/lib/call-store.ts', 'lib/call-store.mjs'],
  ['src/lib/local-call-security.ts', 'lib/local-call-security.mjs'],
  ['src/app/api/calls/route.ts', 'route.mjs'],
]) {
  const code = ts.transpileModule(fs.readFileSync(source, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
    .replaceAll("'@/lib/call-events'", "'./lib/call-events.mjs'")
    .replaceAll("'@/lib/call-store'", "'./lib/call-store.mjs'")
    .replaceAll("'@/lib/local-call-security'", "'./lib/local-call-security.mjs'");
  fs.writeFileSync(path.join('release-test/app', output), code);
}
