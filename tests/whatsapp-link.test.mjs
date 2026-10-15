import test from 'node:test';
import assert from 'node:assert/strict';
import {whatsappLink} from '../src/lib/whatsapp-link.ts';
test('click-to-chat uses configured country and encoded message without sending',()=>{
 assert.equal(whatsappLink('0592111222','طلب جديد'),`https://wa.me/970592111222?text=${encodeURIComponent('طلب جديد')}`);
 assert.equal(whatsappLink('0592111222','','+972'),'https://wa.me/972592111222');
 assert.equal(whatsappLink('00970592111222'),'https://wa.me/970592111222');
 assert.equal(whatsappLink('+972 (59) 211-1222'),'https://wa.me/972592111222');
 for(const value of ['',null,undefined,'0000','javascript:alert(1)','+970/test','0invalid'])assert.equal(whatsappLink(value),null);
 assert.equal(whatsappLink('0592111222','','+123'),null);
});
