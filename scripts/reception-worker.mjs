import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createReceptionWorker } from './lib/reception-worker.mjs';

const required = name => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };
const worker = createReceptionWorker({
  directory: process.env.DISPATCHPRO_LOCAL_DATA_DIR || join(process.cwd(), '.dispatchpro-local'),
  apiUrl: required('DISPATCHPRO_API_URL'), tenant: required('DISPATCHPRO_WORKER_TENANT'),
  username: required('DISPATCHPRO_WORKER_USERNAME'), password: required('DISPATCHPRO_WORKER_PASSWORD'),
  report: ({ file, error }) => console.error(`Reception retry: ${file}: ${error}`),
});
const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => controller.abort());
do {
  let failed = false;
  try { const result = await worker.runOnce(); failed = result.failed > 0; if (result.delivered || failed) console.log(JSON.stringify(result)); }
  catch (error) { failed = true; console.error(error.message); }
  if (process.argv.includes('--once')) { process.exitCode = failed ? 1 : 0; break; }
  try { await delay(failed ? 5000 : 2000, undefined, { signal: controller.signal }); } catch { break; }
} while (!controller.signal.aborted);
