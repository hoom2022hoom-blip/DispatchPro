type Reply = { id?:string; data?:unknown; error?:string; event?:string; value?:boolean };
type InitialState = { apiOrigin:string; notifications:boolean; online:boolean; foreground:boolean };
let port:MessagePort|null=null;
let online=true,foreground=true;
const pending=new Map<string,{resolve:(value:any)=>void;reject:(error:Error)=>void;cleanup:()=>void}>();

export function connectNative():Promise<InitialState> {
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('تعذر فتح اتصال Android؛ أغلق التطبيق وافتحه مجددًا')),15000);
    const listener=(event:MessageEvent)=>{
      if(event.data!=='dispatchpro-connect'||event.ports.length!==1)return;
      window.removeEventListener('message',listener);clearTimeout(timeout);port=event.ports[0];
      port.onmessage=event=>{
        let reply:Reply;try{reply=JSON.parse(event.data);}catch{return;}
        if(reply.event){
          if(reply.event==='online')online=reply.value===true;
          if(reply.event==='foreground')foreground=reply.value===true;
          window.dispatchEvent(new Event(online&&foreground?'online':'offline'));return;
        }
        const task=reply.id?pending.get(reply.id):undefined;if(!task)return;
        pending.delete(reply.id!);task.cleanup();if(reply.error)task.reject(new Error(reply.error));else task.resolve(reply.data);
      };
      port.start();
      void nativeCall<InitialState>('ready').then(state=>{online=state.online;foreground=state.foreground;Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>online&&foreground});resolve(state);}).catch(reject);
    };
    window.addEventListener('message',listener);
  });
}

export function nativeCall<T>(type:string,payload:Record<string,unknown>={},signal?:AbortSignal):Promise<T> {
  return new Promise((resolve,reject)=>{
    if(!port){reject(new Error('Android connection unavailable'));return;}
    if(signal?.aborted){reject(new DOMException('Aborted','AbortError'));return;}
    const id=crypto.randomUUID();
    const abort=()=>{if(!pending.delete(id))return;clearTimeout(timeout);signal?.removeEventListener('abort',abort);port?.postMessage(JSON.stringify({id,type:'cancel'}));reject(new DOMException('Aborted','AbortError'));};
    const timeout=setTimeout(()=>{abort();},type==='permission'?120000:35000);
    pending.set(id,{resolve,reject,cleanup:()=>{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}});
    signal?.addEventListener('abort',abort,{once:true});
    port.postMessage(JSON.stringify({...payload,id,type}));
  });
}

export function driverNativeFetch(input:RequestInfo|URL,init:RequestInit={}):Promise<Response> {
  const path=String(input);
  if(!path.startsWith('/api/reception/'))return Promise.reject(new Error('Unsupported app request'));
  const headers=new Headers(init.headers);
  return nativeCall<{status:number;body:string}>('request',{
    path:path.slice('/api/reception/'.length),method:init.method??'GET',body:init.body??'',authorization:headers.get('Authorization')??'',
  },init.signal??undefined).then(result=>new Response(result.body,{status:result.status,headers:{'Content-Type':'application/json'}}));
}
