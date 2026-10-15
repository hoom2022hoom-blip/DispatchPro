// The existing device-bound Customer account is the only source of authentication.
// DeviceSecret stays in the established device store; no customer password is added.
export function createCustomerSession({device,fetchImpl=(...args)=>fetch(...args),onInvalid=()=>{}}){
  let token='',generation=0,loginTask=null;
  async function raw(route,method='GET',body,signal){
    const current=generation;
    let response;
    try{response=await fetchImpl('/api/customer/'+route,{method,cache:'no-store',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(globalThis.window?.dispatchProCustomerDebug&&(route.startsWith('otp/')||route==='test-otp/request')?{'X-Customer-Debug':'1'}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(35000)]):AbortSignal.timeout(15000)});}
    catch(e){if(signal?.aborted)throw e;const error=new Error('تعذر الاتصال بالمكتب. تحقق من الإنترنت وأعد المحاولة.');error.status=0;throw error;}
    if(globalThis.window?.dispatchProDevelopment)performance.mark('customer-backend-response');
    const data=await response.json().catch(()=>({}));
    if(current!==generation){const error=new Error('تغيّرت الجلسة؛ أعد المحاولة');error.status=0;throw error;}
    if(!response.ok){const safeDetail=typeof data.detail==='string'&&/^[\u0600-\u06ff\s،؛؟.…:0-9٠-٩()\-]+$/.test(data.detail)?data.detail:null;const error=new Error(safeDetail||(response.status===401?'انتهت الجلسة. افتح حسابك مجددًا.':response.status===409?'تعذر إكمال العملية. راجع طلبك الحالي أو تواصل مع المكتب.':response.status>=500?'حدث خطأ مؤقت. يرجى المحاولة مرة أخرى.':'تعذر إتمام الطلب. راجع البيانات وحاول مرة أخرى.'));error.status=response.status;error.code=typeof data.code==='string'?data.code:'';error.sessionInvalid=false;throw error;}
    return data;
  }
  function accept(value){generation++;token=value;loginTask=null;}
  async function login(){
    if(!loginTask){const current=generation,account=device();if(!account)throw new Error('افتح حسابك أولًا');
      const task=raw('login','POST',{tenant:account.tenant,username:'customer-'+account.accountId.replaceAll('-',''),password:account.deviceSecret}).then(result=>{if(current===generation)token=result.accessToken;}).catch(e=>{if(e.status===401&&current===generation){token='';generation++;e.sessionInvalid=true;e.message=e.code==='PHONE_VERIFICATION_REQUIRED'?'هذا الحساب يحتاج التحقق من رقم الهاتف. استخدم التسجيل أو الاستعادة.':'تعذر الدخول بالحساب المحفوظ. استخدم التسجيل أو الاستعادة أو راجع المكتب.';onInvalid();}throw e;}).finally(()=>{if(loginTask===task)loginTask=null;});loginTask=task;}
    return loginTask;
  }
  async function request(route,method='GET',body,signal){
    if(!token)await login();
    const current=generation;
    try{return await raw(route,method,body,signal);}catch(e){
      if(e.status!==401||current!==generation)throw e;
      await login();
      try{return await raw(route,method,body,signal);}catch(failed){
        if(failed.status===401&&current===generation){
          // A denied optional request cannot invalidate a newly issued valid token.
          try{await raw('me');}catch(primary){if(primary.status===401){token='';generation++;failed.sessionInvalid=true;failed.message='انتهت الجلسة. افتح حسابك مجددًا.';onInvalid();}}
        }
        throw failed;
      }
    }
  }
  return{raw,login,request,accept,logout(){generation++;token='';loginTask=null;},authenticated:()=>!!token};
}
