"use client";
import {receptionTime} from '@/lib/reception-display';
import { useState } from 'react';
import { Draggable } from '@hello-pangea/dnd';
import { StrictModeDroppable } from './strict-mode-droppable';
import { Button } from './ui/button';
import { Input } from './ui/input';
import type { QueueAction, QueueEntry } from '@/lib/driver-queue';
import type { ShiftChoice } from './shift-picker';

export function DriverQueuePanel({ entries, choices, onChange, onCreateLocalShift }: {
  entries: QueueEntry[]; choices: ShiftChoice[]; onChange: (action: QueueAction) => Promise<void>;
  onCreateLocalShift?: (name: string, car: string) => Promise<void>;
}) {
  const [search, setSearch] = useState(''), [selected, setSelected] = useState('');
  const [name, setName] = useState(''), [car, setCar] = useState('');
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  async function run(action: () => Promise<void>) {
    if (pending) return;
    setPending(true); setError('');
    try { await action(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'تعذر تعديل الدور'); } finally { setPending(false); }
  }
  return <aside aria-label="دور السائقين" className="max-h-[45vh] w-full shrink-0 overflow-y-auto rounded-lg border bg-card p-3 lg:max-h-none lg:w-80">
    <h2 className="mb-2 text-lg font-bold">الدور ({entries.length})</h2>
    <p className="mb-3 text-xs text-muted-foreground">اسحب السائق إلى خانة السائق في الطلب، أو اختره بالبحث.</p>
    <Input aria-label="بحث الدور" placeholder="بحث بالاسم أو السيارة" value={search} onChange={event => setSearch(event.target.value)} />
    <div className="my-3 flex gap-2">
      <select aria-label="إضافة للدور" value={selected} onChange={event => setSelected(event.target.value)} className="min-w-0 flex-1 rounded border bg-background p-2">
        <option value="">اختر وردية متاحة</option>
        {choices.filter(choice => !choice.disabled && !entries.some(entry => entry.shiftId === choice.id) && choice.label.includes(search.trim())).map(choice => <option value={choice.id} key={choice.id}>{choice.label}</option>)}
      </select>
      <Button disabled={!selected || pending} onClick={() => void run(async () => { await onChange({ type: 'add', shiftId: selected }); setSelected(''); })}>إضافة</Button>
    </div>
    <StrictModeDroppable droppableId="driver-queue" type="QUEUE_DRIVER" isDropDisabled={!!search || pending}>
      {provided => <div ref={provided.innerRef} {...provided.droppableProps} className="min-h-12 space-y-2">
        {entries.map((entry, index) => ({ entry, index, choice: choices.find(choice => choice.id === entry.shiftId) }))
          .filter(({ choice }) => !search || choice?.label.includes(search.trim()))
          .map(({ entry, index, choice }) => <Draggable key={entry.shiftId} draggableId={`queue:${entry.shiftId}`} index={index} isDragDisabled={pending || !!search || !choice || choice.disabled}>
            {drag => <div ref={drag.innerRef} {...drag.draggableProps} className="rounded-md border bg-background p-2">
              <div {...drag.dragHandleProps} className="font-medium">{index + 1}. {choice?.label ?? 'وردية منتهية'}</div>
              <div className="my-1 text-xs text-muted-foreground">دخول: {receptionTime(entry.joinedAt)} · {!choice ? 'غير متاح' : choice.disabled ? 'مشغول' : 'متاح'}</div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" disabled={pending || index === 0} aria-label={`تقديم ${choice?.label ?? ''}`} onClick={() => void run(() => onChange({ type: 'up', shiftId: entry.shiftId }))}>↑</Button>
                <Button size="sm" variant="outline" disabled={pending || index === entries.length - 1} aria-label={`تأخير ${choice?.label ?? ''}`} onClick={() => void run(() => onChange({ type: 'down', shiftId: entry.shiftId }))}>↓</Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => void run(() => onChange({ type: 'remove', shiftId: entry.shiftId }))}>إخراج من الدور</Button>
              </div>
            </div>}
          </Draggable>)}
        {provided.placeholder}
        {!entries.length && <p className="p-3 text-sm text-muted-foreground">لا يوجد سائقون في الدور</p>}
      </div>}
    </StrictModeDroppable>
    {onCreateLocalShift && <details className="mt-4 border-t pt-3"><summary className="cursor-pointer text-sm">إضافة سائق وسيارة محليًا</summary>
      <form className="mt-2 space-y-2" onSubmit={event => { event.preventDefault(); void run(async () => { await onCreateLocalShift(name, car); setName(''); setCar(''); }); }}>
        <Input aria-label="اسم السائق المحلي" placeholder="اسم السائق" required maxLength={100} value={name} onChange={event => setName(event.target.value)} />
        <Input aria-label="السيارة المحلية" placeholder="السيارة / رقم اللوحة" required maxLength={100} value={car} onChange={event => setCar(event.target.value)} />
        <Button disabled={pending} type="submit">حفظ وإدخال للدور</Button>
      </form>
    </details>}
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
  </aside>;
}
