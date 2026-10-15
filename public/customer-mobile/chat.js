// One chat at a time. Drafts and uncertain sends survive closing, but never account locking.
let current=null;
const drafts=new Map();
window.addEventListener('dispatchpro-customer-lock',()=>{current?.dispose();drafts.clear();});
export function openRideChat(ride,api){
 if(current?.rideId===ride.id){current.input.focus();return current.dialog;}
 if(document.querySelector('dialog.ride-call[open]'))return null;
 current?.dispose();
 window.dispatchEvent(new CustomEvent('dispatchpro-panel-open',{detail:{id:'chat'}}));
 const dialog=document.createElement('dialog');dialog.className='mobile-picker ride-chat';
 dialog.dir='rtl';dialog.setAttribute('aria-label','محادثة الرحلة');dialog.dataset.rideId=ride.id;
 const heading=document.createElement('h2');heading.textContent='محادثة السائق';
 const close=document.createElement('button');close.textContent='العودة للرحلة';close.className='quiet';close.type='button';
 const header=document.createElement('div');header.className='chat-heading';header.append(heading,close);
 const messages=document.createElement('div');messages.setAttribute('aria-live','polite');messages.className='chat-messages';
 const older=document.createElement('button');older.textContent='رسائل أقدم';older.className='chat-older';older.hidden=true;
 const form=document.createElement('form'),label=document.createElement('label'),input=document.createElement('textarea'),send=document.createElement('button'),note=document.createElement('p');
 label.textContent='رسالتك';input.maxLength=1000;input.required=true;input.rows=2;label.append(input);send.textContent='إرسال';note.setAttribute('role','status');form.append(label,send);
 const quick=document.createElement('div');quick.className='place-chips';
 const draft=drafts.get(ride.id)||{text:'',pending:null};input.value=draft.text;
 let pending=draft.pending,busy=false,before=null,timer,controller=null,closed=false,rows=new Map(),loading=false,delay=0,latest=null,reconnect=false;
 input.disabled=!!pending;input.oninput=()=>draft.text=input.value;
 if(pending){send.textContent='إعادة إرسال';note.textContent='رسالة بانتظار تأكيد الإرسال. إعادة المحاولة لا تنشئ رسالة ثانية.';}
 for(const text of ['أنا في الموقع','أين أنت؟','أنا نازل الآن']){const button=document.createElement('button');button.type='button';button.textContent=text;button.onclick=()=>{if(!pending)input.value=text;};quick.append(button);}
 const merge=items=>{if(!items.length)return;const nearBottom=messages.scrollHeight-messages.scrollTop-messages.clientHeight<64;const height=messages.scrollHeight;const top=messages.scrollTop;items.forEach(m=>rows.set(m.id,m));messages.replaceChildren();for(const m of [...rows.values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt))){const bubble=document.createElement('div');bubble.className='chat-message'+(m.mine?' mine':'');bubble.dataset.messageId=m.id;const text=document.createElement('p');text.textContent=m.text;const time=document.createElement('time');time.textContent=new Date(m.createdAt).toLocaleTimeString('ar',{hour:'2-digit',minute:'2-digit'});bubble.append(text,time);messages.append(bubble);}messages.scrollTop=nearBottom?messages.scrollHeight:top+Math.max(0,messages.scrollHeight-height);};
 async function load(){if(loading||closed||document.hidden||navigator.onLine===false)return;loading=true;controller=new AbortController();const initial=latest===null;try{const result=await api('rides/'+ride.id+'/chat'+(initial?'':'?after='+encodeURIComponent(latest)+'&wait=true'),'GET',undefined,controller.signal);if(closed||controller.signal.aborted)return;merge(result.items);const newest=result.items.at(-1);if(newest){latest=newest.id;void api('mobile/chat-read','POST',{rideId:ride.id,messageId:newest.id}).catch(()=>{});}else latest??='00000000-0000-0000-0000-000000000000';if(initial){before=result.nextBefore;older.hidden=!before;}if(!pending)note.textContent='';delay=250;}catch{if(!closed&&!controller.signal.aborted){note.textContent='تعذر تحديث المحادثة. سنعيد المحاولة عند عودة الاتصال.';delay=Math.min(Math.max(delay*2,1500),60000);}}finally{loading=false;if(!closed&&!document.hidden&&navigator.onLine!==false)timer=setTimeout(load,reconnect?0:delay);reconnect=false;}}
 older.onclick=async()=>{older.disabled=true;try{const result=await api('rides/'+ride.id+'/chat?before='+encodeURIComponent(before));if(closed)return;merge(result.items);before=result.nextBefore;older.hidden=!before;}catch{note.textContent='تعذر تحميل الرسائل السابقة.';}finally{older.disabled=false;}};
 form.onsubmit=async event=>{event.preventDefault();if(busy)return;pending??={id:crypto.randomUUID(),text:input.value.trim()};if(!pending.text){pending=null;return;}draft.text=pending.text;draft.pending=pending;drafts.set(ride.id,draft);busy=true;send.disabled=true;input.disabled=true;note.textContent='جارٍ الإرسال…';try{const result=await api('rides/'+ride.id+'/chat','POST',pending);pending=null;draft.pending=null;draft.text='';if(closed)return;merge([result]);input.value='';note.textContent='تم الإرسال';send.textContent='إرسال';}catch{if(!closed){note.textContent='تعذر تأكيد الإرسال. أعد المحاولة بالرسالة نفسها عند عودة الاتصال.';send.textContent='إعادة إرسال';}}finally{busy=false;send.disabled=false;input.disabled=!!pending;}};
 const online=()=>{clearTimeout(timer);reconnect=true;if(loading)controller?.abort();else void load();};window.addEventListener('online',online);
 const visibility=()=>{clearTimeout(timer);if(document.hidden||navigator.onLine===false)controller?.abort();else online();};
 const panel=event=>{if(event.detail?.id!=='chat')dispose();};
 const locked=()=>{dispose();drafts.clear();};
 const dispose=()=>{if(closed)return;closed=true;draft.text=input.value;draft.pending=pending;drafts.set(ride.id,draft);controller?.abort();clearTimeout(timer);window.removeEventListener('online',online);window.removeEventListener('offline',visibility);window.removeEventListener('dispatchpro-panel-open',panel);window.removeEventListener('dispatchpro-customer-lock',locked);document.removeEventListener('visibilitychange',visibility);dialog.remove();if(current?.dialog===dialog)current=null;document.querySelector('[data-chat-ride="'+ride.id+'"]')?.focus({preventScroll:true});};
 window.addEventListener('offline',visibility);window.addEventListener('dispatchpro-panel-open',panel);window.addEventListener('dispatchpro-customer-lock',locked);document.addEventListener('visibilitychange',visibility);
 close.onclick=dispose;dialog.onclose=dispose;dialog.oncancel=event=>{event.preventDefault();dispose();};
 dialog.append(header,messages,older,quick,form,note);document.body.append(dialog);current={rideId:ride.id,dialog,input,dispose};dialog.showModal();void load();close.focus();return dialog;
}
