export type LocationSource = 'CUSTOMER_GPS' | 'WHATSAPP_LOCATION' | 'MAP_PIN' | 'ADDRESS_SEARCH' | 'MANUAL_TEXT' | 'SAVED_ADDRESS';
export type RequestLocation = { addressText: string; neighborhood?: string; street?: string; latitude: number | null; longitude: number | null; locationSource: LocationSource; notes?: string };
export type SavedAddress = Omit<RequestLocation, 'locationSource'> & { id: string; customerId: string; label: string; icon: 'HOME' | 'WORK' | 'OTHER'; isDefault: boolean; version: number; createdAt?: string; updatedAt?: string };
export type CustomerPlace = { address: SavedAddress; customerName: string; phone: string };
export type ApiCustomer = { id: string; fullName: string; phone: string; secondaryPhone?: string; notes?: string; isActive?: boolean; createdAt?: string };
export function matchesCustomer(text: string, phone: string, search: string) {
  const query = search.trim().toLowerCase();
  const normalized = query.startsWith('05') ? '+970' + query.slice(1) : query;
  return text.toLowerCase().includes(query) || phone.includes(normalized);
}
export function findCustomerByPhone(customers: ApiCustomer[], value: string) {
  const digits=(phone:string)=>phone.replace(/\D/g,'').replace(/^970/,'0');
  const normalized=digits(value); if(normalized.length<9)return undefined;
  return customers.find(customer=>digits(customer.phone)===normalized||digits(customer.secondaryPhone??'')===normalized);
}
export function parseSharedLocation(value: string): Pick<RequestLocation, 'latitude' | 'longitude' | 'locationSource'> {
  let coordinates = value.trim();
  try { const url = new URL(coordinates); coordinates = url.searchParams.get('q') ?? url.searchParams.get('query') ?? url.pathname.match(/@(-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?)/)?.[1] ?? ''; } catch { /* Plain coordinate pairs are also accepted. */ }
  const match = coordinates.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!match || Math.abs(Number(match[1])) > 90 || Math.abs(Number(match[2])) > 180) throw new Error('ألصق خط العرض والطول أو رابطًا يحتوي الإحداثيات؛ الرابط المختصر وحده لا يكفي');
  return { latitude: Number(match[1]), longitude: Number(match[2]), locationSource: 'WHATSAPP_LOCATION' };
}
export function locationFromPlace(place: CustomerPlace) {
  return { customerId: place.address.customerId, savedAddressId: place.address.id, passengerName: place.customerName, passengerPhone: place.phone, addressText: place.address.addressText, neighborhood: place.address.neighborhood, street: place.address.street, latitude: place.address.latitude, longitude: place.address.longitude, locationSource: 'SAVED_ADDRESS' as const, notes: place.address.notes };
}
