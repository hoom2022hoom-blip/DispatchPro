"use client";
import { useState } from 'react';
import type { CustomerPlace, RequestLocation, LocationSource } from '@/lib/customer-places';
import { parseSharedLocation } from '@/lib/customer-places';
import { apiReceptionBackend } from '@/lib/reception-api';
import { Input } from './ui/input';
import { Button } from './ui/button';

export function LocationFields({ value, onChange, onSelectSaved, compact = false }: { value: RequestLocation; onChange: (value: RequestLocation) => void; onSelectSaved?: (place: CustomerPlace) => void; compact?: boolean }) {
  const [search, setSearch] = useState(''), [places, setPlaces] = useState<CustomerPlace[]>([]), [error, setError] = useState('');
  const [shared, setShared] = useState('');
  const patch = (change: Partial<RequestLocation>) => onChange({ ...value, ...change });
  const fields=<>
    {!compact && <Input aria-label="نص العنوان" placeholder="العنوان، أو موقع تقريبي" value={value.addressText} onChange={e => patch({ addressText: e.target.value, locationSource: 'MANUAL_TEXT' })} />}
    <div className="grid grid-cols-2 gap-2"><Input aria-label="الحي" placeholder="الحي" value={value.neighborhood ?? ''} onChange={e => patch({ neighborhood: e.target.value })} /><Input aria-label="الشارع" placeholder="الشارع" value={value.street ?? ''} onChange={e => patch({ street: e.target.value })} /></div>
    <select aria-label="مصدر الموقع" className="w-full rounded border p-2" value={value.locationSource} onChange={e => patch({ locationSource: e.target.value as LocationSource })}>
      {Object.entries({ MANUAL_TEXT: 'عنوان يدوي', CUSTOMER_GPS: 'GPS الزبون', WHATSAPP_LOCATION: 'موقع واتساب', MAP_PIN: 'نقطة خريطة', ADDRESS_SEARCH: 'بحث عنوان', SAVED_ADDRESS: 'عنوان محفوظ' }).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select>
    <div className="grid grid-cols-2 gap-2"><Input aria-label="خط العرض" type="number" step="any" min={-90} max={90} placeholder="Latitude (اختياري)" value={value.latitude ?? ''} onChange={e => patch({ latitude: e.target.value === '' ? null : Number(e.target.value) })} /><Input aria-label="خط الطول" type="number" step="any" min={-180} max={180} placeholder="Longitude (اختياري)" value={value.longitude ?? ''} onChange={e => patch({ longitude: e.target.value === '' ? null : Number(e.target.value) })} /></div>
    <div className="flex gap-2"><Input aria-label="موقع واتساب" placeholder="موقع واتساب: latitude,longitude أو رابط يحتويهما" value={shared} onChange={e => setShared(e.target.value)} /><Button type="button" variant="outline" onClick={() => { try { patch(parseSharedLocation(shared)); setError(''); } catch (e) { setError((e as Error).message); } }}>استخدام الموقع</Button></div>
    <Button type="button" variant="outline" onClick={() => { if (!navigator.geolocation) { setError('تحديد الموقع غير متاح؛ يمكنك كتابة العنوان'); return; } navigator.geolocation.getCurrentPosition(position => patch({ latitude: position.coords.latitude, longitude: position.coords.longitude, locationSource: 'CUSTOMER_GPS' }), () => setError('لم يتوفر GPS؛ اكتب العنوان أو اختره من الخريطة'), { timeout: 10000 }); }}>استخدام موقع هذا الجهاز</Button>
    {onSelectSaved && !compact && <><div className="flex gap-2"><Input aria-label="بحث عنوان محفوظ" placeholder="اسم الزبون / الهاتف / الحي / الشارع" value={search} onChange={e => setSearch(e.target.value)} /><Button type="button" variant="outline" onClick={async () => { try { setPlaces(await apiReceptionBackend.places(search)); setError(''); } catch (e) { setError((e as Error).message); } }}>بحث</Button></div>
      {places.map(place => <Button key={place.address.id} type="button" variant="ghost" className="block h-auto whitespace-normal text-right" onClick={() => { onSelectSaved(place); setPlaces([]); }}>{place.customerName} — {place.address.label} — {place.address.addressText || place.address.neighborhood}</Button>)}</>}
    {error && <p role="alert">{error}</p>}
  </>;
  if(compact) return <div className="space-y-2" dir="rtl"><div className="flex gap-2"><Input aria-label="بحث عنوان محفوظ" placeholder="بحث عنوان محفوظ: الاسم أو الهاتف أو الحي أو الشارع" value={search} onChange={e=>setSearch(e.target.value)} /><Button type="button" variant="outline" onClick={async()=>{try{setPlaces(await apiReceptionBackend.places(search));setError('');}catch(e){setError((e as Error).message);}}}>بحث</Button></div>{places.map(place=><Button key={place.address.id} type="button" variant="ghost" className="block h-auto whitespace-normal text-right" onClick={()=>{onSelectSaved?.(place);setPlaces([]);}}>{place.customerName} — {place.address.label} — {place.address.addressText||place.address.neighborhood}</Button>)}<details className="rounded border p-2"><summary className="cursor-pointer font-medium">معلومات الموقع وGPS</summary><div className="mt-2 space-y-2">{fields}</div></details></div>;
  return <fieldset className="my-3 space-y-2 rounded border p-3" dir="rtl"><legend>الموقع — GPS اختياري</legend>{fields}</fieldset>;
}
