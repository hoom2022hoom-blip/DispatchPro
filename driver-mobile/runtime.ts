// Platform contract shared by browser, Android and a future iOS host.
// Hosts supply transport/notifications; authentication and ride rules stay in driver-api.
export type NotificationPermissionResult = 'granted' | 'denied' | 'default' | 'unsupported';
export interface DriverNotifications {
  requestPermission(): Promise<NotificationPermissionResult>;
  show(title: string, body: string): Promise<void>;
}
export interface DriverPlatform {
  fetch: typeof fetch;
  notifications: DriverNotifications;
}

export function browserNotifications(): DriverNotifications {
  return {
    async requestPermission() {
      if (typeof Notification === 'undefined') return 'unsupported';
      try { return await Notification.requestPermission(); } catch { return 'unsupported'; }
    },
    async show(title, body) {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      try {
        const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
        if (registration?.active) await registration.showNotification(title, { body });
        else new Notification(title, { body });
      } catch { /* iOS/browser restrictions leave the durable in-app feed available. */ }
    },
  };
}

let platform: DriverPlatform | undefined;
export function configureDriverPlatform(value: DriverPlatform) { platform = value; }
export function driverPlatform(): DriverPlatform {
  return platform ??= { fetch: globalThis.fetch.bind(globalThis), notifications: browserNotifications() };
}

// Supported WebViews/Safari versions may lack these two AbortSignal helpers.
export function installAbortCompatibility() {
  if (!AbortSignal.timeout) AbortSignal.timeout = (ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  };
  if (!AbortSignal.any) AbortSignal.any = (signals: AbortSignal[]) => {
    const controller = new AbortController();
    const abort = () => {
      controller.abort();
      for (const signal of signals) signal.removeEventListener('abort', abort);
    };
    for (const signal of signals) {
      if (signal.aborted) { abort(); break; }
      signal.addEventListener('abort', abort, { once: true });
    }
    return controller.signal;
  };
}
