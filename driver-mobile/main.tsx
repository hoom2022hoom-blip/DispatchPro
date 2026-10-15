import React from 'react';
import { createRoot } from 'react-dom/client';
import { DriverApiDashboard } from '../src/components/driver-api-dashboard';
import { driverPlatform, installAbortCompatibility } from './runtime';

installAbortCompatibility();
const platform = driverPlatform();
window.fetch = platform.fetch;
// Refresh authoritative state on iPhone/Android browser resume, including bfcache.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') window.dispatchEvent(new Event('online'));
});
window.addEventListener('pageshow', () => window.dispatchEvent(new Event('online')));
createRoot(document.getElementById('app')!).render(<DriverApiDashboard logoSrc="office-logo.webp" />);
