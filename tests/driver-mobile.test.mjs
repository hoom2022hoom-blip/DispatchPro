import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { browserNotifications, configureDriverPlatform, driverPlatform, installAbortCompatibility } from '../driver-mobile/runtime.ts';
import { createDriverApi } from '../src/lib/driver-api.ts';

test('portable driver uses injected host transport with existing login and versioned ride API', async () => {
  const calls = [];
  configureDriverPlatform({ fetch: async (url, options) => {
    calls.push({ url, options });
    return Response.json(url.endsWith('auth/driver-login') ? { accessToken: 'test-token' } : url.endsWith('driver/rides/ride') ? {id:'ride',status:'Arrived',version:9,pickup:'الانطلاق',destination:'الوجهة'} : { id: 'driver',status:'Offline' });
  }, notifications: browserNotifications() });
  const api = createDriverApi(driverPlatform().fetch);
  await api.login('office', 'driver', 'test');
  await api.transition({ id: 'ride', version: 8 }, 'Arrived');
  assert.equal(calls[2].url, '/api/reception/rides/ride/status');
  assert.equal(calls[2].options.headers.Authorization, 'Bearer test-token');
  assert.deepEqual(JSON.parse(calls[2].options.body), { status: 'Arrived', version: 8 });
  api.logout();
  await assert.rejects(() => api.history(), e => e.status === 401);
});

test('notification abstraction supports injected native providers and restricted iOS/browser fallback', async () => {
  const hooks = registerHooks({ resolve(s, c, next) {
    if (s === './runtime' && c.parentURL?.endsWith('/driver-mobile/notifications.ts')) return next('./runtime.ts', c);
    return next(s, c);
  } });
  const oldNotification = Object.getOwnPropertyDescriptor(globalThis, 'Notification');
  try {
    const { enableBrowserNotifications, sendBrowserNotification } = await import('../driver-mobile/notifications.ts');
    let requests = 0; const shown = [];
    configureDriverPlatform({ fetch, notifications: {
      async requestPermission() { requests++; return 'granted'; },
      async show(...args) { shown.push(args); },
    } });
    await sendBrowserNotification('request', 'safe text');
    assert.equal(requests, 0);
    assert.deepEqual(shown, [['request', 'safe text', undefined]]);
    assert.equal(await enableBrowserNotifications(), 'granted');
    assert.equal(requests, 1);
    delete globalThis.Notification;
    configureDriverPlatform({ fetch, notifications: browserNotifications() });
    assert.equal(await enableBrowserNotifications(), 'unsupported');
    await sendBrowserNotification('request', 'safe text');
    globalThis.Notification = class { static permission = 'granted'; static requestPermission() { throw Error('restricted'); } constructor() { throw Error('iOS requires service worker'); } };
    assert.equal(await enableBrowserNotifications(), 'unsupported');
    await sendBrowserNotification('request', 'safe text');
  } finally {
    hooks.deregister();
    if (oldNotification) Object.defineProperty(globalThis, 'Notification', oldNotification); else delete globalThis.Notification;
  }
});

test('older Safari/WebView abort fallback preserves cancellation', () => {
  const any = AbortSignal.any, timeout = AbortSignal.timeout;
  try {
    AbortSignal.any = undefined; AbortSignal.timeout = undefined;
    installAbortCompatibility();
    const controller = new AbortController();
    const combined = AbortSignal.any([controller.signal]);
    controller.abort();
    assert.equal(combined.aborted, true);
    assert.equal(AbortSignal.any([controller.signal]).aborted, true);
    assert.ok(AbortSignal.timeout(1) instanceof AbortSignal);
  } finally { AbortSignal.any = any; AbortSignal.timeout = timeout; }
});
