type Reply = { id?:string; data?:unknown; error?:string; code?:string; event?:string; value?:any };
type InitialState = { apiOrigin:string; qa?:boolean; appVersion?:string; appVersionCode?:number; notifications:boolean; online:boolean; foreground:boolean; openOffer?:boolean;communicationOpen?:{callId:string;rideId:string;action:string} };
let port:MessagePort|null=null;
let online=true,foreground=true;
const pending=new Map<string,{resolve:(value:any)=>void;reject:(error:Error)=>void;cleanup:()=>void}>();
const browserFetch=globalThis.fetch.bind(globalThis);

// Android postWebMessage originates in native code, not in the document.
// Its source origin is empty. Native code targets this exact local main frame,
// whose CSP forbids frames and whose resource/navigation policy is closed.
export function acceptsNativeHandshake(event:Pick<MessageEvent,'origin'|'source'|'data'|'ports'>,pageOrigin:string){
  return pageOrigin==='https://appassets.androidplatform.net' && event.origin==='' && event.source===null
    && event.data==='dispatchpro-connect' && event.ports?.length===1;
}

export function connectNative():Promise<InitialState> {
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('تعذر فتح اتصال Android؛ أغلق التطبيق وافتحه مجددًا')),15000);
    const listener=(event:MessageEvent)=>{
      if(!acceptsNativeHandshake(event,location.origin))return;
      window.removeEventListener('message',listener);clearTimeout(timeout);port=event.ports[0];(globalThis as typeof globalThis&{dispatchProDriverNative:boolean}).dispatchProDriverNative=true;
      port.onmessage=event=>{
        let reply:Reply;try{reply=JSON.parse(event.data);}catch{return;}
        if(reply.event){
          if(['radio-status','external-key','external-ptt','radio-stop','radio-focus','voice-focus'].includes(reply.event))window.dispatchEvent(new CustomEvent('dispatchpro-'+reply.event,{detail:reply.value}));
          if(reply.event==='radio-status')(globalThis as any).dispatchProDriverBackground=reply.value?.operational===true;
          if(reply.event==='communication-open'){const d=reply.value;if(d.action==='chat'){(globalThis as any).dispatchProChatOpen=d.rideId;window.dispatchEvent(new CustomEvent('dispatchpro-chat-open',{detail:{rideId:d.rideId}}));}else{(globalThis as any).dispatchProCommunicationOpen=d;window.dispatchEvent(new CustomEvent('dispatchpro-call-open',{detail:d}));}}
          if(reply.event==='offer-open'){(globalThis as typeof globalThis&{dispatchProDriverOfferOpen:boolean}).dispatchProDriverOfferOpen=true;window.dispatchEvent(new Event('dispatchpro-driver-open-offer'));}
          if(reply.event==='push-device')window.dispatchEvent(new CustomEvent('dispatchpro-driver-push',{detail:reply.value}));
          const connectivityChanged=reply.event==='online'&&online!==(reply.value===true);
          if(reply.event==='online')online=reply.value===true;
          if(reply.event==='background'){(globalThis as typeof globalThis&{dispatchProDriverBackground:boolean}).dispatchProDriverBackground=reply.value===true;window.dispatchEvent(new Event('dispatchpro-driver-service'));}
          if(reply.event==='foreground'){foreground=reply.value===true;(globalThis as typeof globalThis&{dispatchProDriverNativeForeground:boolean}).dispatchProDriverNativeForeground=foreground;window.dispatchEvent(new Event('dispatchpro-driver-foreground'));if(!foreground)window.dispatchEvent(new Event('blur'));else void nativeCall<boolean>('service.status').then(active=>{(globalThis as typeof globalThis&{dispatchProDriverBackground:boolean}).dispatchProDriverBackground=active;}).catch(()=>{});}
          if(connectivityChanged)window.dispatchEvent(new Event(online?'online':'offline'));
          if(reply.event==='network-changed')window.dispatchEvent(new Event('dispatchpro-network-changed'));
          return;
        }
        const task=reply.id?pending.get(reply.id):undefined;if(!task)return;
        pending.delete(reply.id!);task.cleanup();if(reply.error)task.reject(Object.assign(new Error(reply.error),reply.code?{code:reply.code}:{}));else task.resolve(reply.data);
      };
      port.start();
      (globalThis as any).dispatchProCallNative=(type:string,data:unknown)=>nativeCall(type,data as Record<string,unknown>);
      // Capture only exception type and current state, never passenger data,
      // tokens, message text or response bodies. Useful for a physical WebView.
      window.addEventListener('dispatchpro-driver-runtime',event=>{void nativeCall('diagnostics.runtime',(event as CustomEvent).detail).catch(()=>{});});
      (globalThis as typeof globalThis&{dispatchProDriverDiagnostics:unknown}).dispatchProDriverDiagnostics={read:()=>nativeCall('diagnostics'),copy:()=>nativeCall('diagnostics.copy'),settings:(section:string)=>nativeCall('diagnostics.settings',{section})};

      window.addEventListener('dispatchpro-driver-ready',()=>{void nativeCall('driver.push-refresh').catch(()=>{});void nativeCall<boolean>('service.status').then(active=>{(globalThis as typeof globalThis&{dispatchProDriverBackground:boolean}).dispatchProDriverBackground=active;}).catch(()=>{});});
      const geolocation=navigator.geolocation;
      if(geolocation){const original=geolocation.getCurrentPosition.bind(geolocation);geolocation.getCurrentPosition=(success,failure,options)=>{if(foreground){original(success,failure,options);return;}void nativeCall<{latitude:number;longitude:number;accuracy:number;timestamp:number}>('location').then(value=>success({coords:{latitude:value.latitude,longitude:value.longitude,accuracy:value.accuracy,altitude:null,altitudeAccuracy:null,heading:null,speed:null},timestamp:value.timestamp} as GeolocationPosition)).catch(()=>failure?.({code:3,message:'تعذر تحديث GPS',PERMISSION_DENIED:1,POSITION_UNAVAILABLE:2,TIMEOUT:3}));};}

      window.addEventListener('dispatchpro-driver-notification-settings',event=>{void nativeCall('notification.settings',(event as CustomEvent).detail).catch(()=>{});});
      window.addEventListener('dispatchpro-driver-offer',event=>{void nativeCall('offer',(event as CustomEvent).detail).catch(()=>{});});
      window.addEventListener('dispatchpro-gps-access',event=>{void nativeCall('service.gps',{active:(event as CustomEvent).detail.active}).catch(()=>{});});
      window.addEventListener('dispatchpro-driver-duty',event=>{void nativeCall('service.duty',{active:(event as CustomEvent).detail.active}).then(()=>nativeCall<boolean>('service.status')).then(active=>{(globalThis as typeof globalThis&{dispatchProDriverBackground:boolean}).dispatchProDriverBackground=active;}).catch(()=>{});});
      window.addEventListener('dispatchpro-driver-push-bound',event=>{void nativeCall('driver.push-bound',{recipient:(event as CustomEvent).detail.recipient}).catch(()=>{});});
      window.addEventListener('dispatchpro-voice-audio',event=>{const detail=(event as CustomEvent).detail;void nativeCall('voice.audio',{active:detail.active,reason:detail.reason}).catch(()=>{});});
      window.addEventListener('dispatchpro-voice-prepared',event=>{void nativeCall('voice.prepared',{active:(event as CustomEvent).detail.active}).catch(()=>{});});
      window.addEventListener('dispatchpro-voice-metric',event=>{void nativeCall('communication.metric',{...(event as CustomEvent).detail,eventEpochMs:Date.now()}).catch(()=>{});});
      window.addEventListener('dispatchpro-voice-speaker',event=>{void nativeCall('voice.speaker',(event as CustomEvent).detail).catch(()=>{});});
      void nativeCall<boolean>('service.status').then(active=>{(globalThis as typeof globalThis&{dispatchProDriverBackground:boolean}).dispatchProDriverBackground=active;}).catch(()=>{});
      void nativeCall<InitialState>('ready').then(state=>{online=state.online;foreground=state.foreground;(globalThis as typeof globalThis&{dispatchProDriverQa?:boolean}).dispatchProDriverQa=state.qa===true;(globalThis as typeof globalThis&{dispatchProDriverAppVersion?:string;dispatchProDriverAppVersionCode?:number}).dispatchProDriverAppVersion=state.appVersion;(globalThis as typeof globalThis&{dispatchProDriverAppVersionCode?:number}).dispatchProDriverAppVersionCode=state.appVersionCode;if(state.communicationOpen){if(state.communicationOpen.action==='chat')(globalThis as any).dispatchProChatOpen=state.communicationOpen.rideId;else (globalThis as any).dispatchProCommunicationOpen=state.communicationOpen;}(globalThis as typeof globalThis&{dispatchProDriverOfferOpen:boolean}).dispatchProDriverOfferOpen=!!state.openOffer;Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>online});resolve(state);}).catch(reject);
    };
    window.addEventListener('message',listener);
  });
}

