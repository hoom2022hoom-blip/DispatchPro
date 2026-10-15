import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import QRCode from 'qrcode';
import {createPairingOffer} from './local-pairing.mjs';
const directory=process.argv[2];await mkdir(directory,{recursive:true});
const clock=()=>1700000000000,code='1234ABCDEF987654';
const pairing=await createPairingOffer({host:'192.168.1.8',port:5051,token:'a'.repeat(64),pin:'b'.repeat(64)},{clock,code});
await writeFile(join(directory,'pairing320.json'),JSON.stringify({code,now:clock(),offer:pairing.offer,payload:pairing.payload}));
await QRCode.toFile(join(directory,'pairing320.png'),JSON.stringify(pairing.payload),{width:600,errorCorrectionLevel:'M',margin:4});
