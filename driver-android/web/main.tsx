import React from 'react';
import { createRoot } from 'react-dom/client';
import { DriverApiDashboard } from '../../src/components/driver-api-dashboard';
import { connectNative, driverNativeFetch, nativeCall } from './native-bridge';
import {DriverErrorBoundary} from '../../src/components/driver-error-boundary';
import {installDriverErrorLogging} from '../../src/lib/driver-runtime-diagnostics.js';
installDriverErrorLogging();

// Older supported Android WebViews do not have AbortSignal.any/timeout yet.
if(!AbortSignal.timeout)AbortSignal.timeout=(ms:number)=>{const controller=new AbortController();setTimeout(()=>controller.abort(),ms);return controller.signal;};
if(!AbortSignal.any)AbortSignal.any=(signals:AbortSignal[])=>{
  const controller=new AbortController();
  const abort=()=>{controller.abort();for(const signal of signals)signal.removeEventListener('abort',abort);};
  for(const signal of signals){if(signal.aborted){abort();break;}signal.addEventListener('abort',abort,{once:true});}
  return controller.signal;
};
void connectNative().then(()=>{
  (globalThis as typeof globalThis & {dispatchProDriverStorage:import('../../src/lib/driver-api').DriverSessionStorage}).dispatchProDriverStorage={
    async load(){const value=await nativeCall<string>('session.load');try{return value?JSON.parse(value):null;}catch{return null;}},
    async save(value,remember=true){await nativeCall('session.save',{value:value?JSON.stringify(value):'',remember});}
  };
  window.fetch=driverNativeFetch;
  const root=createRoot(document.getElementById('app')!);let recovery=0;
  const render=()=>root.render(<DriverErrorBoundary onRecover={()=>{recovery++;render();}}><DriverApiDashboard key={recovery} recoverFromBackend={recovery>0} logoSrc="office-logo.webp"/></DriverErrorBoundary>);
  render();
}).catch(error=>{const element=document.getElementById('app')!;element.textContent=(error as Error).message;});
