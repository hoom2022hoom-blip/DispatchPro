import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  const index = process.argv.indexOf('--config');
  if (index < 0 || !process.argv[index + 1]) throw Error('Config required');
  const config = resolve(process.argv[index + 1]);
  await access(config);
  const child = spawn(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL('./office-bridge.mjs', import.meta.url)), '--config', config], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), detached: true, windowsHide: true, stdio: 'ignore',
  });
  child.once('error', () => { console.error('Office Bridge could not launch.'); process.exitCode = 1; });
  child.once('spawn', () => { console.log(`Office Bridge launched; PID=${child.pid}. Check agent.log for readiness. No autostart installed.`); child.unref(); });
} catch { console.error('Provide --config with an existing local configuration file.'); process.exitCode = 1; }
