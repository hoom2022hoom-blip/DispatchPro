import {proxyCustomer} from '@/lib/customer-proxy';
import {configuredOffice} from '@/lib/office-deployment';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function forward(request:Request,context:{params:Promise<{path:string[]}>}) {
  return proxyCustomer(request,(await context.params).path,process.env.DISPATCHPRO_PUBLIC_API_URL||process.env.DISPATCHPRO_API_URL,fetch,configuredOffice());
}
export {forward as GET,forward as POST};
