"use client";
import { useId, useRef, useState } from 'react';
import {nextControl} from '@/lib/reception-keyboard';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { driverGroups } from '@/lib/driver-presentation';

export type ShiftChoice = { id: string; driverId: string; label: string; disabled?: boolean; searchText?: string; queuePosition?: number; driverGroup?: number; waitingCount?: number };

export function ShiftPicker({ value, onChange, choices, disabled = false, selectedLabel, changeLabel, fontSize, initialOpen = false, focusSend = false, onKeyboardSelect, allowClear = true, onClose }: {
  focusSend?: boolean; onKeyboardSelect?: (value:string)=>void|Promise<void>; value: string; onChange: (value: string) => void | Promise<void>; choices: ShiftChoice[]; disabled?: boolean; selectedLabel?: string; changeLabel?: string; fontSize?: number; initialOpen?: boolean; allowClear?: boolean; onClose?:()=>void;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const lock=useRef(false), searchInput=useRef<HTMLInputElement>(null), trigger=useRef<HTMLButtonElement>(null);
  const [highlight,setHighlight]=useState<string|null>(null);
  const listId=useId();
  const returnTarget=useRef<HTMLElement|null>(null);
  const visible=choices.filter(choice => `${choice.label} ${choice.searchText??''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((a,b)=>(a.driverGroup??0)-(b.driverGroup??0)||a.id.localeCompare(b.id));
  const enabled=[...(allowClear?[{id:'',driverId:'',label:'غير معيّن'}]:[]),...visible.filter(choice=>!choice.disabled||choice.id===value)];
  const highlighted=enabled.find(choice=>choice.id===highlight)??enabled.find(choice=>choice.id===value&&value!=='')??enabled.find(choice=>choice.id!=='')??enabled[0];
  async function choose(id: string, keyboard = false) {
    if (lock.current || disabled || (id && !enabled.some(choice=>choice.id===id))) return;
    lock.current=true;
    // Capture before mutation; live updates can disable or replace the trigger.
    returnTarget.current=(focusSend || (keyboard && onKeyboardSelect) ? trigger.current?.closest('form,tr')?.querySelector<HTMLElement>('[data-send],button[type="submit"]') : nextControl(trigger.current))??null;
    setPending(true); setError('');
    try { await (keyboard && onKeyboardSelect ? onKeyboardSelect(id) : onChange(id)); setOpen(false); setSearch(''); returnTarget.current?.focus(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'تعذر تعيين السائق'); }
    finally { lock.current=false; setPending(false); }
  }
  return <Popover open={open} onOpenChange={value=>{setOpen(value);if(value)setSearch('');else onClose?.();}}>
    <PopoverTrigger asChild><Button ref={trigger} type="button" variant="outline" disabled={disabled || pending} style={fontSize?{fontSize}:undefined} title={choices.find(choice=>choice.id===value)?.label??selectedLabel} className="w-full justify-between gap-1 text-right" aria-label="اختيار السائق"><span className="min-w-0 truncate">{choices.find(choice => choice.id === value)?.label ?? selectedLabel ?? (value ? 'التعيين الحالي' : 'اختر السائق')}</span>{changeLabel&&<span className="shrink-0 text-xs font-semibold text-primary">{changeLabel}</span>}</Button></PopoverTrigger>
    <PopoverContent dir="rtl" className="reception-picker w-80 max-w-[calc(100vw-24px)] space-y-2" onOpenAutoFocus={event=>{event.preventDefault();returnTarget.current=null;searchInput.current?.focus();}} onCloseAutoFocus={event=>{if(returnTarget.current){event.preventDefault();returnTarget.current.focus();}else if(initialOpen){event.preventDefault();trigger.current?.closest('td')?.querySelector<HTMLButtonElement>(':scope > button')?.focus();}}} onEscapeKeyDown={event=>{event.preventDefault();returnTarget.current=initialOpen?trigger.current?.closest('td')?.querySelector<HTMLButtonElement>(':scope > button')??null:trigger.current;setOpen(false);onClose?.();}} onDoubleClick={event => event.stopPropagation()}>
      <Input ref={searchInput} role="combobox" aria-expanded={open} aria-controls={listId} aria-activedescendant={highlighted?`${listId}-${highlighted.id}`:undefined} aria-autocomplete="list" aria-label="بحث السائق والسيارة" placeholder="ابحث بالاسم أو الهاتف أو اللوحة" value={search} onChange={event => {setSearch(event.target.value);setHighlight(null);}} onKeyDown={event=>{
        if(event.nativeEvent.isComposing)return;
        if(event.key==='ArrowDown'||event.key==='ArrowUp') {event.preventDefault();const index=enabled.findIndex(choice=>choice.id===highlighted?.id);const next=enabled[(index+(event.key==='ArrowDown'?1:-1)+enabled.length)%enabled.length];if(next){setHighlight(next.id);document.getElementById(`${listId}-${next.id}`)?.scrollIntoView({block:'nearest'});}}
        else if(event.key==='Enter'){event.preventDefault();event.stopPropagation();if(!event.repeat&&highlighted)void choose(highlighted.id,true);}
        else if(event.key==='Tab'){event.preventDefault();returnTarget.current=event.shiftKey?(initialOpen?trigger.current?.closest('td')?.querySelector<HTMLButtonElement>(':scope > button')??trigger.current:trigger.current):nextControl(trigger.current)??null;setOpen(false);onClose?.();}
      }}/>
      <div id={listId} role="listbox" aria-label="السائقون" className="max-h-64 overflow-y-auto">
        {allowClear&&<Button id={`${listId}-`} role="option" tabIndex={-1} aria-selected={highlighted?.id===''} className={highlighted?.id===''?'ring-2 ring-inset ring-blue-600':''} type="button" variant="ghost" disabled={pending} onClick={() => void choose('')}>غير معيّن</Button>}
        {visible.map((choice,index) => <div key={choice.id}>
          {choice.driverGroup!==undefined&&visible[index-1]?.driverGroup!==choice.driverGroup&&<h3 className={`flex justify-between rounded px-2 py-1.5 text-xs font-bold ${driverGroups[choice.driverGroup].color}`}><span>{driverGroups[choice.driverGroup].label}</span><span>{visible.filter(item=>item.driverGroup===choice.driverGroup).length}</span></h3>}
          <Button id={`${listId}-${choice.id}`} role="option" tabIndex={-1} aria-selected={highlighted?.id===choice.id} type="button" variant="ghost" disabled={pending || (choice.disabled && choice.id !== value)} style={fontSize?{fontSize}:undefined} title={choice.label} className={`my-0.5 h-auto min-h-9 w-full justify-between gap-2 whitespace-normal py-2 text-right ${highlighted?.id===choice.id?'ring-2 ring-inset ring-blue-600 ':''}${choice.driverGroup!==undefined?driverGroups[choice.driverGroup].color:''}`} onClick={() => void choose(choice.id)}>
            <span>{choice.queuePosition ? `${choice.queuePosition}. ` : ''}{choice.label}{choice.driverGroup===undefined&&choice.disabled ? ' — مشغول' : ''}</span>
            {choice.driverGroup===2&&<span className="shrink-0 text-xs font-semibold">مشغول | انتظار {choice.waitingCount??0}</span>}
          </Button>
        </div>)}
        {!visible.length&&<p className="p-3 text-center text-sm text-slate-600">لا يوجد سائق مطابق للبحث</p>}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </PopoverContent>
  </Popover>;
}
