// Google is loaded only after the employee selects it. No tiles or REST secrets.
export type GoogleMapType = 'roadmap' | 'satellite' | 'hybrid';
export const googleMapsKey = () => process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() || '';
// SDK libraries have independently loaded constructors; keep the boundary here.
export type GoogleMapsSDK = Record<string, any>;
let pending: Promise<GoogleMapsSDK> | undefined;
const failures = new Set<() => void>();
export function onGoogleAuthFailure(listener: () => void) { failures.add(listener); return () => { failures.delete(listener); }; }
export function loadGoogleMaps(): Promise<GoogleMapsSDK> {
  if (!googleMapsKey()) return Promise.reject(Error('Google Maps غير مفعلة؛ ستستمر OpenFreeMap.'));
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    const host = window as unknown as {google?: {maps: GoogleMapsSDK}; gm_authFailure?: () => void; dispatchProGoogleReady?: () => void};
    const prior = host.gm_authFailure;
    host.gm_authFailure = () => { prior?.(); failures.forEach(fn => fn()); fail(); };
    const script = document.createElement('script');
    const timer = setTimeout(() => fail(), 15000);
    function fail() { clearTimeout(timer); script.remove(); pending = undefined; reject(Error('تعذر تحميل Google Maps؛ ستستمر OpenFreeMap.')); }
    host.dispatchProGoogleReady = () => { clearTimeout(timer); if (host.google?.maps) resolve(host.google.maps); else fail(); delete host.dispatchProGoogleReady; };
    script.src = 'https://maps.googleapis.com/maps/api/js?' + new URLSearchParams({key: googleMapsKey(), v: 'weekly', loading: 'async', language: 'ar', callback: 'dispatchProGoogleReady'});
    script.async = true; script.onerror = fail; document.head.append(script);
  });
  return pending;
}
export const googlePosition = (point: {latitude:number;longitude:number}) => ({lat:point.latitude,lng:point.longitude});
