import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

// Refuse to inspect or stop an existing process on the development port.
const probe = createServer();
await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(9010, '127.0.0.1', resolve); });
await new Promise(resolve => probe.close(resolve));
const child = spawn('dotnet', [fileURLToPath(new URL('./DispatchPro.Api/bin/Debug/net8.0/DispatchPro.Api.dll', import.meta.url))], {
  windowsHide: true, stdio: 'ignore',
  env: { ...process.env, Auth__SigningKey: 'smoke-test-only-signing-key-0123456789', ConnectionStrings__Taxi: 'Host=127.0.0.1;Port=1;Database=unavailable;Username=none;Timeout=1', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1' },
});
let failure;
child.on('error', error => { failure = error; });
try {
  let live;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (failure) throw failure;
    if (child.exitCode !== null) throw new Error('API exited before readiness');
    try {
      live = await fetch('http://127.0.0.1:9010/health/live', { signal: AbortSignal.timeout(500) });
      if (live.ok) break;
    } catch {}
    await delay(250);
  }
  assert.equal(live?.status, 200);
  const body = await live.json();
  assert.equal(body.status, 'alive');
  assert.equal((await fetch('http://127.0.0.1:9010/health/ready')).status, 503);
  assert.equal((await fetch('http://127.0.0.1:9010/api/calls', { method: 'POST' })).status, 404);
  assert.equal((await fetch('http://127.0.0.1:9010/api/v1/customers')).status, 401);
  console.log('PASS: ASP.NET live endpoint, unavailable database gives not-ready, customer API requires authentication, existing call path remains separate.');
} finally {
  if (child.exitCode === null && !failure) { const exit = once(child, 'exit'); child.kill(); await exit; }
}
