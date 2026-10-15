// Request permission only from an explicit user gesture.
export async function enableBrowserNotifications() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.requestPermission();
}
export async function sendBrowserNotification(title: string, body: string, icon = '/favicon.ico', tag?:string,eventId?:string) {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (registration?.active) await registration.showNotification(title, { body, icon,tag });
    else {const notification=new Notification(title, { body, icon,tag });if(tag)activeNotifications.set(tag,notification);}
  } catch { /* In-app notifications remain available. */ }
}
const activeNotifications=new Map<string,Notification>();
export async function closeDriverOfferNotification(id:string){const tag='driver-offer-'+id;activeNotifications.get(tag)?.close();activeNotifications.delete(tag);try{const registration=await navigator.serviceWorker?.getRegistration();for(const notification of await registration?.getNotifications({tag})??[])notification.close();}catch{}}
