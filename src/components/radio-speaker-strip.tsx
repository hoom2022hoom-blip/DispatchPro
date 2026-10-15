"use client";
import {Radio} from 'lucide-react';
import type {VoiceClient,VoiceStatus} from '@/lib/voice-client';
import {radioPresentation} from '@/lib/radio-presentation';

export function RadioSpeakerStrip({status,client}:{status:VoiceStatus;client:VoiceClient|null}){
 const view=radioPresentation(status);
 return <div className="radio-speaker-strip" data-radio-phase={view.phase} role="status" aria-live="polite" aria-atomic="true" title={status.message}>
  <Radio size={18} aria-hidden="true"/>
  <span className="min-w-0 flex-1"><strong className="block truncate">{view.title}</strong><span className="block truncate">{view.channel&&(view.channel==='public'?'عام · ':'خاص · ')}{view.name??'عام · ضغط مطوّل للتحدث'}</span>{view.phase==='granted'&&<span className="block truncate">{status.message}</span>}</span>
  {status.needsPlayback&&<button type="button" className="min-h-11 rounded-lg border px-2" onClick={()=>client?.unlock()}>تفعيل الاستماع</button>}
 </div>;
}

export function RadioSpeakerRibbon({status}:{status:VoiceStatus}){
 const view=radioPresentation(status);
 if(!['busy','talking','granted'].includes(view.phase))return null;
 return <div className="radio-speaker-ribbon" data-radio-phase={view.phase} aria-hidden="true"><Radio size={15}/><span>{view.channel==='public'?'عام':'خاص'} · {view.name??view.title} · {view.phase==='granted'?'تم منح الموجة':view.phase==='talking'?'جارٍ التحدث':view.title}</span></div>;
}
