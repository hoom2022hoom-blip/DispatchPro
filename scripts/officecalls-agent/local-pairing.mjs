import {randomBytes,pbkdf2,createCipheriv,createDecipheriv} from 'node:crypto';
import {promisify} from 'node:util';

const derive=promisify(pbkdf2);
const aad=Buffer.from('officecalls-pair-v1');
export async function createPairingOffer(settings,{clock=Date.now,code=randomBytes(8).toString('hex').toUpperCase()}={}) {
 const issuedAt=clock(),expiresAt=issuedAt+180000,salt=randomBytes(16),iv=randomBytes(12);
 const payload={type:'officecalls-local-v1',...settings,issuedAt,expiresAt,pairId:randomBytes(16).toString('hex')};
 const key=await derive(code,salt,200000,32,'sha1');
 const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad);
 const ciphertext=Buffer.concat([cipher.update(JSON.stringify(payload)),cipher.final(),cipher.getAuthTag()]);
 return {code:code.match(/.{4}/g).join('-'),payload,offer:{type:'officecalls-pair-v1',salt:salt.toString('base64'),iv:iv.toString('base64'),ciphertext:ciphertext.toString('base64')},expiresAt};
}
export async function decryptPairingOffer(offer,code,clock=Date.now) {
 code=code.replace(/[ -]/g,'').toUpperCase();if(!/^[A-F0-9]{16}$/.test(code)||offer.type!=='officecalls-pair-v1')throw Error('INVALID_PAIRING');
 const salt=Buffer.from(offer.salt,'base64'),iv=Buffer.from(offer.iv,'base64'),data=Buffer.from(offer.ciphertext,'base64');
 if(salt.length!==16||iv.length!==12||data.length<17||data.length>4096)throw Error('INVALID_PAIRING');
 const key=await derive(code,salt,200000,32,'sha1'),decipher=createDecipheriv('aes-256-gcm',key,iv);
 decipher.setAAD(aad);decipher.setAuthTag(data.subarray(-16));
 const result=JSON.parse(Buffer.concat([decipher.update(data.subarray(0,-16)),decipher.final()]).toString('utf8'));
 if(result.expiresAt<=clock()||result.expiresAt>clock()+300000)throw Error('PAIRING_EXPIRED');
 return result;
}
