import { readFile, writeFile, mkdir, appendFile, open, unlink, stat, rename, access } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const root = dirname(fileURLToPath(import.meta.url));
process.chdir(root);
const receiverPort = Number(process.env.DISPATCHPRO_ICALL_HTTP_PORT || 9007);
if (!Number.isInteger(receiverPort) || receiverPort < 1024 || receiverPort > 65535) throw Error('Invalid receiver port');
const logFile = join(root, 'logs', 'bridge.log');
let receiver, gateway, lock, stopping = false, ready = false;
const lockFile = join(root, 'data', 'bridge-start.lock');
async function log(message) {
  await mkdir(join(root, 'logs'), { recursive: true });
  if ((await stat(logFile).catch(() => ({ size: 0 }))).size > 2097152) {
    await rename(logFile, logFile + '.previous').catch(() => {});
  }
  await appendFile(logFile, `${new Date().toISOString()} ${message}\n`);
}
function inside(path) {
  if (typeof path !== 'string' || isAbsolute(path) || path.includes(':') || relative(root, resolve(root, path)).startsWith('..')) throw Error('Config contains a non-portable path');
  return resolve(root, path);
}
async function request(url, init = {}) {
  try { return await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
  catch (error) { throw Error(`Connection failed: ${new URL(url).origin}${new URL(url).pathname} (${error.cause?.code || error.name})`); }
}
async function cleanup() {
  if (stopping) return;
  stopping = true;
  if (gateway && gateway.exitCode === null) gateway.kill();
  if (receiver && receiver.exitCode === null) {
    await new Promise(resolveDone => {
      const child = spawn('taskkill.exe', ['/PID', String(receiver.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      child.on('exit', resolveDone); child.on('error', resolveDone);
    });
  }
  if (lock) { await lock.close(); await unlink(lockFile).catch(() => {}); }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void cleanup().then(() => process.exit(0)); });
try {
  await mkdir(join(root, 'data'), { recursive: true });
  try { lock = await open(lockFile, 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(await readFile(lockFile, 'utf8'));
    let active = false;
    if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 0); active = true; } catch (e) { if (e.code !== 'ESRCH') active = true; } }
    if (active) throw Error('This package is already running');
    await unlink(lockFile); lock = await open(lockFile, 'wx');
  }
  await lock.writeFile(String(process.pid));
  for (const file of ['runtime/node.exe', 'DispatchPro-Icall-Test.exe', 'app/icall-debug.mjs', 'app/server.mjs', 'app/route.mjs', 'app/index.html', 'config.json', 'credentials.json', 'integration-config.json']) {
    await access(join(root, file)).catch(() => { throw Error(`Required package file is missing: ${file}`); });
  }
  const config = JSON.parse(await readFile(join(root, 'config.json'), 'utf8'));
  for (const key of ['sourceDirectory', 'stateDirectory', 'credentialsFile']) inside(config[key]);
  if (new URL(config.apiUrl).protocol !== 'https:') throw Error('External API must use HTTPS');
  const credentials = JSON.parse(await readFile(inside(config.credentialsFile), 'utf8'));
  const health = await request(config.apiUrl + '/health/ready');
  if (!health.ok) throw Error(`Home API is not ready (HTTP ${health.status})`);
  const login = await request(config.apiUrl + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenant: config.tenant, ...credentials }) });
  if (!login.ok) throw Error(`Bridge authentication rejected (HTTP ${login.status})`);
  const auth = await login.json();
  const identity = await request(config.apiUrl + '/api/v1/me', { headers: { Authorization: `Bearer ${auth.accessToken}` } });
  if (!identity.ok || (await identity.json()).tenantId !== config.tenantId) throw Error('Bridge tenant does not match configured office');
  const features = await request(config.apiUrl + '/api/v1/features', { headers: { Authorization: `Bearer ${auth.accessToken}` } });
  if (!features.ok || !(await features.json()).some(f => f.key === 'CallerId' && f.enabled)) throw Error('CallerId is disabled for this office');
  await log('External API, authentication, tenant and CallerId verified');
  await new Promise((resolveFree, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(Error(`Receiver HTTP port ${receiverPort} is occupied; existing Office services were left running`)));
    probe.listen(receiverPort, '127.0.0.1', () => probe.close(resolveFree));
  });
  const launcherLog = join(root, 'data', 'launcher.log');
  const offset = (await stat(launcherLog).catch(() => ({ size: 0 }))).size;
  const env = { ...process.env, DISPATCHPRO_ICALL_HTTP_PORT: String(receiverPort) };
  for (const key of ['NODE_OPTIONS', 'DISPATCHPRO_LOCAL_DATA_DIR', 'DISPATCHPRO_CALL_TOKEN', 'DISPATCHPRO_LAUNCHER_PID']) delete env[key];
  receiver = spawn(join(root, 'DispatchPro-Icall-Test.exe'), [], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
  let receiverError;
  receiver.once('error', e => { receiverError = e.code || e.message; });
  let capture = '';
  for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
    if (receiverError) throw Error(`iCall executable could not start (${receiverError})`);
    if (receiver.exitCode !== null) throw Error('iCall executable exited; another receiver may already be running');
    const bytes = await readFile(launcherLog).catch(() => Buffer.alloc(0));
    const messages = bytes.subarray(offset).toString('utf8');
    if (messages.includes('EADDRINUSE')) throw Error('iCall UDP port 3520 is occupied by another receiver');
    if (messages.includes('CAPTURE READY [')) capture = 'Npcap';
    else if (messages.includes('UDP FALLBACK READY:')) capture = 'UDP fallback';
    if (capture) break;
    await delay(500);
  }
  if (!capture) throw Error('iCall capture did not become ready; see data/launcher.log for Npcap or UDP error');
  const token = (await readFile(join(root, 'data', 'call-token'), 'utf8').catch(() => '')).trim();
  // The receiver creates its secret on the first GET when this is a new package.
  if (!token) await request(`http://127.0.0.1:${receiverPort}/api/calls`);
  const localToken = (await readFile(join(root, 'data', 'call-token'), 'utf8')).trim();
  const local = await request(`http://127.0.0.1:${receiverPort}/api/calls`, { headers: { Authorization: `Bearer ${localToken}` } });
  if (!local.ok) throw Error(`Package receiver authentication failed (HTTP ${local.status})`);
  // WhatsApp already has its own Site Bridge; this launcher starts iCall only.
  await mkdir(inside(config.sourceDirectory), { recursive: true });
  const { createOfficeBridge } = await import('./scripts/lib/office-bridge.mjs');
  const bridge = createOfficeBridge(config, credentials, { report: event => { void log(`Bridge: ${event.type}`); } });
  const first = await bridge.runOnce();
  if (first.failed || first.rejected) throw Error('Bridge initialization failed; see logs/bridge.log');
  await log(`Receiver ready (${capture}); bridge running; source=LANDLINE; persistent event IDs and retry enabled`);
  console.log('READY FOR REAL LANDLINE TEST'); ready = true;
  while (!stopping) {
    if (receiverError || receiver.exitCode !== null) throw Error('iCall receiver stopped');
    const result = await bridge.runOnce();
    if (result.imported || result.delivered || result.failed || result.rejected) await log(JSON.stringify(result));
    await delay(result.failed || result.rejected ? 5000 : 500);
  }
} catch (error) {
  const message = error.code === 'ENOENT' ? 'A required package file is missing; extract the complete ZIP' : error.message;
  await log(`ERROR: ${message}`).catch(() => {});
  console.log(`ERROR: ${message}`);
  await cleanup(); process.exitCode = 1;
}
