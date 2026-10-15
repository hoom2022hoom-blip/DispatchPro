import {driverSessionProxy} from '@/lib/driver-session-proxy';
import { proxyReception } from '@/lib/reception-proxy';
import {configuredOffice} from '@/lib/office-deployment';
import {officeCookie,sessionCookie} from '@/lib/office-session-cookie';
import {refreshCookie,refreshCredential,sessionResponse,renewOfficeSession} from '@/lib/office-renewal';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function forward(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const path=(await context.params).path;
  if(request.method==='POST'&&['auth/driver-login','auth/driver-refresh','auth/driver-logout','auth/radio-login','auth/radio-refresh','auth/radio-logout'].includes(path.join('/')))return driverSessionProxy(request,path.join('/'),process.env.DISPATCHPRO_API_URL,configuredOffice());
  if(path.join('/')==='auth/session'){
    const url=new URL(request.url),origin=request.headers.get('origin'),host=request.headers.get('host');
    if(origin&&origin!==(host?`${url.protocol}//${host}`:url.origin))return Response.json({}, {status:403});
    if(request.method==='DELETE'){const response=await renewOfficeSession(request,process.env.DISPATCHPRO_API_URL);if(response.status!==503){response.headers.append('Set-Cookie',refreshCookie(request,''));response.headers.append('Set-Cookie',sessionCookie(request,'',false));}return response;}
    if(request.method!=='GET'&&request.method!=='POST')return new Response(null,{status:405});
    if(refreshCredential(request))return renewOfficeSession(request,process.env.DISPATCHPRO_API_URL);
    const token=officeCookie(request)||request.headers.get('authorization')?.replace(/^Bearer /,'');
    if(!token)return Response.json({}, {status:401,headers:{'Cache-Control':'no-store'}});
    const headers=new Headers(request.headers);headers.set('authorization','Bearer '+token);
    const checked=await proxyReception(new Request(request.url,{method:'POST',headers}),['auth','session'],process.env.DISPATCHPRO_API_URL);
    if(!checked.ok)return Response.json({}, {status:checked.status,headers:{'Cache-Control':'no-store',...(checked.status===401?{'Set-Cookie':sessionCookie(request,'',false)}:{})}});
    return sessionResponse(request,await checked.json(),checked.headers.get('date'));
  }
  let remember:boolean|undefined;
  if(request.method==='POST'&&path.join('/')==='auth/login')try{remember=(await request.clone().json()).rememberMe;}catch{}
  const response=await proxyReception(request,path,process.env.DISPATCHPRO_API_URL,fetch,configuredOffice());
  if(response.ok&&request.method==='POST'&&path.join('/')==='auth/login'){
    const result=await response.clone().json();
    if(refreshCredential(request))await renewOfficeSession(new Request(request.url,{method:'DELETE',headers:request.headers}),process.env.DISPATCHPRO_API_URL);
    return sessionResponse(request,result,response.headers.get('date'));
  }
  return response;
}
export { forward as GET, forward as POST, forward as PUT, forward as DELETE };
