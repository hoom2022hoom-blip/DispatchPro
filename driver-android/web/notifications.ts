import { nativeCall } from './native-bridge';
// Provider boundary: a future Firebase service supplies background delivery without changing the driver UI.
export const enableBrowserNotifications=()=>nativeCall<string>('permission');
export async function sendBrowserNotification(title:string,body:string,_icon?:string,tag?:string,eventId?:string) {
  try{await nativeCall('notification',{title,body,tag,eventId});}catch{/* The existing in-app request card remains visible. */}
}
export async function closeDriverOfferNotification(id:string){try{await nativeCall('notification.close',{tag:'driver-offer-'+id});}catch{}}
