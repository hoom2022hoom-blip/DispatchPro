"use client";

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import type { Driver, Ride } from '@/lib/types';
import { statusLabels } from "@/lib/ride-status";
import { sourceLabels } from '@/lib/call-events';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { businessDay } from '@/lib/ride-numbering';
import { StrictModeDroppable } from './strict-mode-droppable';
import { ShiftPicker, type ShiftChoice } from './shift-picker';

export function ReceptionTable({ rides, drivers, onEdit, choices, onAssign }: { rides: Ride[]; drivers: Driver[]; onEdit: (ride: Ride) => void; choices: ShiftChoice[]; onAssign: (rideId: string, shiftId: string) => Promise<void> }) {
  const [day, setDay] = useState(() => businessDay());
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const rows = useMemo(() => rides.filter(ride => ride.receptionPending || (ride.createdAt && (ride.orderDay ?? businessDay(ride.createdAt)) === day &&
    (status === 'all' || ride.status === status) && [String(ride.orderNumber ?? ''), ride.passengerName, ride.passengerPhone, ride.pickup.name, drivers.find(driver => driver.id === ride.driverId)?.name].some(value => value?.includes(search.trim()))))
    .sort((a, b) => Number(!!b.receptionPending) - Number(!!a.receptionPending) || (a.orderNumber ?? Infinity) - (b.orderNumber ?? Infinity) || a.id.localeCompare(b.id)), [rides, day, search, status, drivers]);

  return <section className="flex min-h-[320px] min-w-0 flex-1 flex-col p-3 lg:min-h-0" aria-label="قائمة الطلبات">
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <h2 className="font-bold">طلبات المكتب</h2>
      <span className="text-xs text-muted-foreground">المكالمات غير المكتملة تظهر دائمًا أعلى القائمة</span>
      <Input aria-label="تاريخ الطلبات" type="date" value={day} onChange={event => setDay(event.target.value)} className="w-44" />
      <Input aria-label="بحث الطلبات" placeholder="بحث بالاسم أو الهاتف أو العنوان" value={search} onChange={event => setSearch(event.target.value)} className="max-w-sm" />
      <select aria-label="تصفية الحالة" className="h-10 rounded border bg-background px-2" value={status} onChange={event => setStatus(event.target.value)}><option value="all">كل الحالات</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <span className="text-sm text-muted-foreground">{rows.length} طلب — انقر مرتين للتعديل</span>
    </div>
    <div className="min-h-0 overflow-auto rounded-lg border bg-card">
      <table className="w-full min-w-[800px] text-right text-sm">
        <thead className="sticky top-0 bg-muted"><tr>{['رقم الطلب', 'الوقت', 'اسم الزبون', 'الهاتف', 'العنوان', 'السائق', 'الحالة'].map(title => <th key={title} scope="col" className="p-3">{title}</th>)}</tr></thead>
        <tbody>{rows.map(ride => <tr key={ride.id} onDoubleClick={() => onEdit(ride)} className="border-t hover:bg-muted/50">
          <td className="p-3 font-semibold">{ride.orderNumber ?? 'جارٍ الترقيم'}</td><td className="p-3">{ride.createdAt ? format(ride.createdAt, 'HH:mm') : '—'}</td>
          <td className="p-3">{ride.passengerName || '—'}</td><td className="p-3"><bdi>{ride.passengerPhone || '—'}</bdi><div className="mt-1 text-xs text-muted-foreground">{sourceLabels[ride.source ?? 'MANUAL']}</div></td>
          <td className="p-3">{ride.pickup.name || 'لم يُحدد العنوان'}<div className="mt-1 text-xs text-muted-foreground">{ride.addressStatus === 'variable' ? 'متغير' : 'افتراضي'}</div></td><td className="p-3" onDoubleClick={event => event.stopPropagation()}>
            <StrictModeDroppable droppableId={`ride:${ride.id}`} type="QUEUE_DRIVER" isDropDisabled={ride.receptionPending || !['pending', 'waiting', 'assigned'].includes(ride.status)}>
              {(provided, snapshot) => <div ref={provided.innerRef} {...provided.droppableProps} className={snapshot.isDraggingOver ? 'rounded bg-yellow-100 p-2' : ''}>
                <ShiftPicker value={ride.shiftId ?? ''} selectedLabel={drivers.find(driver => driver.id === ride.driverId)?.name} choices={choices} disabled={ride.receptionPending || !['pending', 'waiting', 'assigned'].includes(ride.status)} onChange={shiftId => onAssign(ride.id, shiftId)} />{provided.placeholder}
                {ride.receptionPending && <span className="text-xs text-muted-foreground">أكمل العنوان أولًا</span>}
              </div>}
            </StrictModeDroppable>
          </td>
          <td className="p-3">{ride.receptionPending ? 'مكالمة جديدة — أكمل البيانات' : statusLabels[ride.status]}<Button className="mr-2" variant="ghost" size="sm" onDoubleClick={event => event.stopPropagation()} onClick={() => onEdit(ride)}>تعديل</Button></td>
        </tr>)}</tbody>
      </table>
      {!rows.length && <p className="p-8 text-center text-muted-foreground">لا توجد طلبات مطابقة</p>}
    </div>
  </section>;
}
