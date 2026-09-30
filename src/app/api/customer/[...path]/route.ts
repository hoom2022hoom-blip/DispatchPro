import {proxyCustomer} from '@/lib/customer-proxy';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function forward(request:Request,context:{params:Promise<{path:string[]}>}) {
  return proxyCustomer(request,(await context.params).path,process.env.DISPATCHPRO_API_URL);
}
export {forward as GET,forward as POST};
