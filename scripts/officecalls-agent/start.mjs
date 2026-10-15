import {readFile} from 'node:fs/promises';
import {startAgent} from './agent.mjs';
const config=JSON.parse((await readFile(process.argv[2],'utf8')).replace(/^\uFEFF/,''));
config.token=process.env.OFFICECALLS_DEVICE_TOKEN;
config.certificatePassword=process.env.OFFICECALLS_CERTIFICATE_PASSWORD;
if(!config.token)throw Error('Pair this Windows user before starting the agent');
await startAgent(config);
