import {sessionCookie} from './office-session-cookie';
const refreshName='dispatchpro.office.refresh';
export function refreshCookie(request:Request,credential:string){
 const secure=new URL(request.url).protocol==='https:'||request.headers.get('x-forwarded-proto')==='https';
 return `${refreshName}=${credential}; Path=/api/reception; HttpOnly; SameSite=Strict; Max-Age=${credential?34560000:0}${secure?'; Secure':''}`;
}
export function refreshCredential(request:Request){return request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(refreshName+'='))?.slice(refreshName.length+1)||'';}
export function sessionResponse(request:Request,result:{accessToken:string;refreshToken?:string;tenant:string},date:string|null){
 const response=Response.json({accessToken:result.accessToken,tenant:result.tenant,renewable:!!result.refreshToken},{headers:{'Cache-Control':'no-store',...(date?{Date:date}:{})}});
 response.headers.append('Set-Cookie',sessionCookie(request,result.accessToken,true,date));
 if(result.refreshToken)response.headers.append('Set-Cookie',refreshCookie(request,result.refreshToken));
 return response;
}
export async function renewOfficeSession(request:Request,base:string|undefined,fetchImpl:typeof fetch=fetch){
 const credential=refreshCredential(request);
 if(!base)return Response.json({}, {status:503});
 if(!credential)return Response.json({}, {status:401});
 try{
 const url=new URL(base);if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw Error('Invalid API URL');
 const upstream=await fetchImpl(`${url.href.replace(/\/$/,'')}/api/v1/auth/${request.method==='DELETE'?'logout':'refresh'}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refreshToken:credential}),cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(request.method==='DELETE'){
   if(!upstream.ok&&upstream.status!==401)return Response.json({}, {status:503});
   const response=new Response(null,{status:204});response.headers.append('Set-Cookie',refreshCookie(request,''));response.headers.append('Set-Cookie',sessionCookie(request,'',false));return response;
 }
 if(upstream.ok)return sessionResponse(request,await upstream.json(),upstream.headers.get('date'));
 return Response.json({}, {status:upstream.status,headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({}, {status:503});}
}
