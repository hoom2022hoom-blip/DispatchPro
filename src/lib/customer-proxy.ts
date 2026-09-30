// Customer-only transport; no office credentials or reception proxy changes.
export async function proxyCustomer(request: Request, path: string[], base: string | undefined, transport: typeof fetch = fetch) {
  const route = path.join('/');
  const login = route === 'login';
  const register = route === 'register';
  const allowed = request.method === 'POST' && (['login','register','rides'].includes(route) || /^rides\/[a-f0-9-]{36}\/cancel$/.test(route)) || request.method === 'GET' && (['me','updates','history'].includes(route) || /^rides\/[a-f0-9-]{36}(?:\/events)?$/.test(route));
  if (!base || !allowed) return Response.json({detail:'المسار غير متاح'}, {status:404});
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  const expected = request.headers.get('host') ? `${url.protocol}//${request.headers.get('host')}` : url.origin;
  if (origin && origin !== expected) return Response.json({detail:'مصدر الطلب غير مسموح'}, {status:403});
  const authorization = request.headers.get('authorization');
  if (!login && !register && !authorization?.startsWith('Bearer ')) return Response.json({detail:'سجل الدخول'}, {status:401});
  const parts: Uint8Array[] = []; let size=0;
  if (request.body) { const reader=request.body.getReader(); for (;;) {const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>16384){await reader.cancel();return Response.json({}, {status:413});}parts.push(chunk.value);} }
  const body = new Uint8Array(size);let offset=0;for(const part of parts){body.set(part,offset);offset+=part.length;}
  try {
    const target=new URL(base);
    if(target.username||target.password||target.search||target.hash||!(target.protocol==='https:'||target.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(target.hostname)))throw Error('Invalid API');
    const response=await transport(`${target.href.replace(/\/$/,'')}/api/v1/${login?'auth/login':'customer-app/'+route}${url.search}`,{method:request.method,headers:{'Content-Type':'application/json',...(authorization?{Authorization:authorization}:{})},body:size?body as BodyInit:undefined,redirect:'error',cache:'no-store',signal:AbortSignal.any([request.signal,AbortSignal.timeout(route==='updates'?35000:15000)])});
    return new Response(response.body,{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  } catch { return Response.json({detail:'تعذر الاتصال بالمكتب. تحقق من الاتصال وأعد المحاولة.'},{status:503}); }
}
