"use client";
import { useEffect, useRef, useState } from 'react';
import Map, { Marker, Popup, NavigationControl, type MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { apiReceptionBackend } from '@/lib/reception-api';
import type { ApiCustomer, CustomerPlace, SavedAddress, RequestLocation } from '@/lib/customer-places';
import { matchesCustomer } from '@/lib/customer-places';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ResponsiveDialog } from './responsive-dialog';

const icons = { HOME: '🏠', WORK: '🏢', OTHER: '📍' };
const blank = (): Omit<SavedAddress, 'id'> & { id?: string } => ({ customerId: '', label: 'HOME', icon: 'HOME', addressText: '', neighborhood: '', street: '', latitude: null, longitude: null, notes: '', isDefault: false, version: 0 });
const style = { version: 8 as const, sources: { osm: { type: 'raster' as const, tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' } }, layers: [{ id: 'osm', type: 'raster' as const, source: 'osm' }] };

export function CustomerPlacesMap({ onRequest, onLocation, customerId, initialSearch='' }: { onRequest: (place: CustomerPlace) => void; onLocation?: (location: RequestLocation) => void; customerId?: string; initialSearch?: string }) {
  const map = useRef<MapRef>(null);
  const [places, setPlaces] = useState<CustomerPlace[]>([]), [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [query, setQuery] = useState(initialSearch), [customerQuery, setCustomerQuery] = useState('');
  const [selected, setSelected] = useState<CustomerPlace | null>(null);
  const [draft, setDraft] = useState<ReturnType<typeof blank> | null>(null);
  const [name, setName] = useState(''), [phone, setPhone] = useState(''), [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function reload() { setPlaces(await apiReceptionBackend.places('',customerId)); setCustomers(await apiReceptionBackend.customers()); }
  useEffect(() => { void reload().catch(e => setError(e.message)); }, [customerId]);
  const matches = places.filter(p => matchesCustomer(`${p.customerName} ${p.address.addressText} ${p.address.neighborhood} ${p.address.street}`, p.phone, query));
  function focus(place: CustomerPlace) { setSelected(place); if (place.address.latitude != null && place.address.longitude != null) map.current?.flyTo({ center: [place.address.longitude, place.address.latitude], zoom: 16 }); }
  function edit(place: CustomerPlace) { setDraft({ ...place.address }); setName(place.customerName); setPhone(place.phone); setError(''); }
  async function save(asNew: boolean) {
    if (!draft || busy) return; setBusy(true); setError('');
    try {
      let customerId = draft.customerId;
      if (!customerId) { const customer = await apiReceptionBackend.createCustomer(name, phone); customerId = customer.id; setDraft({ ...draft, customerId }); }
      await apiReceptionBackend.savePlace({ ...draft, customerId, ...(asNew ? { id: undefined, version: 0 } : {}) });
      await reload(); setDraft(null); setSelected(null);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section dir="rtl" className="shrink-0 space-y-2 border-b bg-card p-3" aria-label="أماكن الزبائن المحفوظة">
    <div className="flex flex-wrap gap-2"><strong>أماكن الزبائن المحفوظة</strong><Input className="max-w-md" aria-label="بحث خريطة الزبائن" placeholder="اسم الزبون أو الهاتف أو الحي أو الشارع" value={query} onChange={e => setQuery(e.target.value)} /><Button variant="outline" onClick={() => { const c=customers.find(x=>x.id===customerId);setDraft({ ...blank(),customerId:customerId??'' }); setName(c?.fullName??''); setPhone(c?.phone??''); }}>عنوان يدوي دون GPS</Button></div>
    {query && <div className="max-h-28 overflow-auto">{matches.map(place => <Button key={place.address.id} variant="ghost" onClick={() => focus(place)}>{place.customerName} — {place.phone} — {place.address.label}</Button>)}</div>}
    <p className="text-sm">انقر الخريطة لإضافة نقطة، أو حرّك علامة محفوظة لتعديل موقعها.</p>
    <div className="h-80 overflow-hidden rounded border"><Map ref={map} initialViewState={{ longitude: Number(process.env.NEXT_PUBLIC_MAP_LONGITUDE ?? 35.2544), latitude: Number(process.env.NEXT_PUBLIC_MAP_LATITUDE ?? 32.2211), zoom: 12 }} mapStyle={style} onClick={event => { if ((event.originalEvent.target as HTMLElement)?.closest?.('.maplibregl-popup, .maplibregl-marker, .maplibregl-control-container')) return; setSelected(null); const c=customers.find(x=>x.id===customerId);setDraft({ ...blank(),customerId:customerId??'',latitude: event.lngLat.lat, longitude: event.lngLat.lng }); setName(c?.fullName??''); setPhone(c?.phone??''); }}>
      <NavigationControl />
      {matches.filter(p => p.address.latitude != null && p.address.longitude != null).map(place => <Marker key={place.address.id} longitude={place.address.longitude!} latitude={place.address.latitude!} draggable onDragEnd={event => { edit(place); setDraft({ ...place.address, latitude: event.lngLat.lat, longitude: event.lngLat.lng }); }}><button type="button" aria-label={`${place.customerName} ${place.address.label}`} className="rounded-full bg-white p-2 text-2xl shadow" onClick={event => { event.stopPropagation(); setSelected(place); }}>{icons[place.address.icon]}</button></Marker>)}
      {draft?.latitude != null && draft.longitude != null && <Marker longitude={draft.longitude} latitude={draft.latitude}><span className="text-3xl">{icons[draft.icon]}</span></Marker>}
      {selected?.address.latitude != null && selected.address.longitude != null && <Popup longitude={selected.address.longitude} latitude={selected.address.latitude} closeOnClick={false} onClose={() => setSelected(null)}><div dir="rtl" className="space-y-2 text-black"><strong>{selected.customerName}</strong><p><bdi>{selected.phone}</bdi></p><p>{selected.address.label} — {selected.address.addressText}</p><p>{selected.address.notes}</p><div className="flex flex-wrap gap-1"><Button size="sm" onClick={() => onRequest(selected)}>إنشاء طلب</Button><Button size="sm" variant="outline" onClick={() => edit(selected)}>تعديل</Button><Button size="sm" variant="outline" disabled={busy} onClick={async () => { if (!window.confirm('حذف هذا العنوان المحفوظ؟')) return; setBusy(true); try { await apiReceptionBackend.deletePlace(selected.address); setSelected(null); await reload(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>حذف</Button></div></div></Popup>}
    </Map></div>
    {selected && selected.address.latitude == null && <div>{selected.customerName} — {selected.address.addressText} <Button onClick={() => onRequest(selected)}>إنشاء طلب</Button><Button variant="outline" onClick={() => edit(selected)}>تعديل / إضافة موقع</Button><Button variant="outline" disabled={busy} onClick={async () => { if (!window.confirm('حذف هذا العنوان المحفوظ؟')) return; setBusy(true); try { await apiReceptionBackend.deletePlace(selected.address); setSelected(null); await reload(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>حذف</Button></div>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <ResponsiveDialog open={!!draft} onOpenChange={open => { if (!open && !busy) setDraft(null); }} title="حفظ هذا الموقع للزبون">
      {draft && <form dir="rtl" className="max-h-[75vh] space-y-3 overflow-auto" onSubmit={e => { e.preventDefault(); void save(false); }}><fieldset disabled={busy} className="space-y-3">
        <Input aria-label="بحث الزبون" placeholder="ابحث باسم الزبون أو الهاتف" value={customerQuery} onChange={e => setCustomerQuery(e.target.value)} />
        <select aria-label="الزبون المرتبط" className="w-full rounded border p-2" value={draft.customerId} disabled={!!draft.id} onChange={e => { const customer = customers.find(c => c.id === e.target.value); setDraft({ ...draft, customerId: customer?.id ?? '' }); setName(customer?.fullName ?? ''); setPhone(customer?.phone ?? ''); }}><option value="">زبون جديد</option>{customers.filter(c => c.id === draft.customerId || matchesCustomer(c.fullName, c.phone, customerQuery)).map(c => <option key={c.id} value={c.id}>{c.fullName} — {c.phone}</option>)}</select>
        <Input aria-label="اسم الزبون" placeholder="اسم الزبون" required value={name} disabled={!!draft.customerId} onChange={e => setName(e.target.value)} /><Input aria-label="هاتف الزبون" placeholder="05XXXXXXXX أو +9705XXXXXXXX" required value={phone} disabled={!!draft.customerId} onChange={e => setPhone(e.target.value)} />
        <Input aria-label="اسم العنوان" list="place-labels" placeholder="HOME / WORK / FAMILY / OTHER أو اسم مخصص" required value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} /><datalist id="place-labels">{['HOME','WORK','FAMILY','OTHER'].map(label => <option key={label} value={label} />)}</datalist>
        <select aria-label="أيقونة المكان" value={draft.icon} onChange={e => setDraft({ ...draft, icon: e.target.value as SavedAddress['icon'] })}>{Object.entries(icons).map(([key, icon]) => <option key={key} value={key}>{icon} {key}</option>)}</select>
        <Input aria-label="عنوان المكان" placeholder="نص العنوان" value={draft.addressText} onChange={e => setDraft({ ...draft, addressText: e.target.value })} /><Input aria-label="حي المكان" placeholder="الحي" value={draft.neighborhood ?? ''} onChange={e => setDraft({ ...draft, neighborhood: e.target.value })} /><Input aria-label="شارع المكان" placeholder="الشارع" value={draft.street ?? ''} onChange={e => setDraft({ ...draft, street: e.target.value })} />
        <div className="grid grid-cols-2 gap-2"><Input aria-label="عرض المكان" type="number" step="any" placeholder="Latitude (اختياري)" value={draft.latitude ?? ''} onChange={e => setDraft({ ...draft, latitude: e.target.value === '' ? null : Number(e.target.value) })} /><Input aria-label="طول المكان" type="number" step="any" placeholder="Longitude (اختياري)" value={draft.longitude ?? ''} onChange={e => setDraft({ ...draft, longitude: e.target.value === '' ? null : Number(e.target.value) })} /></div>
        <Input aria-label="ملاحظات المكان" placeholder="الوصف والملاحظات" value={draft.notes ?? ''} onChange={e => setDraft({ ...draft, notes: e.target.value })} /><label className="flex gap-2"><input type="checkbox" checked={draft.isDefault} onChange={e => setDraft({ ...draft, isDefault: e.target.checked })} />العنوان الافتراضي</label>
        <div className="flex flex-wrap gap-2"><Button type="submit">{draft.id ? 'تحديث العنوان الحالي' : 'حفظ هذا الموقع للزبون'}</Button><Button type="button" variant="outline" onClick={() => void save(true)}>حفظ كعنوان جديد</Button></div>
        {onLocation && <Button type="button" variant="outline" onClick={() => { onLocation({ addressText: draft.addressText, neighborhood: draft.neighborhood, street: draft.street, latitude: draft.latitude, longitude: draft.longitude, locationSource: draft.latitude == null ? 'MANUAL_TEXT' : 'MAP_PIN', notes: draft.notes }); setDraft(null); }}>استخدام الموقع في طلب دون حفظ عنوان</Button>}
        {error && <p role="alert">{error}</p>}
      </fieldset></form>}
    </ResponsiveDialog>
  </section>;
}
