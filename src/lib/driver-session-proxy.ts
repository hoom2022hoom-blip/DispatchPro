// Driver refresh credentials never enter browser storage. Native Android stores
// the same credential through its existing encrypted Keystore session adapter.

export async function driverSessionProxy(request:Request,route:string,base:string|undefined,tenant:string,fetchImpl:typeof fetch=fetch){
 const radio=route.startsWith('auth/radio-'),cookieName=radio?'dispatchpro.radio.refresh':'dispatchpro.driver.refresh';
 const url=new URL(request.url),origin=request.headers.get('origin');
 const expected=request.headers.get('host')?`${url.protocol}//${request.headers.get('host')}`:url.origin;
 if(origin&&origin!==expected)return Response.json({}, {status:403});
 if(!base)return Response.json({}, {status:503});
 const native=request.headers.get('x-driver-session')==='native';
 const credential=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
 let input:Record<string,unknown>;try{input=await request.json();}catch{input={};}
 const login=/^auth\/(driver|radio)-login$/.test(route),logout=/^auth\/(driver|radio)-logout$/.test(route);
 if(!login)input={refreshToken:native?input.refreshToken:credential};else input={...input,tenant:tenant||input.tenant};
 if(!login&&!input.refreshToken)return Response.json({}, {status:401});
 try{
  const response=await fetchImpl(`${base.replace(/\/$/,'')}/api/v1/${login?(radio?'auth/radio-login':'auth/driver-login'):logout?'auth/logout':'auth/refresh'}`,{method:'POST',body:JSON.stringify(input),headers:{'Content-Type':'application/json'},cache:'no-store',redirect:'error',signal:AbortSignal.any([request.signal,AbortSignal.timeout(15000)])});
  const result=await response.json().catch(()=>({}));
  const output=Response.json(native?result:{...result,refreshToken:undefined},{status:response.status===204?200:response.status,headers:{'Cache-Control':'no-store'}});
  if(!native&&(response.ok||response.status===401)){
   const secure=url.protocol==='https:'||request.headers.get('x-forwarded-proto')==='https';
   output.headers.append('Set-Cookie',`${cookieName}=${logout||!response.ok?'':result.refreshToken||''}; Path=/api/reception/auth; HttpOnly; SameSite=Strict${secure?'; Secure':''}; Max-Age=${logout||!response.ok?0:31536000}`);
  }
  return output;
 }catch{return Response.json({error:'جاري إعادة الاتصال'}, {status:503});}
}
