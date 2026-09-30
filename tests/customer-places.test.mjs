import test from 'node:test';
import assert from 'node:assert/strict';
import { locationFromPlace, parseSharedLocation, matchesCustomer } from '../src/lib/customer-places.ts';
import { parseCallEvent } from '../src/lib/call-events.ts';

test('saved manual and map addresses become independent request snapshots without requiring GPS', () => {
  const place = { customerName: 'زبون', phone: '+970591234500', address: { id: 'home', customerId: 'customer', label: 'HOME', addressText: 'عنوان يدوي', latitude: null, longitude: null, notes: 'الطابق الثاني' } };
  const request = locationFromPlace(place);
  assert.equal(request.savedAddressId, 'home'); assert.equal(request.locationSource, 'SAVED_ADDRESS'); assert.equal(request.latitude, null);
  const pin = locationFromPlace({ ...place, address: { ...place.address, id: 'work', latitude: 32.22, longitude: 35.25 } });
  assert.equal(pin.savedAddressId, 'work'); assert.equal(pin.latitude, 32.22);
  place.address.addressText = 'تعديل لاحق'; assert.equal(request.addressText, 'عنوان يدوي');
  assert.ok(matchesCustomer('زبون شارع القدس', '+970591234500', '0591234500'));
  assert.ok(matchesCustomer('زبون شارع القدس', '+970591234500', 'القدس'));
});
test('WhatsApp coordinate links and call location payloads preserve optional location data', () => {
  const location = { ...parseSharedLocation('https://maps.google.com/?q=32.22,35.25'), addressText: 'موقع مرسل', neighborhood: 'حي الجامعة' };
  assert.equal(location.locationSource, 'WHATSAPP_LOCATION');
  const event = parseCallEvent({ eventId: 'location-event', source: 'WHATSAPP', phone: '0591234500', timestamp: '2026-09-27T12:00:00Z', location });
  assert.deepEqual(event.location, location);
  assert.throws(() => parseSharedLocation('https://maps.app.goo.gl/short'), /إحداثيات/);
  assert.throws(() => parseSharedLocation('100,35'));
  assert.throws(() => parseCallEvent({ ...event, location: { ...location, longitude: null } }));
});
