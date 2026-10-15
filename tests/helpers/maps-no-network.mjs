import http from 'node:http';import https from 'node:https';import {syncBuiltinESMExports} from 'node:module';
const deny=()=>{throw Error('Network disabled for offline QA verification');};
globalThis.fetch=async()=>deny();http.request=deny;http.get=deny;https.request=deny;https.get=deny;syncBuiltinESMExports();
