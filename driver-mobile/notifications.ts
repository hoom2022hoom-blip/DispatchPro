import { driverPlatform } from './runtime';

export async function enableBrowserNotifications() {
  try { return await driverPlatform().notifications.requestPermission(); }
  catch { return 'unsupported'; }
}
export async function sendBrowserNotification(title: string, body: string) {
  try { await driverPlatform().notifications.show(title, body); }
  catch { /* Notification failures must not interrupt a ride. */ }
}
