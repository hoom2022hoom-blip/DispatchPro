import { parseCallEvent, type CallEvent } from './call-events';
import type { Location, Ride } from './types';

export type ReceptionCustomer = {
  id: string;
  name?: string;
  displayName?: string;
  phoneNumber?: string;
  phone?: string;
  defaultAddress?: string | Location;
};

export function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, '').replace(/^00/, '');
  return /^(970|972)\d{8,9}$/.test(digits) ? `0${digits.slice(3)}` : digits;
}

export function findCallCustomer(customers: ReceptionCustomer[], phone: string) {
  const normalized = normalizePhone(phone);
  return customers.find(customer => normalizePhone(customer.phoneNumber ?? customer.phone ?? '') === normalized);
}

export async function callRideId(eventId: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(eventId));
  return `call-${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function callReceptionRide(input: CallEvent, customer?: ReceptionCustomer): Promise<Ride | null> {
  const event = parseCallEvent(input);
  if (!['WHATSAPP', 'LANDLINE_ICALL'].includes(event.source)) return null;
  const address = customer?.defaultAddress;
  return {
    id: await callRideId(event.eventId), callEventId: event.eventId,
    callTimestamp: event.timestamp, receptionPending: true, source: event.source,
    passengerPhone: event.phone, passengerName: customer?.name ?? customer?.displayName ?? '',
    // Zero coordinates mean unknown; no invented customer location.
    pickup: typeof address === 'object' ? address : { name: address ?? '', coords: { x: 0, y: 0 } },
    totalFare: 0, movingFee: false, status: 'pending', driverId: null, shiftId: null,
    createdAt: new Date(), updatedAt: new Date(),
  };
}
