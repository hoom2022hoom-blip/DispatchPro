import type {VoiceClient,VoiceStatus} from '../../src/lib/voice-client';

export const radioTemporaryError='تعذر الاتصال بالمكتب؛ تجري إعادة المحاولة تلقائيًا';
export async function radioResponse(response:Response):Promise<Response>{
 if(response.status===429||response.status>=500){
  await response.body?.cancel().catch(()=>{});
  return new Response(JSON.stringify({error:radioTemporaryError}),{status:response.status,headers:{'Content-Type':'application/json'}});
 }
 return response;
}
export function radioReady(client:VoiceClient|null,status:VoiceStatus,operational:boolean,soundAvailable:boolean){
 return !!client&&operational&&soundAvailable&&status.connected&&!!status.state&&client.officeTransportReady();
}
export function radioPollDelay(failures:number){return failures?Math.min(60000,20000*2**Math.min(failures-1,2)):20000;}
