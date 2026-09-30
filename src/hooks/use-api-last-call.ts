"use client";
import { useSyncExternalStore } from 'react';
import { apiReceptionBackend } from '../lib/reception-api';
export function useApiLastCall() {
  return useSyncExternalStore(apiReceptionBackend.subscribeLatest, apiReceptionBackend.getLatestCall, () => null);
}
