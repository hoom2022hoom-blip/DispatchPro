// Customer-only transport; no office credentials or reception proxy changes.
export async function proxyCustomer(request: Request, path: string[], base: string | undefined, transport: typeof fetch = fetch, officeTenant='') {
  const route = path.join('/');
  const login = route === 'login';
  const register = route === 'register';
  const otp = route==='otp/request'||route==='otp/verify'||route==='test-otp/request';
  const allowed = (request.method==='GET'&&(route==='mobile/updates'||/^calls\/[a-f0-9-]{36}$/.test(route))) || (request.method==='POST'&&(route==='calls'||route==='mobile/chat-read'||/^calls\/[a-f0-9-]{36}\/(answer|reject|end|heartbeat|signal)$/.test(route))) || (['GET','POST'].includes(request.method)&&/^rides\/[a-f0-9-]{36}\/chat$/.test(route)) || request.method === 'POST' && (['login','logout','register','otp/request','otp/verify','test-otp/request','rides','places','push-device','push-device/remove'].includes(route) || /^rides\/[a-f0-9-]{36}\/(cancel|arrival-ack)$/.test(route)) || request.method === 'GET' && (['me','updates','history','places'].includes(route) || /^rides\/[a-f0-9-]{36}(?:\/events)?$/.test(route));
  if (!base || !allowed) return Response.json({detail:'المسار غير متاح'}, {status:404});
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  const expected = request.headers.get('host') ? `${url.protocol}//${request.headers.get('host')}` : url.origin;
  if (origin && origin !== expected) return Response.json({detail:'مصدر الطلب غير مسموح'}, {status:403});
  const authorization = request.headers.get('authorization');
  if (!login && !register && !otp && !authorization?.startsWith('Bearer ')) return Response.json({detail:'سجل الدخول'}, {status:401});
  const parts: Uint8Array[] = []; let size=0;
  if (request.body) { const reader=request.body.getReader(); for (;;) {const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>16384){await reader.cancel();return Response.json({}, {status:413});}parts.push(chunk.value);} }
  let body:Uint8Array = new Uint8Array(size);let offset=0;for(const part of parts){body.set(part,offset);offset+=part.length;}
  if((login||register||otp)&&officeTenant){let input;try{input=JSON.parse(new TextDecoder().decode(body));}catch{return Response.json({}, {status:400});}body=new TextEncoder().encode(JSON.stringify({...input,tenant:officeTenant}));size=body.length;}
  try {
    const target=new URL(base);
    if(target.username||target.password||target.search||target.hash||!(target.protocol==='https:'||target.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(target.hostname)))throw Error('Invalid API');
    const response=await transport(`${target.href.replace(/\/$/,'')}/api/v1/${login?'auth/login':'customer-app/'+route}${url.search}`,{method:request.method,headers:{'Content-Type':'application/json',...(authorization?{Authorization:authorization}:{}),...(otp&&request.headers.get('X-Customer-Debug')==='1'?{'X-Customer-Debug':'1'}:{})},body:size?body as BodyInit:undefined,redirect:'error',cache:'no-store',signal:AbortSignal.any([request.signal,AbortSignal.timeout(route.endsWith('updates')||route.endsWith('/chat')?35000:15000)])});
    if(!response.ok){const detail=await response.json().catch(()=>({}));const messages:Record<string,string>={PHONE_VERIFICATION_REQUIRED:'هذا الحساب يحتاج التحقق من رقم الهاتف. استخدم التسجيل أو الاستعادة.',SMS_UNAVAILABLE:'التحقق بالرسائل غير متاح حاليًا. تواصل مع المكتب.',OTP_RATE_LIMITED:'انتظر قليلًا قبل طلب رمز جديد.',INVALID_PHONE:'أدخل رقم جوال فلسطينيًا يبدأ بـ 059 أو 056.',OTP_INVALID_OR_EXPIRED:'رمز التحقق غير صحيح أو انتهت صلاحيته. راجع الرمز أو اطلب رمزًا جديدًا.'};const code=typeof detail.code==='string'&&Object.hasOwn(messages,detail.code)?detail.code:undefined;return Response.json({detail:code?messages[code]:response.status===404&&otp?'خدمة التحقق تحتاج تحديثًا لدى المكتب. تواصل مع المكتب.':'تعذر إكمال العملية، حاول مرة أخرى.',...(code?{code}:{})},{status:response.status,headers:{'Cache-Control':'no-store'}});}
    return new Response(response.body,{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  } catch { return Response.json({detail:'تعذر الاتصال بالمكتب. تحقق من الاتصال وأعد المحاولة.'},{status:503}); }
}
