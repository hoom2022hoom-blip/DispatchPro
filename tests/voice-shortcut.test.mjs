import test from 'node:test';
import assert from 'node:assert/strict';
import {bindVoiceShortcut,validVoiceShortcut,voiceShortcutLabel} from '../src/lib/voice-shortcut.ts';
test('custom PTT uses one hold, releases on keyup, ignores repeat/typing and stops on focus loss',()=>{
 const target=new EventTarget();let starts=0,stops=0;
 const cleanup=bindVoiceShortcut(target,'F2',()=>starts++,()=>stops++);
 const fire=(type,props={})=>{const e=new Event(type,{cancelable:true});for(const [k,v] of Object.entries({code:'F2',...props}))Object.defineProperty(e,k,{value:v});target.dispatchEvent(e);return e;};
 fire('keydown',{code:'F1'});assert.equal(starts,0);
 assert.equal(fire('keydown').defaultPrevented,true);fire('keydown',{repeat:true});fire('keydown');assert.equal(starts,1);
 fire('keyup');assert.equal(stops,1);fire('keyup');assert.equal(stops,1);
 const typed=new Event('keydown');Object.defineProperties(typed,{code:{value:'F2'},target:{value:{closest:()=>({})}}});target.dispatchEvent(typed);assert.equal(starts,1);
 fire('keydown',{ctrlKey:true});assert.equal(starts,1);
 fire('keydown');target.dispatchEvent(new Event('blur'));assert.equal(stops,2);
 cleanup();fire('keydown');assert.equal(starts,2);
});
test('only standalone safe keys are accepted; browser/system combinations cannot be stored',()=>{
 for(const code of ['F1','F2','F3','F4','Space','ControlLeft','AltLeft'])assert.equal(validVoiceShortcut(code),true);
 for(const code of ['F5','F11','F12','KeyW','KeyR','Delete','Alt+F4','Ctrl+W','Ctrl+Shift+Delete','MetaLeft'])assert.equal(validVoiceShortcut(code),false);
 assert.equal(voiceShortcutLabel('ControlLeft'),'Ctrl');assert.equal(voiceShortcutLabel('Space'),'Space');
});
