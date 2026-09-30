"use client";

import { useState } from 'react';
import type { Ride } from '@/lib/types';
import { applyReceptionEdit, type ReceptionEdit } from '@/lib/reception-editor';
import { statusLabels } from '@/lib/ride-status';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Button } from './ui/button';
import { LocationFields } from './location-fields';
import { locationFromPlace } from '@/lib/customer-places';

export function ReceptionEditForm({ ride, onSave, onCancel, optionalAddress = false }: { optionalAddress?: boolean; ride: Ride; onSave: (ride: Ride) => Promise<void>; onCancel?: () => void }) {
  const [values, setValues] = useState<ReceptionEdit>({ passengerName: ride.passengerName ?? '', address: ride.addressText ?? ride.pickup.name, addressStatus: ride.addressStatus ?? 'default', notes: ride.notes ?? '', status: ride.status });
  const [saving, setSaving] = useState(false);
  const [locationRide, setLocationRide] = useState(ride);
  const [error, setError] = useState('');
  const patchValues = (patch: Partial<ReceptionEdit>) => setValues(current => ({ ...current, ...patch }));
  return <form dir="rtl" className="max-h-[82vh] overflow-y-auto" onSubmit={async event => {
    event.preventDefault(); if (saving) return; setSaving(true); setError('');
    try { await onSave(applyReceptionEdit(locationRide, values, optionalAddress)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'تعذر حفظ الطلب؛ بقيت بياناتك في النافذة'); }
    finally { setSaving(false); }
  }}>
    <p className="mb-3 text-sm text-muted-foreground">طلب رقم {ride.orderNumber ?? '—'} · الهاتف: <bdi>{ride.passengerPhone || '—'}</bdi></p>
    <fieldset disabled={saving} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1"><Label htmlFor="edit-time">الوقت</Label><Input id="edit-time" type="time" value={ride.createdAt instanceof Date ? `${String(ride.createdAt.getHours()).padStart(2,'0')}:${String(ride.createdAt.getMinutes()).padStart(2,'0')}` : ''} disabled /></div>
        <div className="space-y-1"><Label htmlFor="edit-date">التاريخ</Label><Input id="edit-date" type="date" value={ride.createdAt instanceof Date ? `${ride.createdAt.getFullYear()}-${String(ride.createdAt.getMonth()+1).padStart(2,'0')}-${String(ride.createdAt.getDate()).padStart(2,'0')}` : ''} disabled /></div>
        <div className="space-y-1"><Label htmlFor="edit-phone">رقم الزبون</Label><Input id="edit-phone" value={ride.passengerPhone ?? ''} readOnly dir="ltr" /></div>
        <div className="space-y-1"><Label htmlFor="edit-passenger-name">اسم الزبون</Label><Input id="edit-passenger-name" value={values.passengerName} onChange={event => patchValues({ passengerName: event.target.value })} /></div>
        <div className="space-y-1 sm:col-span-2"><Label htmlFor="edit-address">العنوان</Label><Textarea id="edit-address" className="min-h-16 resize-y" value={values.address} onChange={event => { const address = event.target.value; patchValues({ address }); setLocationRide(current => ({ ...current, addressText: address, savedAddressId: null, locationSource: 'MANUAL_TEXT', pickup: { ...current.pickup, name: address } })); }} /></div>
        <div className="space-y-1"><Label htmlFor="edit-driver">السائق</Label><Input id="edit-driver" value={locationRide.driverId ?? 'غير معيّن · غيّره من الجدول'} readOnly /></div>
        <div className="space-y-1"><Label htmlFor="edit-status">الحالة</Label><select id="edit-status" className="h-10 w-full rounded-md border bg-background px-2" value={values.status} onChange={event => patchValues({ status: event.target.value as ReceptionEdit['status'] })}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <div className="space-y-1"><Label htmlFor="edit-address-status">نوع العنوان</Label><select id="edit-address-status" className="h-10 w-full rounded-md border bg-background px-2" value={values.addressStatus} onChange={event => patchValues({ addressStatus: event.target.value as ReceptionEdit['addressStatus'] })}><option value="default">ثابت</option><option value="variable">متغير</option></select></div>
      </div>
      <details className="rounded-md border px-3 py-2">
        <summary className="cursor-pointer select-none font-semibold">تفاصيل إضافية</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="edit-passengers">عدد الركاب</Label><Input id="edit-passengers" type="number" min="1" value={locationRide.passengerCount ?? 1} onChange={event => setLocationRide({ ...locationRide, passengerCount: Number(event.target.value) || 1 })} /></div>
          <div className="space-y-1"><Label htmlFor="edit-destination">الوجهة</Label><Input id="edit-destination" value={locationRide.dropoff?.name ?? ''} onChange={event => setLocationRide({ ...locationRide, dropoff: { ...(locationRide.dropoff ?? { coords: { x: 0, y: 0 } }), name: event.target.value } })} /></div>
          <div className="space-y-1"><Label htmlFor="edit-scheduled">الموعد</Label><Input id="edit-scheduled" type="datetime-local" value={locationRide.scheduledTime instanceof Date ? new Date(locationRide.scheduledTime.getTime()-locationRide.scheduledTime.getTimezoneOffset()*60000).toISOString().slice(0,16) : ''} onChange={event => setLocationRide({ ...locationRide, scheduledTime: event.target.value ? new Date(event.target.value) : undefined })} /></div>
          {ride.rideRequestId && <div className="sm:col-span-2"><LocationFields value={{ addressText: values.address, neighborhood: locationRide.neighborhood, street: locationRide.street, latitude: locationRide.latitude ?? null, longitude: locationRide.longitude ?? null, locationSource: locationRide.locationSource ?? 'MANUAL_TEXT' }} onChange={location => { setLocationRide({ ...locationRide, ...location, savedAddressId: null, pickup: { name: location.addressText, coords: { x: location.latitude ?? 0, y: location.longitude ?? 0 } } }); patchValues({ address: location.addressText }); }} onSelectSaved={place => { setLocationRide({ ...locationRide, ...locationFromPlace(place), pickup: { name: place.address.addressText, coords: { x: place.address.latitude ?? 0, y: place.address.longitude ?? 0 } } }); patchValues({ address: place.address.addressText || 'موقع محفوظ', passengerName: place.customerName, notes: place.address.notes ?? '' }); }} /></div>}
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="edit-notes">الملاحظات الإضافية</Label><Textarea id="edit-notes" value={values.notes} onChange={event => patchValues({ notes: event.target.value })} /></div>
        </div>
      </details>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-3">
        <Button type="submit" className="flex-1">{saving ? 'جارٍ الحفظ…' : 'حفظ تعديل الطلب'}</Button>
        {onCancel && <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>إلغاء</Button>}
      </div>
    </fieldset>
  </form>;
}
