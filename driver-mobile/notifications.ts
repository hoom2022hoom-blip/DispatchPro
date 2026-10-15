import { driverPlatform } from './runtime';

export async function enableBrowserNotifications() {
  try { return await driverPlatform().notifications.requestPermission(); }
  catch { return 'unsupported'; }
}
export async function sendBrowserNotification(title: string, body: string, _icon?:string,tag?:string,eventId?:string) {
  try { await driverPlatform().notifications.show(title, body,tag); }
  catch { /* Notification failures must not interrupt a ride. */ }
}
export async function closeDriverOfferNotification(id:string){try{await driverPlatform().notifications.close?.('driver-offer-'+id);}catch{}}
