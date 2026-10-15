export const DEFAULT_VOICE_SHORTCUT = 'F1';
export const voiceShortcutCodes = ['F1','F2','F3','F4','F8','F9','Space','ControlLeft','ControlRight','AltLeft','AltRight'] as const;
export function validVoiceShortcut(code:string){return (voiceShortcutCodes as readonly string[]).includes(code);}
export function voiceShortcutLabel(code:string){return code==='Space'?'Space':code.startsWith('Control')?'Ctrl':code.startsWith('Alt')?'Alt':code;}
export function editableVoiceTarget(target:EventTarget|null){
 const element=target as HTMLElement|null;
 return !!element?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"], [data-voice-shortcut-capture]');
}
export function bindVoiceShortcut(target:Window,code:string,start:()=>void,stop:()=>void){
 let held=false;
 const release=()=>{if(held){held=false;stop();}};
 const down=(e:KeyboardEvent)=>{
  if(e.code!==code){if(held)release();return;}
  const modifier=code.startsWith('Control')||code.startsWith('Alt');
  if(e.defaultPrevented||e.repeat||held||editableVoiceTarget(e.target)||e.metaKey||e.shiftKey||(!code.startsWith('Control')&&e.ctrlKey)||(!code.startsWith('Alt')&&e.altKey))return;
  if(!modifier)e.preventDefault();held=true;start();
 };
 const up=(e:KeyboardEvent)=>{if(e.code===code){if(held)e.preventDefault();release();}};
 const focus=(e:FocusEvent)=>{if(editableVoiceTarget(e.target))release();};
 const hidden=()=>{if(target.document?.visibilityState==='hidden')release();};
 target.addEventListener('keydown',down);target.addEventListener('keyup',up);target.addEventListener('blur',release);target.addEventListener('pagehide',release);target.addEventListener('focusin',focus);target.document?.addEventListener('visibilitychange',hidden);
 return()=>{release();target.removeEventListener('keydown',down);target.removeEventListener('keyup',up);target.removeEventListener('blur',release);target.removeEventListener('pagehide',release);target.removeEventListener('focusin',focus);target.document?.removeEventListener('visibilitychange',hidden);};
}
