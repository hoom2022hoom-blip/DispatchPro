"use client";
import {useEffect,useState} from 'react';
import {defaultDriverTones,driverTones,previewDriverTone,toneChoices} from '@/lib/driver-tones.js';
import {TaxiTheme} from './taxi-theme';
export function OfficeToneSettings(){
 const [tones,setTones]=useState(defaultDriverTones),[ready,setReady]=useState(false);
 useEffect(()=>{setTones(driverTones());setReady(true);},[]);
 function save(key:keyof typeof tones,tone:number){const next={...tones,[key]:tone};setTones(next);try{const preferences=JSON.parse(localStorage.getItem('driver.alert.preferences')||'{}');localStorage.setItem('driver.alert.preferences',JSON.stringify({...preferences,...next}));}catch{}}
 return <section dir="rtl" className="m-4 space-y-3 rounded-xl border bg-white p-4"><div className="flex items-center justify-between"><h2 className="font-bold">نغمات المكتب والمظهر</h2><TaxiTheme defaultMode="dark"/></div><p className="text-xs text-slate-600">تُحفظ النغمات على جهاز المكتب. نغمة الطلب مستقلة عن تأكيد الموجة.</p>{([['orderTone','الطلب الجديد'],['publicTone','بدء العام'],['privateTone','بدء الخاص'],['floorTone','تأكيد الموجة']] as const).map(([key,label])=><div key={key} className="flex items-center gap-3"><label className="flex-1">{label}<select aria-label={label} disabled={!ready} value={tones[key]} onChange={e=>save(key,Number(e.target.value))} className="mr-3 min-h-11 rounded border px-3">{toneChoices.map(n=><option key={n} value={n}>نغمة {n}</option>)}</select></label><button type="button" aria-label={'تجربة '+label} onClick={()=>previewDriverTone(tones[key])} className="min-h-11 rounded border px-4">تجربة</button></div>)}</section>;
}
