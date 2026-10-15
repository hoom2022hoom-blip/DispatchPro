export const streetRideLabel = 'راكب أو طلب من الشارع';
export function isOfficeRideSource(source?:string){return ['MANUAL','OFFICE','BRIDGE','EXTERNAL','WHATSAPP','LANDLINE','LANDLINE_ICALL'].includes(source??'');}
export const rideSourceLabels: Record<string, string> = {
  MANUAL: 'المكتب', OFFICE: 'المكتب', EXTERNAL: 'طلب خارجي', BRIDGE: 'ربط المكتب', CUSTOMER_APP: 'تطبيق الزبون', WHATSAPP: 'واتساب', LANDLINE_ICALL: 'الهاتف الأرضي', LANDLINE: 'الهاتف الأرضي', DRIVER_STREET: streetRideLabel,
};
