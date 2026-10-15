import {parsePhoneNumberFromString} from 'libphonenumber-js/max';

export function cleanPhone(value) {
 if(typeof value!=='string'||value.length>160)return '';
 let text=value.normalize('NFKC').replace(/\p{Cf}/gu,'').trim().replace(/^tel:/i,'').replace(/\p{Pd}/gu,'-');
 const zeroes=[0x30,0x660,0x6f0,0x7c0,0x966,0x9e6,0xa66,0xae6,0xb66,0xbe6,0xc66,0xce6,0xd66,0xde6,0xe50,0xed0,0xf20,0x1040,0x1090,0x17e0,0x1810,0x1946,0x19d0,0x1a80,0x1a90,0x1b50,0x1bb0,0x1c40,0x1c50,0xa620,0xa8d0,0xa900,0xa9d0,0xa9f0,0xaa50,0xabf0,0xff10];
 text=text.replace(/\p{Nd}/gu,c=>{const cp=c.codePointAt(0),z=zeroes.find(z=>cp>=z&&cp<=z+9);return z===undefined?c:String(cp-z);});
 if(/[^0-9+().\-\s]/u.test(text)||(text.match(/\+/g)||[]).length>1||(text.includes('+')&&!text.startsWith('+')))return '';
 return (text.startsWith('+')?'+':'')+text.replace(/[^0-9]/g,'');
}
// The office's existing 00 IDD convention is PS. Local input never inherits a country.
export function parsePhone(value,iddRegion='PS') {
 const clean=cleanPhone(value);if(!clean)return null;
 if(!clean.startsWith('+')&&!clean.startsWith('00')) {
  if(!/^\d{4,17}$/.test(clean)||/^0+$/.test(clean))return null;
  return {identity:clean,display:clean,e164:'',reason:'LOCAL_REGION_UNKNOWN'};
 }
 const p=parsePhoneNumberFromString(clean,{defaultCountry:clean.startsWith('+')?undefined:iddRegion,extract:false});
 const body=clean.startsWith('00')?clean.slice(2):clean.slice(1);
 if(p?.isPossible()&&p.number.slice(1)===body) {
  const national=cleanPhone(p.formatNational());const display=national&&!national.startsWith('+')?national:p.number;
  return {identity:p.number,display,e164:p.number,reason:display===p.number?'NATIONAL_FORMAT_UNAVAILABLE':p.isValid()?'VALID_INTERNATIONAL':'POSSIBLE_INTERNATIONAL'};
 }
 if(!/^[1-9]\d{6,14}$/.test(body))return null;
 return {identity:clean,display:clean,e164:'',reason:'INTERNATIONAL_UNVERIFIED'};
}
export function normalizePhone(value) {return parsePhone(value)?.display||'';}
export function gridPhone(value) {
 const p=parsePhone(value);if(!p)throw Error('GRID_PHONE_INVALID');
 if(!/^\d+$/.test(p.display)||p.display.startsWith('00'))throw Error('GRID_PHONE_UNVERIFIED');
 if(p.display.length>15)throw Error('GRID_PHONE_TOO_LONG');
 return p.display;
}
