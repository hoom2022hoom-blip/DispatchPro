import {readFile} from 'node:fs/promises';
import {runLocalReceiver} from './local-receiver.mjs';
const config=JSON.parse((await readFile(process.argv[2],'utf8')).replace(/^\uFEFF/,''));
let chunks=[];for await(const chunk of process.stdin){chunks.push(chunk);if(Buffer.concat(chunks).length>8192)throw Error('CONFIG_TOO_LARGE');}
await runLocalReceiver(config,JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,'')));
