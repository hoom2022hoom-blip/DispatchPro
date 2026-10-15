// Runs only the existing web/API builds. Task Scheduler restarts this supervisor on failure.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
process.chdir(root);
require('dotenv').config({ path: '.env.local', quiet: true });
require('dotenv').config({ path: '.env', quiet: true });
const role = process.argv[2];
if (!['backend', 'frontend'].includes(role)) throw new Error('Expected backend or frontend');
const logDir = path.join(root, 'artifacts', 'windows-autostart');
fs.mkdirSync(logDir, { recursive: true });
const log = message => fs.appendFileSync(path.join(logDir, `${role}.supervisor.log`), `${new Date().toISOString()} ${message}\n`);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function listening(host, port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port });
    let done = false;
    const finish = value => { if (!done) { done = true; socket.destroy(); resolve(value); } };
    socket.setTimeout(2000);
    socket.on('connect', () => finish(true));
    socket.on('error', () => finish(false));
    socket.on('timeout', () => finish(false));
  });
}
async function main() {
  // OS-owned exclusive lock: released automatically even if this supervisor is killed.
  const lock = net.createServer();
  await new Promise((resolve, reject) => {
    lock.once('error', reject);
    lock.listen({ host: '127.0.0.1', port: role === 'backend' ? 19010 : 19005, exclusive: true }, resolve);
  });
  const port = role === 'backend' ? 9010 : 9005;
  log(`Supervisor started pid=${process.pid} role=${role}`);
  while (true) {
  let waitingLogged = false;
  while (await listening('127.0.0.1', port)) {
    if (!waitingLogged) { log(`Port ${port} already occupied; waiting without starting a duplicate`); waitingLogged = true; }
    await delay(5000);
  }
  if (role === 'backend') {
    const connection = process.env.ConnectionStrings__Taxi || '';
    const host = connection.match(/(?:^|;)\s*Host\s*=\s*([^;]+)/i)?.[1]?.trim() || '127.0.0.1';
    const dbPort = Number(connection.match(/(?:^|;)\s*Port\s*=\s*([^;]+)/i)?.[1] || 5433);
    log('Waiting for configured database TCP endpoint');
    while (!(await listening(host, dbPort))) await delay(5000);
  } else {
    log('Waiting for backend readiness');
    while (true) {
      try { if ((await fetch('http://127.0.0.1:9010/health/ready', { signal: AbortSignal.timeout(5000) })).ok) break; } catch {}
      await delay(5000);
    }
  }
  const configuration = path.join(logDir, 'runtime.json');
  const runtime = fs.existsSync(configuration) ? JSON.parse(fs.readFileSync(configuration, 'utf8').replace(/^\uFEFF/, '')) : { webDist: '.next-web-current-20261005', apiDll: 'artifacts/voice-backend-current-20261005/api/DispatchPro.Api.dll' };
  const dll = path.resolve(root, runtime.apiDll);
  const webDir = path.resolve(root, runtime.webDist);
  if (![dll, webDir].every(p => p.toLowerCase().startsWith((root + path.sep).toLowerCase()))) throw new Error('Runtime must remain inside DispatchPro');
  const env = { ...process.env, ASPNETCORE_URLS: 'http://127.0.0.1:9010', DISPATCHPRO_API_URL: 'http://127.0.0.1:9010', NEXT_DIST_DIR: runtime.webDist, NEXT_PWA_DEST: 'public', NODE_ENV: 'production' };
  if(role==='backend'&&runtime.apiEnvironment==='CustomerTest'){
    env.ASPNETCORE_ENVIRONMENT='CustomerTest';
    env.CustomerTest__Enabled='true';
  }
  const executable = role === 'backend' ? 'C:\\Program Files\\dotnet\\dotnet.exe' : process.execPath;
  const args = role === 'backend' ? [dll, '--contentRoot', path.join(root, 'backend/DispatchPro.Api')] : [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', '9005'];
  if (!fs.existsSync(role === 'backend' ? dll : path.join(root, env.NEXT_DIST_DIR, 'BUILD_ID'))) throw new Error('Existing runtime build missing');
  const out = fs.openSync(path.join(logDir, `${role}.stdout.log`), 'a');
  const err = fs.openSync(path.join(logDir, `${role}.stderr.log`), 'a');
  const child = spawn(executable, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', out, err] });
  fs.closeSync(out); fs.closeSync(err);
  child.on('spawn', () => log(`Runtime started pid=${child.pid}`));
  await new Promise(resolve => {
    child.on('error', error => { log(`Runtime spawn failed: ${error.message}`); resolve(); });
    child.on('exit', (code, signal) => { log(`Runtime exited code=${code} signal=${signal}; restarting in 10 seconds`); resolve(); });
  });
  await delay(10000);
  }
}
main().catch(error => { log(`Supervisor failed: ${error.message}`); process.exit(1); });
