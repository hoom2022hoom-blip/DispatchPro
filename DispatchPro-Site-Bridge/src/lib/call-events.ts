export type CallSource = 'WHATSAPP' | 'LANDLINE_ICALL' | 'MANUAL' | 'CUSTOMER_APP';
export type CallEvent = { eventId: string; source: CallSource; phone: string; timestamp: string; line?: string; location?: import('./customer-places').RequestLocation };

export const sourceLabels: Record<CallSource, string> = {
  WHATSAPP: 'W واتساب', LANDLINE_ICALL: 'LANDLINE_ICALL أرضي', MANUAL: 'يدوي', CUSTOMER_APP: 'تطبيق الزبون',
};

export function parseCallEvent(input: unknown): CallEvent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('حدث غير صالح');
  const data = input as Record<string, unknown>;
  if (typeof data.eventId !== 'string' || !data.eventId.trim() || data.eventId.length > 160 ||
      typeof data.source !== 'string' || !Object.hasOwn(sourceLabels, data.source) ||
      typeof data.phone !== 'string' || !/^[+\d][\d ()-]{0,39}$/.test(data.phone.trim()) ||
      typeof data.timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(data.timestamp) || !Number.isFinite(Date.parse(data.timestamp)) ||
      (data.line !== undefined && (typeof data.line !== 'string' || data.line.length > 80))) throw new Error('حقول المكالمة غير صالحة');
  let location: CallEvent['location'];
  if (data.location !== undefined) {
    const value = data.location as NonNullable<CallEvent['location']>;
    if (!value || typeof value.addressText !== 'string' || value.addressText.length > 500 || !['CUSTOMER_GPS','WHATSAPP_LOCATION','MAP_PIN','ADDRESS_SEARCH','MANUAL_TEXT','SAVED_ADDRESS'].includes(value.locationSource) || (value.latitude != null) !== (value.longitude != null) || (value.latitude != null && (typeof value.latitude !== 'number' || !Number.isFinite(value.latitude) || Math.abs(value.latitude) > 90 || typeof value.longitude !== 'number' || !Number.isFinite(value.longitude) || Math.abs(value.longitude) > 180))) throw new Error('موقع غير صالح');
    for (const key of ['neighborhood','street','notes'] as const) if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key]!.length > (key === 'notes' ? 4000 : 150))) throw new Error('موقع غير صالح');
    location = { addressText: value.addressText, latitude: value.latitude ?? null, longitude: value.longitude ?? null, locationSource: value.locationSource, ...(value.neighborhood !== undefined ? { neighborhood: value.neighborhood } : {}), ...(value.street !== undefined ? { street: value.street } : {}), ...(value.notes !== undefined ? { notes: value.notes } : {}) };
  }
  return { eventId: data.eventId.trim(), source: data.source as CallSource, phone: data.phone.trim(), timestamp: new Date(data.timestamp).toISOString(), ...(data.line !== undefined ? { line: data.line as string } : {}), ...(location ? { location } : {}) };
}

// Adapters publish normalized events here; phone numbers are never deduplication keys.
export function createCallInbox(onCall: (event: CallEvent) => void) {
  const seen = new Set<string>();
  return (input: unknown) => {
    let event: CallEvent;
    try { event = parseCallEvent(input); } catch { return false; }
    if (seen.has(event.eventId)) return false;
    seen.add(event.eventId);
    onCall({ ...event, phone: event.phone.trim() });
    return true;
  };
}
