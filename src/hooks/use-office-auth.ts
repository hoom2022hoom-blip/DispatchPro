"use client";
import {useEffect,useSyncExternalStore} from 'react';
import {apiReceptionBackend as api,type OfficeAuthState} from '@/lib/reception-api';
const serverState:OfficeAuthState={authReady:false,authenticated:false,tenant:''};
export function useOfficeAuth(){
  const state=useSyncExternalStore(api.subscribeAuth,api.authSnapshot,()=>serverState);
  useEffect(()=>{void api.bootstrap();},[]);
  return state;
}