export function nativeCall<T>(type:string,payload:Record<string,unknown>={},signal?:AbortSignal):Promise<T> {
  return new Promise((resolve,reject)=>{
    if(!port){reject(new Error('Android connection unavailable'));return;}
    if(signal?.aborted){reject(new DOMException('Aborted','AbortError'));return;}
    const id=crypto.randomUUID();
    const cancel=(timedOut=false)=>{if(!pending.delete(id))return;clearTimeout(timeout);signal?.removeEventListener('abort',abort);port?.postMessage(JSON.stringify({id,type:'cancel'}));reject(new DOMException(timedOut?'Native response timed out':'Aborted',timedOut?'TimeoutError':'AbortError'));};
    const abort=()=>cancel();
    const timeout=setTimeout(()=>{cancel((globalThis as any).dispatchProDriverQa===true);},type==='permission'||type==='call.audio'?120000:35000);
    pending.set(id,{resolve,reject,cleanup:()=>{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}});
    signal?.addEventListener('abort',abort,{once:true});
    port.postMessage(JSON.stringify({...payload,id,type}));
  });
}

export function driverNativeFetch(input:RequestInfo|URL,init:RequestInit={}):Promise<Response> {
  const path=input instanceof Request?input.url:String(input);
  // The existing map uses only public OSM raster tiles. Ride API calls still use the scoped native port.
  if(path.startsWith('https://tile.openstreetmap.org/')){
    const url=new URL(path),headers=new Headers(init.headers??(input instanceof Request?input.headers:undefined));
    if(url.origin==='https://tile.openstreetmap.org'&&!url.search&&!url.hash&&!url.username&&!url.password&&/^\/[0-9]{1,2}\/[0-9]+\/[0-9]+\.png$/.test(url.pathname)&&(init.method??(input instanceof Request?input.method:'GET'))==='GET'&&!headers.has('Authorization')&&!headers.has('Cookie'))return browserFetch(input,{...init,credentials:'omit',redirect:'error'});
  }
  if(!path.startsWith('/api/reception/'))return Promise.reject(new Error('Unsupported app request'));
  const headers=new Headers(init.headers);
  return nativeCall<{status:number;body:string}>('request',{
    path:path.slice('/api/reception/'.length),method:init.method??'GET',body:init.body??'',authorization:headers.get('Authorization')??'',
  },init.signal??undefined).then(result=>new Response(result.body,{status:result.status,headers:{'Content-Type':'application/json'}}));
}
