import {readFileSync} from 'node:fs';
import {join} from 'node:path';

// Deployment configuration is server-only. Never infer the office from a caller.
export function configuredOffice():string {
  const explicit=process.env.DISPATCHPRO_OFFICE_TENANT?.trim();
  if(explicit)return explicit;
  try {
    const root=process.env.DISPATCHPRO_LOCAL_DATA_DIR||join(process.cwd(),'.dispatchpro-local');
    const account=JSON.parse(readFileSync(join(root,'office-test-account.json'),'utf8').replace(/^\uFEFF/,''));
    const bridge=JSON.parse(readFileSync(join(root,'office-bridge.json'),'utf8').replace(/^\uFEFF/,''));
    if(typeof account.tenant==='string'&&account.tenant&&account.tenant===bridge.tenant)return account.tenant;
  }catch{}
  return '';
}
