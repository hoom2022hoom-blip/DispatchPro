const name='dispatchpro.office.session';
export function officeCookie(request:Request){
  return request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';
}
export function sessionCookie(request:Request,token:string,remember:boolean,serverDate?:string|null){
  let age=0;
  const responseTime=Date.parse(serverDate||'');
  const now=Number.isFinite(responseTime)?responseTime:Date.now();
  try{age=Math.max(0,Math.min(1800,Math.floor(JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()).exp-now/1000)));}catch{}
  const secure=new URL(request.url).protocol==='https:'||request.headers.get('x-forwarded-proto')==='https';
  return `${name}=${token}; Path=/api/reception; HttpOnly; SameSite=Strict${secure?'; Secure':''}${!token?'; Max-Age=0':remember?`; Max-Age=${age}`:''}`;
}
