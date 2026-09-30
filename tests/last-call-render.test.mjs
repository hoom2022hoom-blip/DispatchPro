import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { setTimeout as delay } from 'node:timers/promises';
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  if (context.parentURL?.includes('/src/') && specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });
const { useIncomingCall } = await import('../src/hooks/use-incoming-call.ts');
const { useApiLastCall } = await import('../src/hooks/use-api-last-call.ts');
const { apiReceptionBackend } = await import('../src/lib/reception-api.ts');
const call = n => ({ eventId: `render-${n}`, source: 'WHATSAPP', phone: `059123456${n}`, timestamp: `2026-09-27T12:00:0${n}.000Z` });

test('mounted React last-call display renders a second poll while first order persistence is still pending, without scroll', async () => {
  const originalFetch = globalThis.fetch, originalWindow = globalThis.window;
  const events = new EventTarget(); let interactionCount = 0;
  for (const name of ['scroll','mousemove','keydown']) events.addEventListener(name, () => interactionCount++);
  globalThis.window = { location: { hostname: 'localhost' }, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) };
  let current = call(1), release;
  const persistence = new Promise(resolve => { release = resolve; });
  globalThis.fetch = async () => Response.json({ latest: { event: current }, events: [{ event: current }] });
  function Display() { const { call: latest } = useIncomingCall(() => persistence, true); return React.createElement('output', null, latest?.phone ?? 'empty'); }
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(Display)); });
    assert.equal(renderer.toJSON().children[0], call(1).phone);
    current = call(2);
    await act(async () => { await delay(1150); });
    assert.equal(renderer.toJSON().children[0], call(2).phone);
    assert.equal(interactionCount, 0);
  } finally { await act(async () => renderer?.unmount()); release(); globalThis.fetch = originalFetch; globalThis.window = originalWindow; }
});

test('push events immediately render twice and an older in-flight poll cannot revert the UI', async () => {
  const originalFetch = globalThis.fetch, originalWindow = globalThis.window;
  const events = new EventTarget();
  globalThis.window = { location: { hostname: 'localhost' }, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) };
  let finish; globalThis.fetch = () => new Promise(resolve => { finish = resolve; });
  function Display() { const { call: latest } = useIncomingCall(async () => {}, true); return React.createElement('output', null, latest?.phone ?? 'empty'); }
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(Display)); });
    await act(async () => events.dispatchEvent(new CustomEvent('dispatchpro:call', { detail: call(1) })));
    assert.equal(renderer.toJSON().children[0], call(1).phone);
    await act(async () => events.dispatchEvent(new CustomEvent('dispatchpro:call', { detail: call(2) })));
    assert.equal(renderer.toJSON().children[0], call(2).phone);
    await act(async () => finish(Response.json({ latest: { event: call(1) }, events: [] })));
    assert.equal(renderer.toJSON().children[0], call(2).phone);
  } finally { await act(async () => renderer?.unmount()); globalThis.fetch = originalFetch; globalThis.window = originalWindow; }
});

test('API call integration notifies the mounted React subscriber for both calls without a table reload', async () => {
  const originalFetch = globalThis.fetch; let current = call(1), renderer;
  globalThis.fetch = async path => path.endsWith('auth/login') ? Response.json({ accessToken: 'test' }) : path.endsWith('latest-call') ? Response.json(current) : Response.json({ duplicate: false });
  function Display() { const latest = useApiLastCall(); return React.createElement('output', null, latest?.phone ?? 'empty'); }
  try {
    await apiReceptionBackend.login('office', 'test', 'test');
    await act(async () => { renderer = TestRenderer.create(React.createElement(Display)); });
    await act(async () => apiReceptionBackend.receiveCall(current));
    assert.equal(renderer.toJSON().children[0], call(1).phone);
    current = call(2);
    await act(async () => apiReceptionBackend.receiveCall(current));
    assert.equal(renderer.toJSON().children[0], call(2).phone);
    await act(async () => apiReceptionBackend.logout());
    assert.equal(renderer.toJSON().children[0], 'empty');
  } finally { await act(async () => renderer?.unmount()); apiReceptionBackend.logout(); globalThis.fetch = originalFetch; }
});
