import { nativeCall } from './native-bridge';
// Provider boundary: a future Firebase service supplies background delivery without changing the driver UI.
export const enableBrowserNotifications=()=>nativeCall<string>('permission');
export async function sendBrowserNotification(title:string,body:string) {
  try{await nativeCall('notification',{title,body});}catch{/* The existing in-app request card remains visible. */}
}
