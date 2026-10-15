import { proxyReception } from '@/lib/reception-proxy';
import {configuredOffice} from '@/lib/office-deployment';
import {sessionResponse,refreshCredential,renewOfficeSession} from '@/lib/office-renewal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Keep the established login URL compatible with the employee-authenticated proxy.
export async function POST(request: Request) {
  const response=await proxyReception(request, ['auth', 'login'], process.env.DISPATCHPRO_API_URL,fetch,configuredOffice());
  if(!response.ok)return response;
  const result=await response.json();
  if(refreshCredential(request))await renewOfficeSession(new Request(request.url,{method:'DELETE',headers:request.headers}),process.env.DISPATCHPRO_API_URL);
  return sessionResponse(request,result,response.headers.get('date'));
}
