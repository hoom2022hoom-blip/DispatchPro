import React from 'react';
import { createRoot } from 'react-dom/client';
import { DriverApiDashboard } from '../../src/components/driver-api-dashboard';
import { connectNative, driverNativeFetch } from './native-bridge';

// Older supported Android WebViews do not have AbortSignal.any/timeout yet.
if(!AbortSignal.timeout)AbortSignal.timeout=(ms:number)=>{const controller=new AbortController();setTimeout(()=>controller.abort(),ms);return controller.signal;};
if(!AbortSignal.any)AbortSignal.any=(signals:AbortSignal[])=>{
  const controller=new AbortController();
  const abort=()=>{controller.abort();for(const signal of signals)signal.removeEventListener('abort',abort);};
  for(const signal of signals){if(signal.aborted){abort();break;}signal.addEventListener('abort',abort,{once:true});}
  return controller.signal;
};
void connectNative().then(()=>{
  window.fetch=driverNativeFetch;
  createRoot(document.getElementById('app')!).render(<DriverApiDashboard/>);
}).catch(error=>{const element=document.getElementById('app')!;element.textContent=(error as Error).message;});
