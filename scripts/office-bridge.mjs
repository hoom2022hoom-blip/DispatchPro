import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createOfficeBridge, bridgeLogger } from './lib/office-bridge.mjs';

try {
  const index = process.argv.indexOf('--config');
  if (index < 0 || !process.argv[index + 1]) throw Error('Config required');
  const configPath = resolve(process.argv[index + 1]);
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  for (const key of ['stateDirectory', 'sourceDirectory', 'credentialsFile']) config[key] = resolve(dirname(configPath), config[key]);
  const credentials = JSON.parse(await readFile(config.credentialsFile, 'utf8'));
  const log = await bridgeLogger(config.stateDirectory);
  const bridge = createOfficeBridge(config, credentials, { report: entry => { void log(entry); } });
  const abort = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => abort.abort());
  let failures = 0;
  await log({ type: 'started' });
  do {
    let result;
    try { result = await bridge.runOnce(); } catch { result = { failed: 1 }; }
    failures = result.failed || result.rejected ? Math.min(failures + 1, 6) : 0;
    if (result.imported || result.delivered || failures) await log({ type: 'cycle', ...result });
    if (process.argv.includes('--once')) { process.exitCode = failures ? 1 : 0; break; }
    try { await delay(failures ? Math.min(60000, 1000 * 2 ** failures) : 500, undefined, { signal: abort.signal }); } catch { break; }
  } while (!abort.signal.aborted);
  await log({ type: 'stopped' });
} catch { console.error('Office Bridge could not start: verify local config, credentials and directory access.'); process.exitCode = 1; }
