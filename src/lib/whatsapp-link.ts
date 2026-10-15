// Click-to-chat only: opening this URL never sends a message automatically.
export function whatsappLink(value:string|undefined|null,message='',countryCode='+970'):string|null {
 const raw=(value??'').trim();if(!raw||!/^[+\d\s()-]+$/.test(raw))return null;
 let number=raw.replace(/[\s()-]/g,'').replace(/^00/,'').replace(/^\+/,'');
 if(/^0\d{8,9}$/.test(number)){if(!['+970','+972'].includes(countryCode))return null;number=countryCode.slice(1)+number.slice(1);}
 if(!/^[1-9]\d{6,14}$/.test(number))return null;
 return `https://wa.me/${number}${message?`?text=${encodeURIComponent(message)}`:''}`;
}
