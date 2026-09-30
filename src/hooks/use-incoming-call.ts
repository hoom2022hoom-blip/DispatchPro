"use client";
import { useEffect, useRef, useState } from 'react';
import { parseCallEvent, type CallEvent } from '@/lib/call-events';

export function useIncomingCall(receiveCall: (event: CallEvent) => Promise<void>, enabled: boolean) {
  const [call, setCall] = useState<CallEvent | null>(null);
  const [connection, setConnection] = useState('جارٍ الاتصال باستقبال المكالمات');
  const receiver = useRef(receiveCall);
  useEffect(() => { receiver.current = receiveCall; }, [receiveCall]);
  useEffect(() => {
    if (!enabled) { setCall(null); return; }
    const completed = new Set<string>(), pending = new Map<string, CallEvent>();
    let stopped = false, delivering = false, eventRevision = 0;
    let timer: ReturnType<typeof setTimeout>, retry: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function deliver() {
      if (delivering || stopped) return;
      delivering = true;
      try {
        for (const [id, event] of pending) {
          if (stopped) return;
          try { await receiver.current(event); completed.add(id); pending.delete(id); }
          catch { if (!stopped) setConnection('تعذر تسجيل المكالمة — إعادة المحاولة تلقائيًا'); }
        }
      } finally {
        delivering = false;
        if (!stopped && pending.size) { clearTimeout(retry); retry = setTimeout(() => void deliver(), 3000); }
      }
    }
    const listener = (input: Event) => {
      try {
        const event = parseCallEvent((input as CustomEvent).detail);
        eventRevision++;
        setCall({ ...event });
        if (!completed.has(event.eventId)) pending.set(event.eventId, event);
        void deliver();
      } catch { /* Invalid integration events do not alter the displayed call. */ }
    };
    window.addEventListener('dispatchpro:call', listener);
    async function poll() {
      let delay = 1000;
      const revision = eventRevision;
      try {
        const response = await fetch('/api/calls', { cache: 'no-store', headers: { 'X-DispatchPro-Client': 'reception' }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        if (stopped) return;
        if (response.status === 404) { setConnection('استقبال المكالمات المحلي غير مفعّل'); delay = 30000; }
        else {
          if (!response.ok) throw new Error('connection');
          const data = await response.json();
          if (stopped) return;
          // A response started before a push event must not overwrite that event.
          if (data.latest && revision === eventRevision) setCall({ ...parseCallEvent(data.latest.event) });
          for (const record of data.events ?? []) {
            const event = parseCallEvent(record.event);
            if (!completed.has(event.eventId)) pending.set(event.eventId, event);
          }
          setConnection('استقبال المكالمات متصل — تسجيل تلقائي');
          void deliver(); // Persistence never blocks the next last-call poll.
        }
      } catch { if (!stopped) setConnection('تعذر الاتصال — إعادة المحاولة تلقائيًا'); delay = 3000; }
      if (!stopped) timer = setTimeout(poll, delay);
    }
    if (['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) void poll();
    else setConnection('استقبال المكالمات متاح على جهاز المكتب المحلي');
    return () => { stopped = true; clearTimeout(timer); clearTimeout(retry); controller.abort(); window.removeEventListener('dispatchpro:call', listener); };
  }, [enabled]);
  return { call, connection };
}
