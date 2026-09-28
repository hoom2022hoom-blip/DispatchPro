"use client";
import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Button } from './ui/button';
import { Input } from './ui/input';

export type ShiftChoice = { id: string; driverId: string; label: string; disabled?: boolean; searchText?: string; queuePosition?: number };

export function ShiftPicker({ value, onChange, choices, disabled = false, selectedLabel, changeLabel, fontSize }: {
  value: string; onChange: (value: string) => void | Promise<void>; choices: ShiftChoice[]; disabled?: boolean; selectedLabel?: string; changeLabel?: string; fontSize?: number;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function choose(id: string) {
    if (pending) return;
    setPending(true); setError('');
    try { await onChange(id); setOpen(false); setSearch(''); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'تعذر تعيين السائق'); }
    finally { setPending(false); }
  }
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button type="button" variant="outline" disabled={disabled || pending} style={fontSize?{fontSize}:undefined} title={choices.find(choice=>choice.id===value)?.label??selectedLabel} className="w-full justify-start text-right" aria-label="اختيار السائق">{choices.find(choice => choice.id === value)?.label ?? selectedLabel ?? (value ? 'التعيين الحالي' : 'اختر السائق')}{changeLabel&&<span className="mr-2 font-semibold text-primary">{changeLabel}</span>}</Button></PopoverTrigger>
    <PopoverContent dir="rtl" className="w-80 space-y-2" onDoubleClick={event => event.stopPropagation()}>
      <Input aria-label="بحث السائق والسيارة" placeholder="ابحث بالاسم أو الهاتف أو اللوحة" value={search} onChange={event => setSearch(event.target.value)} />
      <div className="max-h-64 overflow-y-auto">
        <Button type="button" variant="ghost" disabled={pending} onClick={() => void choose('')}>غير معيّن</Button>
        {choices.filter(choice => `${choice.label} ${choice.searchText??''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map(choice => <Button type="button" variant="ghost" key={choice.id} disabled={pending || (choice.disabled && choice.id !== value)} style={fontSize?{fontSize}:undefined} title={choice.label} className="h-auto w-full justify-start whitespace-normal py-2 text-right" onClick={() => void choose(choice.id)}>
          {choice.queuePosition ? `${choice.queuePosition}. ` : ''}{choice.label}{choice.disabled ? ' — مشغول' : ''}
        </Button>)}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </PopoverContent>
  </Popover>;
}
