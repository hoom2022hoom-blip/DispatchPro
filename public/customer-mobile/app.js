import { createMap, createJourneyMap } from './maps.js';
import {createCustomerSession} from './session.js';
import {openRideChat} from './chat.js';
import {RideCommunication} from './communication.js';
function whatsAppHref(value,message){let number=(value||'').replace(/[\s()-]/g,'').replace(/^00/,'').replace(/^\+/,'');if(/^0\d{8,9}$/.test(number))number='970'+number.slice(1);return /^[1-9]\d{6,14}$/.test(number)?'https://wa.me/'+number+'?text='+encodeURIComponent(message):null;}
function whatsAppButton(value,label,message){const href=whatsAppHref(value,message);if(!href)return null;const link=document.createElement('a');link.href=href;link.target='_blank';link.rel='noopener noreferrer';link.textContent=label;return link;}
// Safari versions without AbortSignal.timeout/any still use the same cancellable API flow.
if (!AbortSignal.timeout) AbortSignal.timeout = milliseconds => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), milliseconds);
  return controller.signal;
};
if (!AbortSignal.any) AbortSignal.any = signals => {
  const controller = new AbortController();
  const abort = () => { controller.abort(); for (const signal of signals) signal.removeEventListener('abort', abort); };
  for (const signal of signals) { if (signal.aborted) { abort(); break; } signal.addEventListener('abort', abort, {once:true}); }
  return controller.signal;
};
const $=id=>document.getElementById(id);
const key='dispatchpro.customer.device.v1'+(window.dispatchProCustomerDebug?'.debug':'');
let arrivalPort=null,communication=null,pendingCommunicationOpen=null,pendingChatOpen='',pendingRideOpen='';
let notificationRide=null,lastRides=[],historyTask=0,historyLoadedAt=0;
async function openNotificationRide(rideId){
 if(typeof rideId!=='string'||!rideId.match(/^[a-fA-F0-9-]{36}$/))return;
 if(!profile){pendingRideOpen=rideId;return;}
 const account=device.accountId;
 try{const ride=await api('rides/'+rideId);if(!profile||device.accountId!==account||ride.id!==rideId)return;dismissedRideId='';lastJourney=ride;$('request-tab').onclick();notificationRide=ride;list('rides',[ride]);showJourney(ride);$('journey-map').open=true;if(pendingChatOpen===ride.id){const chat=document.querySelector('[data-chat-ride="'+ride.id+'"]');if(chat){pendingChatOpen='';chat.click();}}}catch{ /* Backend authorization decides whether this ride still belongs to the account. */ }
}
const nativeReplies=new Map();
function nativeCommunication(type,data={}){if(!arrivalPort){if(!window.dispatchProCustomerNative)return Promise.resolve();return new Promise((resolve,reject)=>{const ready=()=>{clearTimeout(timer);window.removeEventListener('dispatchpro-customer-native-ready',ready);nativeCommunication(type,data).then(resolve,reject);};const timer=setTimeout(()=>{window.removeEventListener('dispatchpro-customer-native-ready',ready);reject(Error('تعذر الاتصال بنظام Android'));},30000);window.addEventListener('dispatchpro-customer-native-ready',ready,{once:true});});}return new Promise((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{nativeReplies.delete(id);reject(Error('تعذر الاتصال بنظام Android'));},type==='call.audio'?120000:30000);nativeReplies.set(id,{resolve,reject,timer});arrivalPort.postMessage(JSON.stringify({type,id,...data}));});}
window.addEventListener('dispatchpro-call-note',e=>{const note=document.getElementById('arrival-permission-note');if(note)note.textContent=e.detail;});
window.addEventListener('dispatchpro-chat-unread',e=>{for(const button of document.querySelectorAll('[data-chat-ride]')){const count=e.detail[button.dataset.chatRide]||0;button.textContent='محادثة السائق'+(count?' ('+count+')':'');}});

let pushDevice=null,pushBound='',pushTask=null,nativeVault=false,audio=null;
function saveDevice(){if(nativeVault&&arrivalPort)arrivalPort.postMessage(JSON.stringify({type:'device-store',device}));else localStorage.setItem(key,JSON.stringify(device));}
async function bindPush(){
  if(!profile||!pushDevice||pushTask||pushBound===pushDevice.token)return;
  const account=device.accountId,registration=pushDevice;
  const task=api('push-device','POST',registration).then(()=>{
    if(!profile||device.accountId!==account||pushDevice!==registration)return;
    pushBound=registration.token;arrivalPort?.postMessage(JSON.stringify({type:'push-bound',recipient:account}));
  }).catch(()=>{ /* The next online/resume event retries; no sensitive diagnostics. */ }).finally(()=>{if(pushTask===task)pushTask=null;});pushTask=task;return task;
}
window.addEventListener('message',event=>{
  if(!window.dispatchProCustomerNative||event.origin!==''||event.source!==null||event.data!=='dispatchpro-customer-arrival'||event.ports?.length!==1)return;
  arrivalPort?.close();arrivalPort=event.ports[0];
  nativeVault=true;window.dispatchEvent(new Event('dispatchpro-customer-native-ready'));
  arrivalPort.onmessage=async incoming=>{let value;try{value=JSON.parse(incoming.data);}catch{return;}
    if(value.type==='native-result'){const task=nativeReplies.get(value.id);if(task){clearTimeout(task.timer);nativeReplies.delete(value.id);if(value.error)task.reject(Error(value.error));else task.resolve(value.data);}return;}
    if(value.type==='communication-open'){if(value.action==='ride'){void openNotificationRide(value.rideId);}else if(value.action==='chat'){pendingChatOpen=value.rideId;const target=document.querySelector('[data-chat-ride="'+value.rideId+'"]');if(target){target.click();pendingChatOpen='';}}else{if(communication)communication.open(value.callId,value.action);else pendingCommunicationOpen=value;}return;}
    if(value.type==='device-restored'&&value.device?.accountId&&value.device?.deviceSecret){if(!device){device=value.device;await $('resume').onclick();}}
    if(value.type==='device-stored')localStorage.removeItem(key);
    if(value.type==='push-device'&&typeof value.token==='string'&&typeof value.installationId==='string'){pushDevice={token:value.token,installationId:value.installationId};void bindPush();}
  };
  if(device)saveDevice();
  if(activeRide)notifyArrival(activeRide);
});
function notifyArrival(ride){
  if(!['ARRIVED','DRIVER_ARRIVED'].includes(ride.rideStatus||ride.workflowStatus||ride.status)||!ride.arrivalEventId)return;
  if(ride.arrivalAcknowledged){arrivalPort?.postMessage(JSON.stringify({type:'arrival-ack',eventId:ride.arrivalEventId}));return;}
  if(window.dispatchProDevelopment)performance.mark('customer-arrival-received');arrivalPort?.postMessage(JSON.stringify({type:'arrival-event',eventId:ride.arrivalEventId,rideId:ride.id,driverName:ride.driver?.fullName||ride.driver?.name||''}));
  if(arrivalPort)return; // Android notification channel owns sound and vibration.
  const seenKey='dispatchpro.customer.arrivals.'+device?.accountId;
  let seen=[];try{seen=JSON.parse(localStorage.getItem(seenKey)||'[]');}catch{}
  if(seen.includes(ride.arrivalEventId))return;
  try{localStorage.setItem(seenKey,JSON.stringify([...seen.slice(-127),ride.arrivalEventId]));}catch{return;}
  if(audio?.state==='running'){
    for(const offset of [0,.32,.64]){const tone=audio.createOscillator(),gain=audio.createGain();tone.frequency.value=880;gain.gain.setValueAtTime(.0001,audio.currentTime+offset);gain.gain.exponentialRampToValueAtTime(.18,audio.currentTime+offset+.03);gain.gain.exponentialRampToValueAtTime(.0001,audio.currentTime+offset+.24);tone.connect(gain);gain.connect(audio.destination);tone.start(audio.currentTime+offset);tone.stop(audio.currentTime+offset+.26);}
    navigator.vibrate?.([350,180,350]);
  }
}
const statuses={NO_DRIVER_AVAILABLE:'لا يوجد سائق متاح حاليًا؛ حاول طلب رحلة لاحقًا',DRIVER_ASSIGNED:'تم قبول الطلب',DRIVER_ARRIVING:'السائق في الطريق',DRIVER_ARRIVED:'السائق وصل',IN_TRIP:'الرحلة بدأت',REJECTED:'جاري البحث عن سائق',SEARCHING_DRIVER:'جاري البحث عن سائق',OFFERED:'جاري البحث عن سائق',REQUESTED:'جاري البحث عن سائق',ASSIGNED:'جاري البحث عن سائق',ACCEPTED:'تم قبول الطلب',ARRIVED:'السائق وصل',IN_PROGRESS:'الرحلة بدأت',COMPLETED:'تم الوصول',CANCELLED:'تم إلغاء الطلب'};
let device,profile,controller,timer,cursor='',delay=1500,epoch=0,page=1,gps=null,destinationGps=null,busy=false,activeRide=null;
let rideStateReady=false,lastJourney=null,dismissedRideId='',gpsTask=0,placesTask=null,placesEpoch=0,placesData={savedPlaces:[],recentDestinations:[],suggestedPlaces:[]},placesLoaded=false,savePlaceId='',saveBusy=false;
let homeMap,homeMapTask,customerPoint=null,confirmed=false,reviewing=false,mapGeneration=0,mapFocus='';
try{device=JSON.parse(localStorage.getItem(key)||'null');}catch{}
const pendingKey=()=>key+'.ride.'+device.accountId;
function customerMessage(message,fallback='تعذر إتمام العملية الآن. حاول مرة أخرى.'){return typeof message==='string'&&/^[\u0600-\u06ff\s،؛؟.…:؛0-9٠-٩()\-]+$/.test(message)?message:fallback;}
function error(message=''){$('error').textContent=message?customerMessage(message):'';$('error').hidden=!message;}
function rideLabel(ride){return statuses[ride?.rideStatus||ride?.workflowStatus||ride?.status]||'جارٍ تحديث حالة الطلب';}
function bookingReady(){const form=$('ride-form');return !!form.elements.pickup.value.trim()&&!!form.elements.destination.value.trim();}
function syncDestinationLabel(){$('destination-label').textContent=$('ride-form').elements.destination.value||'ابحث أو اكتب وجهتك…';$('request-ride').disabled=busy||!rideStateReady||!navigator.onLine||!bookingReady()||!!activeRide&&!(device&&localStorage.getItem(pendingKey()));}
function validPoint(point){return !!point&&Number.isFinite(point.latitude)&&Number.isFinite(point.longitude)&&Math.abs(point.latitude)<=90&&Math.abs(point.longitude)<=180;}
function connection(message){const failed=/إعادة|لا يوجد|تعذر/.test(message);$('connection').hidden=!failed;$('connection').textContent=failed?'تعذر الاتصال، نحاول إعادة الاتصال…':'';}
const customerAuth=createCustomerSession({device:()=>device,onInvalid:()=>{lock();}});
const raw=(...args)=>customerAuth.raw(...args);
const login=()=>customerAuth.login();
const api=(...args)=>customerAuth.request(...args);
function buttonBusy(value){busy=value;syncDestinationLabel();$('request-ride').textContent=value?'جارٍ إرسال الطلب…':'اطلب سيارة';$('confirm-ride').textContent=value?'جارٍ إرسال الطلب…':'تأكيد الطلب';document.querySelectorAll('form button,#resume,#confirm-ride,#edit-ride').forEach(b=>b.disabled=value||!navigator.onLine);$('request-ride').disabled=value||!rideStateReady||!navigator.onLine||!bookingReady()||!!activeRide&&!(device&&localStorage.getItem(pendingKey()));$('active-request-note').hidden=!activeRide;}
function card(ride){
  const article=document.createElement('article');article.className='card'+((ride.rideStatus||ride.status)==='COMPLETED'?' complete':'');
  const badge=document.createElement('span');badge.className='badge';badge.textContent=rideLabel(ride);article.append(badge);if(['ARRIVED','DRIVER_ARRIVED'].includes(ride.rideStatus||ride.workflowStatus||ride.status))article.classList.add('driver-arrived');
  const title=document.createElement('h3');title.textContent=ride.pickup+' ← '+ride.destination;article.append(title);
  const add=text=>{const p=document.createElement('p');p.textContent=text;article.append(p);};
  if(['COMPLETED','CANCELLED','NO_DRIVER_AVAILABLE'].includes(ride.rideStatus||ride.status)&&ride.createdAt)add(new Date(ride.createdAt).toLocaleString('ar-PS'));
  if(ride.scheduledAt)add('الحجز: '+new Date(ride.scheduledAt).toLocaleString('ar-PS'));
  if(ride.driver){const chat=whatsAppButton(ride.driver.whatsAppNumber,'واتساب السائق','مرحبًا، بخصوص رحلتي مع تكسي نابلس والمهندس');if(chat)article.append(chat);add('السائق: '+ride.driver.fullName);if(ride.driver.phone){const call=document.createElement('a');call.href='tel:'+ride.driver.phone;call.textContent='اتصال بالسائق · '+ride.driver.phone;article.append(call);}}
  if(ride.vehicle)add('السيارة: '+[ride.vehicle.make,ride.vehicle.model,ride.vehicle.color,ride.vehicle.plate].filter(Boolean).join(' · '));
  if(ride.driver&&['ACCEPTED','DRIVER_ARRIVING','ARRIVED','IN_PROGRESS','DRIVER_ASSIGNED','DRIVER_ARRIVED','IN_TRIP'].includes(ride.rideStatus||ride.status)){const chat=document.createElement('button');chat.type='button';chat.textContent='محادثة السائق';chat.dataset.chatRide=ride.id;chat.onclick=()=>openRideChat(ride,api);article.append(chat);const call=document.createElement('button');call.type='button';call.textContent='اتصال بالسائق عبر الإنترنت';call.onclick=()=>void communication?.start(ride.id);article.append(call);if(pendingChatOpen===ride.id){pendingChatOpen='';setTimeout(()=>chat.click(),0);}}
  if(ride.finalFare!=null||ride.meterCalculatedFare!=null)add(ride.finalFare!=null?'السعر النهائي: '+ride.finalFare+' '+(!ride.currency||ride.currency==='ILS'?'شيكل':ride.currency):ride.meterCalculatedFare!=null?'السعر الحالي: '+ride.meterCalculatedFare+' '+(!ride.currency||ride.currency==='ILS'?'شيكل':ride.currency):'السعر: لم يحدد بعد');
  if(ride.tracking){
    if(ride.tracking.distanceMeters!=null)add('المسافة إلى السائق: '+(ride.tracking.distanceMeters/1000).toFixed(1)+' كم');
    if(ride.tracking.etaSource==='ROUTE'&&Number.isFinite(ride.tracking.etaMinutes)&&ride.tracking.etaMinutes>0)add('الوصول التقريبي: '+ride.tracking.etaMinutes+' دقيقة');


  }else if(ride.driver&&!['COMPLETED','CANCELLED'].includes(ride.status))add('موقع السائق غير متاح أو قديم');
  if(!['IN_PROGRESS','IN_TRIP','COMPLETED','CANCELLED'].includes(ride.rideStatus||ride.workflowStatus||ride.status)){
    const cancel=document.createElement('button');cancel.type='button';cancel.className='quiet';cancel.textContent='إلغاء الطلب';
    cancel.onclick=()=>void cancelRide(ride,cancel);article.append(cancel);
  }
  if(['COMPLETED','CANCELLED','NO_DRIVER_AVAILABLE'].includes(ride.rideStatus||ride.status)){
    const again=document.createElement('button');again.type='button';again.className='full-width';again.textContent='إعادة الطلب';again.disabled=!!activeRide||busy;
    again.onclick=()=>{if(activeRide||busy||setPending())return;newRide();const form=$('ride-form');form.elements.pickup.value=ride.pickup||'';form.elements.destination.value=ride.destination||'';gps=validPoint(ride.pickupLocation)?{...ride.pickupLocation,locationSource:'MAP_PIN'}:null;destinationGps=validPoint(ride.destinationLocation)?{...ride.destinationLocation,locationSource:'MAP_PIN'}:null;syncDestinationLabel();showSummary();};article.append(again);
    const fresh=document.createElement('button');fresh.type='button';fresh.className='quiet full-width';fresh.textContent='طلب رحلة جديدة';fresh.onclick=newRide;article.append(fresh);
  }
  article.dataset.rideId=ride.id;
  if(ride.driver){const driver=document.createElement('div');driver.className='trip-driver';driver.textContent=[ride.driver.fullName,ride.vehicle?.plate].filter(Boolean).join(' · ');article.insertBefore?.(driver,title);}
  if(ride.notes)add('ملاحظات: '+ride.notes);
  const details=document.createElement('details');details.className='trip-details';
  const summary=document.createElement('summary');summary.textContent='تفاصيل الرحلة';details.append(summary);
  // Keep contact and trip actions outside the collapsible section.
  for(const child of [...article.children])if(child.tagName==='P'||child.tagName==='A'||ride.driver&&child.textContent==='إلغاء الطلب')details.append(child);
  article.insertBefore(details,[...article.children].find(child=>child.tagName==='BUTTON'||child.tagName==='A')||null);
  return article;
}
async function cancelRide(ride,button){
  if(button.disabled)return;
  button.disabled=true;error();
  try{await api('rides/'+encodeURIComponent(ride.id)+'/cancel','POST',{});cursor='';watch();}
  catch(e){error(e.message);button.disabled=false;}
}
const liveMaps=new Map();
let historyCurrent=false;
function list(id,rides){if(id==='rides'&&historyCurrent)list('history',lastRides.filter(r=>!['COMPLETED','CANCELLED','NO_DRIVER_AVAILABLE'].includes(r.rideStatus||r.status)));if(id==='rides')for(const [key,view] of liveMaps){if(!rides.some(r=>r.id===key&&r.tracking)){view.map.remove();liveMaps.delete(key);}}const target=$(id),signature=JSON.stringify(rides.map(r=>({...r,tracking:r.tracking?{etaMinutes:r.tracking.etaMinutes,etaSource:r.tracking.etaSource,distanceMeters:Math.round((r.tracking.distanceMeters||0)/50)*50}:null})));if(target.dataset.signature===signature)return;const expanded=new Set([...target.querySelectorAll('article')].filter(a=>a.querySelector('details')?.open).map(a=>a.dataset.rideId));target.dataset.signature=signature;target.replaceChildren();if(!rides.length){const p=document.createElement('p');p.className='muted';p.textContent='لا توجد رحلات بعد';target.append(p);}else rides.forEach(r=>{const item=card(r);const details=item.querySelector('details');if(details&&expanded.has(r.id))details.open=true;target.append(item);});}
function journeyPoints(ride){return {customer:customerPoint,pickup:ride?.pickupLocation||gps,destination:ride?.destinationLocation||destinationGps,driver:ride?.tracking};}
async function updateHomeMap(ride=activeRide){
  if(!profile||!$('journey-map').open)return;
  const generation=mapGeneration;try{if(!homeMapTask)homeMapTask=createJourneyMap($('home-map'),journeyPoints(ride)).then(view=>{if(generation!==mapGeneration){view.map.remove();return null;}return homeMap=view;});const view=await homeMapTask;if(!view||generation!==mapGeneration)return;view.update(journeyPoints(ride));const focus=ride?.tracking?ride.id+':driver':ride?.id||'draft';if(focus!==mapFocus){mapFocus=focus;view.fit();}$('home-map-error').hidden=true;requestAnimationFrame(()=>view.map.resize());}
  catch(e){homeMapTask=null;$('home-map-error').hidden=false;$('home-map-error').textContent='الخريطة غير متاحة مؤقتًا. يمكنك كتابة العنوان واستخدام تحديد الموقع.';}
}
function showJourney(ride){
  lastJourney=ride;
  const terminal=ride&&['COMPLETED','CANCELLED','NO_DRIVER_AVAILABLE'].includes(ride.rideStatus||ride.status);
  const receipt=terminal&&ride.id!==dismissedRideId;
  const visibleRide=terminal&&!receipt?null:ride;
  const state=visibleRide?.rideStatus||visibleRide?.status,banner=$('journey-status');
  banner.hidden=!visibleRide;banner.textContent=visibleRide?rideLabel(visibleRide):'';
  banner.className='journey-status'+(['SEARCHING_DRIVER','OFFERED','REQUESTED'].includes(state)?' searching':'')+(['ARRIVED','DRIVER_ARRIVED'].includes(state)?' arrived':'');
  const progress=$('journey-progress');progress.hidden=!visibleRide;progress.replaceChildren();
  if(visibleRide){
    const stages=['جاري البحث عن سائق','تم قبول الطلب','السائق في الطريق','السائق وصل','الرحلة بدأت','تم الوصول'];
    const position={REQUESTED:0,SEARCHING_DRIVER:0,OFFERED:0,ASSIGNED:0,DRIVER_ASSIGNED:1,ACCEPTED:1,DRIVER_ARRIVING:2,ARRIVED:3,DRIVER_ARRIVED:3,IN_PROGRESS:4,IN_TRIP:4,COMPLETED:5}[state];
    if(position!==undefined)stages.forEach((label,index)=>{const item=document.createElement('li');item.textContent=label;item.className=index<position?'done':index===position?'current':'';if(index===position)item.setAttribute('aria-current','step');progress.append(item);});
    if(['ARRIVED','DRIVER_ARRIVED'].includes(state)){banner.textContent='السائق وصل';const note=document.createElement('p');note.textContent='السائق بانتظارك في موقع الانطلاق.';banner.append(note);notifyArrival(visibleRide);const ack=document.createElement('button');ack.type='button';ack.textContent='شاهدت وصول السائق';ack.disabled=!!visibleRide.arrivalAcknowledged;ack.textContent=ack.disabled?'تم تأكيد الوصول':'شاهدت وصول السائق';ack.onclick=()=>void acknowledgeArrival(visibleRide,ack);banner.append(ack);}
  }
  $('ride-form').hidden=!!activeRide||reviewing||!rideStateReady||!!receipt;
  $('request-panel').classList.toggle('has-active-ride',!!visibleRide);$('saved-place-tools').hidden=$('ride-form').hidden;for(const [id,source]of [['saved',placesData.savedPlaces],['suggested',placesData.suggestedPlaces]])$(id+'-shortcuts').hidden=$('ride-form').hidden||!source?.length;
  $('ride-summary').hidden=!!activeRide||!reviewing;
  $('ride-loading').hidden=rideStateReady;
  $('journey-map').open=true;
  if(activeRide){closeDialog('destination-picker');closeMap();$('journey-map').open=true;}
  void updateHomeMap(visibleRide);
  const health=$('journey-health');if(health){const updated=Date.parse(visibleRide?.tracking?.updatedAt||''),age=Number.isFinite(updated)?Math.max(0,Math.floor((Date.now()-updated)/1000)):null;health.textContent=visibleRide?.driver?(age===null?'موقع السائق غير متاح':age<60?'موقع السائق محدث قبل '+age+' ثانية':'آخر موقع للسائق قبل '+Math.floor(age/60)+' دقيقة'):(gps?'موقع الانطلاق محدد':'يمكنك كتابة العنوان أو تحديده على الخريطة');}
}
function newRide(){
  notificationRide=null;
  if(activeRide||busy)return;
  dismissedRideId=lastJourney?.id||'';reviewing=false;confirmed=false;destinationGps=null;gps=null;customerPoint=null;gpsTask++;
  const form=$('ride-form');form.reset();form.elements.when.value='now';
  $('gps-note').textContent='استخدم موقعك الحالي، حدد نقطة على الخريطة، أو اكتب عنوانًا واضحًا.';
  $('schedule-label').hidden=true;$('schedule-note').hidden=true;form.elements.scheduledAt.required=false;
  $('journey-map').open=true;$('journey-status').hidden=true;$('ride-summary').hidden=true;form.hidden=false;$('saved-place-tools').hidden=false;$('save-place-form').hidden=true;
  renderPlaces();list('rides',[]);$('request-tab').onclick();error();form.elements.pickup.focus?.();buttonBusy(false);
}
$('fit-map').onclick=()=>{if(homeMap)homeMap.fit();else void updateHomeMap();};
function stop(){epoch++;controller?.abort();clearTimeout(timer);}
function watch(){stop();if(!profile||document.hidden||!navigator.onLine)return;const run=epoch;controller=new AbortController();const signal=controller.signal;async function poll(){try{const result=await api('updates?cursor='+encodeURIComponent(cursor),'GET',undefined,signal);if(signal.aborted||run!==epoch)return;cursor=result.cursor;lastRides=result.rides;rideStateReady=true;activeRide=result.rides.find(r=>!['COMPLETED','CANCELLED','NO_DRIVER_AVAILABLE'].includes(r.rideStatus||r.status)&&!r.scheduledAt)||null;buttonBusy(busy);const latestReceipt=result.rides[0];const visibleRide=notificationRide?(result.rides.find(r=>r.id===notificationRide.id)||notificationRide):activeRide||(lastJourney&&lastJourney.id===latestReceipt?.id?latestReceipt:null);list('rides',visibleRide&&visibleRide.id!==dismissedRideId?[visibleRide]:[]);showJourney(visibleRide);connection('متصل بخدمة الرحلات');delay=1500;const active=result.rides.some(r=>!['COMPLETED','CANCELLED','NO_DRIVER_AVAILABLE'].includes(r.rideStatus||r.status));timer=setTimeout(poll,active?250:60000);}catch(e){if(signal.aborted||run!==epoch)return;connection('إعادة الاتصال…');if(e.sessionInvalid){lock();error(e.message);return;}if(e.status===401||e.status===403){error(e.message);}delay=Math.min(delay*2,60000);timer=setTimeout(poll,delay);}}void poll();}
function setPending(){let pending=null;try{pending=JSON.parse(localStorage.getItem(pendingKey())||'null');}catch{}$('pending-note').hidden=!pending;const form=$('ride-form');for(const field of form.querySelectorAll('input,select,textarea'))field.disabled=!!pending;if(pending){form.elements.pickup.value=pending.pickup.addressText;form.elements.destination.value=pending.destination;form.elements.notes.value=pending.notes||'';}syncDestinationLabel();return pending;}
async function opened(){profile=await raw('me');communication?.dispose();if(typeof RTCPeerConnection!=='undefined'){communication=new RideCommunication(api,{native:nativeCommunication});void communication.connect();}if(pendingCommunicationOpen&&communication){communication.open(pendingCommunicationOpen.callId,pendingCommunicationOpen.action);pendingCommunicationOpen=null;}if(pendingRideOpen){const rideId=pendingRideOpen;pendingRideOpen='';void openNotificationRide(rideId);}void flushArrivalAcks();$('journey-map').open=true;if(nativeVault)saveDevice();void bindPush();rideStateReady=false;placesLoaded=false;placesData={savedPlaces:[],recentDestinations:[],suggestedPlaces:[]};renderPlaces();$('ride-loading').hidden=false;$('ride-form').hidden=true;document.getElementById('office-whatsapp')?.remove();const officeChat=whatsAppButton(profile.officeWhatsAppNumber,'واتساب المكتب','مرحبًا تكسي نابلس والمهندس، بخصوص طلب رحلة');if(officeChat){officeChat.id='office-whatsapp';$('office-contact').append(officeChat);}$('welcome').hidden=true;$('account').hidden=false;$('name').textContent='أهلًا، '+profile.fullName;const pending=setPending();cursor='';error();$('request-tab').onclick();watch();void loadPlaces();void updateHomeMap();if(!pending&&!$('pickup-query').value&&!activeRide)setTimeout(()=>{if(profile&&!busy&&!activeRide&&!$('pickup-query').value)$('locate').onclick();},0);}
function lock(){window.dispatchEvent(new Event('dispatchpro-customer-lock'));lastRides=[];historyTask++;historyLoadedAt=0;notificationRide=null;pendingRideOpen='';communication?.dispose();communication=null;if(profile)void raw('logout','POST',{}).catch(()=>{});arrivalPort?.postMessage(JSON.stringify({type:'push-unbound'}));if(profile&&pushDevice)void api('push-device/remove','POST',pushDevice).catch(()=>{});pushBound='';stop();$('ride-form').reset();$('save-place-form').reset();$('destination-query').value='';gpsTask++;placesEpoch++;placesTask=null;pickerGeneration++;rideStateReady=false;placesLoaded=false;placesData={savedPlaces:[],recentDestinations:[],suggestedPlaces:[]};closeDialog('destination-picker');closeMap();gps=null;destinationGps=null;customerPoint=null;profile=null;customerAuth.logout();activeRide=null;lastJourney=null;dismissedRideId='';$('welcome').hidden=false;$('account').hidden=true;$('register').hidden=!!device;$('returning').hidden=!device;list('rides',[]);list('history',[]);mapGeneration++;mapFocus='';reviewing=false;homeMap?.map.remove();homeMap=null;homeMapTask=null;connection('الحساب مقفل');}

$('register').hidden=!!device;$('returning').hidden=!device;
let otpChallenge=null,otpResendAt=0,otpExpiresAt=0;
async function requestOtp(){const debugTest=window.dispatchProCustomerDebug&&window.dispatchProCustomerTestOtp===true;const result=await raw(debugTest?'test-otp/request':'otp/request','POST',{tenant:device.tenant,phone:device.phone,accountId:device.accountId});otpChallenge=result.challengeId;otpResendAt=Date.now()+1000*(result.resendAfter??60);otpExpiresAt=Date.now()+1000*(result.expiresIn??300);$('register').hidden=true;$('returning').hidden=true;$('otp-form').hidden=false;$('otp-note').textContent=window.dispatchProCustomerDebug&&result.developmentOnly&&/^\d{6}$/.test(result.debugCode)?'رمز اختبار - Debug فقط: '+result.debugCode:'تم طلب إرسال رمز التحقق. صلاحيته 5 دقائق؛ تحقق من رسائلك.';}
$('register').addEventListener('submit',async event=>{event.preventDefault();if(busy)return;buttonBusy(true);error();try{const values=Object.fromEntries(new FormData(event.target));const retry=window.dispatchProCustomerDebug&&device&&!device.registered;device={tenant:device?.tenant||'',accountId:retry?device.accountId:crypto.randomUUID(),deviceSecret:retry?device.deviceSecret:Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join(''),fullName:values.fullName.trim(),phone:values.phone.trim(),registered:false};if(window.dispatchProCustomerDebug)saveDevice();await requestOtp();}catch(e){error(e.status===503?'التحقق بالرسائل غير متاح حاليًا. تواصل مع المكتب.':e.message);}finally{buttonBusy(false);}});
$('otp-form').addEventListener('submit',async event=>{event.preventDefault();if(busy||!otpChallenge)return;if(Date.now()>=otpExpiresAt){error('انتهت صلاحية رمز التحقق. اطلب رمزًا جديدًا.');return;}buttonBusy(true);error();try{const values=Object.fromEntries(new FormData(event.target));const proof=await raw('otp/verify','POST',{tenant:device.tenant,accountId:device.accountId,challengeId:otpChallenge,code:values.code});const result=await raw('register','POST',{...device,verificationProof:proof.verificationProof});customerAuth.accept(result.accessToken);device.registered=true;saveDevice();$('otp-form').reset();$('otp-form').hidden=true;otpChallenge=null;await opened();}catch(e){error(e.message);}finally{buttonBusy(false);}});
$('otp-resend').onclick=async()=>{if(busy)return;if(Date.now()<otpResendAt){$('otp-note').textContent='انتظر قليلًا قبل طلب رمز جديد.';return;}buttonBusy(true);try{await requestOtp();}catch(e){error(e.message);}finally{buttonBusy(false);}};
$('otp-back').onclick=()=>{if(busy)return;otpChallenge=null;$('otp-form').hidden=true;$('register').hidden=false;error();};
$('resume').onclick=async()=>{if(busy)return;buttonBusy(true);error();try{if(device.registered===false){await requestOtp();return;}await login();device.registered=true;saveDevice();await opened();}catch(e){error(e.message);}finally{buttonBusy(false);}};
$('lock').onclick=lock;
$('recover').onclick=()=>{$('register').hidden=false;$('returning').hidden=true;error();};
$('ride-form').elements.when.onchange=event=>{$('schedule-label').hidden=event.target.value!=='later';$('schedule-note').hidden=event.target.value!=='later';$('ride-form').elements.scheduledAt.required=event.target.value==='later';};
$('ride-form').elements.destination.oninput=()=>{destinationGps=null;void updateHomeMap();};
$('ride-form').elements.pickup.oninput=()=>{gpsTask++;gps=null;renderPickupPlaces();void updateHomeMap();};
$('locate').onclick=()=>{
  if(busy||activeRide||$('locate').disabled)return;
  if(!navigator.geolocation){error('تعذر تحديد موقعك. اكتب عنوانًا واضحًا أو حدد الموقع على الخريطة.');return;}
  const request=++gpsTask;$('locate').disabled=true;$('locate').replaceChildren(placeIcon('locate'));$('locate').setAttribute('aria-busy','true');$('gps-note').dataset.active='true';$('gps-note').textContent='جارٍ تحديد موقعك…';error();
  const done=()=>{$('locate').disabled=false;$('locate').replaceChildren(placeIcon('locate'));$('locate').removeAttribute('aria-busy');};
  navigator.geolocation.getCurrentPosition(position=>{
    if(request!==gpsTask)return;
    const point={latitude:position.coords.latitude,longitude:position.coords.longitude};
    if(!validPoint(point)||!Number.isFinite(position.timestamp)||Date.now()-position.timestamp>120000||position.timestamp>Date.now()+10000||!Number.isFinite(position.coords.accuracy)||position.coords.accuracy<0){done();error('تعذر تحديد موقع صالح. حاول مرة أخرى أو حدد الموقع على الخريطة.');return;}
    gps={...point,accuracy:position.coords.accuracy,timestamp:position.timestamp,locationSource:'CUSTOMER_GPS'};customerPoint={...point};
    // Same 200m accuracy ceiling already used by DispatchPro location validation.
    syncDestinationLabel();$('gps-note').textContent=gps.accuracy>200?'الموقع التقريبي تم تحديده، يمكنك تعديله على الخريطة.':'تم تحديد موقعك';
    if(!$('ride-form').elements.pickup.value)$('ride-form').elements.pickup.value='موقعي الحالي';
    done();void updateHomeMap().then(()=>homeMap?.fit());
  },e=>{if(request!==gpsTask)return;done();const message=e.code===1?'لم يتم السماح بالوصول إلى الموقع. حدد الموقع على الخريطة أو اكتب عنوانًا واضحًا.':'تعذر تحديد موقعك. حاول مرة أخرى أو حدد الموقع على الخريطة.';$('gps-note').textContent=message;error(message);},{enableHighAccuracy:true,timeout:10000,maximumAge:15000});
};
$('ride-form').addEventListener('submit',async event=>{event.preventDefault();if(busy||!rideStateReady||activeRide&&!localStorage.getItem(pendingKey()))return;if(!event.target.elements.destination.value.trim()){error('يرجى تحديد وجهة الرحلة');$('destination-error').textContent='يرجى تحديد وجهة الرحلة';$('open-destination').focus();return;}if(!event.target.elements.pickup.value.trim()){error('يرجى تحديد موقع الانطلاق');return;}if(!confirmed&&event.target.elements.when.value==='later'&&!setPending()){showSummary();return;}confirmed=false;buttonBusy(true);$('confirm-ride').disabled=true;error();try{let body=setPending();if(!body){const values=Object.fromEntries(new FormData(event.target));const scheduledAt=values.when==='later'?new Date(values.scheduledAt).toISOString():null;if(scheduledAt&&Date.parse(scheduledAt)<=Date.now())throw Error('اختر موعدًا في المستقبل');body={id:crypto.randomUUID(),pickup:{addressText:values.pickup.trim(),locationSource:gps?.locationSource|| (gps?'CUSTOMER_GPS':'MANUAL_TEXT'),...gps},destination:values.destination.trim(),destinationLocation:destinationGps?{addressText:values.destination.trim(),...destinationGps}:null,notes:values.notes.trim(),scheduledAt};localStorage.setItem(pendingKey(),JSON.stringify(body));}if(window.dispatchProDevelopment)performance.mark('customer-order-action');const created=await api('rides','POST',body);if(window.dispatchProDevelopment)performance.mark('customer-order-confirmed');reviewing=false;$('ride-summary').hidden=true;if(!created?.id||!created.rideStatus&&!created.status)throw Error('تعذر تأكيد الطلب. أعد المحاولة بأمان.');if(!body.scheduledAt){activeRide={...created,pickup:body.pickup.addressText,destination:body.destination,rideStatus:created.rideStatus||created.status,pickupLocation:body.pickup,destinationLocation:body.destinationLocation};showJourney(activeRide);}localStorage.removeItem(pendingKey());void loadPlaces(true);const pickupLabel=body.pickup.addressText;event.target.reset();destinationGps=null;if(gps)event.target.elements.pickup.value=pickupLabel;$('schedule-label').hidden=true;$('schedule-note').hidden=true;event.target.elements.scheduledAt.required=false;cursor='';watch();}catch(e){error(e.message);if([400,403,404,409].includes(e.status))localStorage.removeItem(pendingKey());}finally{setPending();buttonBusy(false);$('confirm-ride').disabled=false;}});
async function history(){const task=++historyTask;historyCurrent=false;$('history-paging').hidden=false;$('history-current').classList.remove('active');$('history-past').classList.add('active');try{const result=await api('history?page='+page);if(task!==historyTask||!profile)return;historyLoadedAt=Date.now();list('history',result.items);$('page').textContent=String(page);$('previous').disabled=page===1;$('next').disabled=page*20>=result.total;}catch(e){error(e.message);}}
$('history-tab').onclick=()=>{$('history-panel').hidden=false;$('request-panel').hidden=true;$('history-tab').classList.add('active');$('history-tab').setAttribute?.('aria-current','page');$('request-tab').removeAttribute?.('aria-current');$('request-tab').classList.remove('active');page=1;if(Date.now()-historyLoadedAt>15000||historyCurrent)void history();};
$('request-tab').onclick=()=>{notificationRide=null;$('history-panel').hidden=true;$('request-panel').hidden=false;$('request-tab').classList.add('active');$('request-tab').setAttribute?.('aria-current','page');$('history-tab').removeAttribute?.('aria-current');$('history-tab').classList.remove('active');requestAnimationFrame(()=>homeMap?.map.resize());};
$('previous').onclick=()=>{if(page>1){page--;void history();}};$('next').onclick=()=>{page++;void history();};
document.addEventListener('visibilitychange',()=>document.hidden?stop():watch());
window.addEventListener('pageshow',()=>{if(profile&&!document.hidden)watch();});
window.addEventListener('offline',()=>{stop();connection('لا يوجد اتصال');buttonBusy(busy);});window.addEventListener('online',()=>{void bindPush();void flushArrivalAcks();connection('جارٍ الاتصال');buttonBusy(busy);watch();});
buttonBusy(false);
if(!window.dispatchProCustomerNative&&'serviceWorker'in navigator&&window.isSecureContext)navigator.serviceWorker.register('./sw.js').catch(()=>{});

let picker,pickerTarget='',pickerDraft=null,pickerGeneration=0;
function openDialog(id){window.dispatchEvent(new CustomEvent('dispatchpro-panel-open',{detail:{id}}));const panel=$(id);panel.hidden=false;if(!panel.open){if(panel.showModal)panel.showModal();else{panel.open=true;panel.setAttribute?.('open','');}}}
function closeDialog(id){const panel=$(id);panel.close?.();panel.open=false;panel.removeAttribute?.('open');panel.hidden=true;}
function closeMap(){pickerGeneration++;closeDialog('map-picker');picker?.map.remove();picker=null;pickerDraft=null;}
async function pickLocation(target){
  if(busy||activeRide||setPending())return;
  closeDialog('destination-picker');closeMap();pickerTarget=target;if(target==='pickup'){gpsTask++;$('locate').disabled=false;$('locate').replaceChildren(placeIcon('locate'));$('locate').removeAttribute('aria-busy');}
  const generation=pickerGeneration,point=target==='pickup'?gps:destinationGps;
  pickerDraft=validPoint(point)?{latitude:point.latitude,longitude:point.longitude,locationSource:'MAP_PIN'}:null;
  $('map-title').textContent=target==='pickup'?'اختر موقع الانطلاق':'اختر وجهتك';
  $('confirm-map').textContent=target==='pickup'?'تأكيد موقع الانطلاق':'تأكيد الوجهة';$('confirm-map').disabled=!pickerDraft;
  $('map-note').textContent='جارٍ تحميل الخريطة…';openDialog('map-picker');
  try{const view=await createMap($('map-canvas'),pickerDraft,point=>{if(generation!==pickerGeneration)return;pickerDraft=point;$('confirm-map').disabled=!validPoint(point);$('map-note').textContent='تم اختيار النقطة. اضغط تأكيد لحفظ اختيارك.';});if(generation!==pickerGeneration){view.map.remove();return;}picker=view;$('map-note').textContent=pickerDraft?'يمكنك تعديل النقطة ثم تأكيدها.':'اضغط الخريطة لاختيار نقطة. لا يوجد موقع محدد بعد.';picker.map.resize?.();}
  catch(e){if(generation===pickerGeneration){$('map-note').textContent='تعذر تحميل الخريطة. يمكنك كتابة العنوان أو استخدام موقعك الحالي.';console.warn('Customer location picker unavailable');}}
}
$('pick-pickup').onclick=()=>void pickLocation('pickup');
$('pick-destination').onclick=()=>void pickLocation('destination');
$('close-map').onclick=closeMap;
$('map-picker').addEventListener('cancel',event=>{event.preventDefault();closeMap();});
$('confirm-map').onclick=()=>{
  if(!validPoint(pickerDraft)||busy||activeRide)return;
  if(pickerTarget==='pickup'){gps={...pickerDraft};if(!$('ride-form').elements.pickup.value)$('ride-form').elements.pickup.value='نقطة الانطلاق على الخريطة';$('gps-note').textContent='تم تأكيد موقع الانطلاق';}
  else setDestination($('destination-query').value.trim()||$('ride-form').elements.destination.value||'وجهة محددة على الخريطة',pickerDraft);
  closeMap();void updateHomeMap();(pickerTarget==='pickup'?$('pick-pickup'):$('destination-query')).focus?.();
};

function showSummary(){
  reviewing=true;
  const form=$('ride-form'),target=$('summary-details');target.replaceChildren();
  const add=text=>{const p=document.createElement('p');p.textContent=text;target.append(p);};
  add('الانطلاق: '+form.elements.pickup.value);add('الوجهة: '+form.elements.destination.value);
  if(gps?.accuracy>200)add('موقع الانطلاق تقريبي؛ يمكنك تعديله على الخريطة عند الحاجة.');
  if(gps&&destinationGps){const rad=Math.PI/180,dlat=(destinationGps.latitude-gps.latitude)*rad,dlon=(destinationGps.longitude-gps.longitude)*rad;const a=Math.sin(dlat/2)**2+Math.cos(gps.latitude*rad)*Math.cos(destinationGps.latitude*rad)*Math.sin(dlon/2)**2;add('المسافة المباشرة التقريبية: '+(6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))).toFixed(1)+' كم (ليست مسافة الطريق)');}
  add('الموعد: '+(form.elements.when.value==='later'?form.elements.scheduledAt.value.replace('T',' · '):'الآن'));
  if(form.elements.notes.value)add('ملاحظات: '+form.elements.notes.value);
  add('السعر: لم يحدد بعد');
  $('ride-summary').hidden=false;form.hidden=true;$('saved-place-tools').hidden=true;$('confirm-ride').focus?.();
}
$('confirm-ride').onclick=()=>{if(busy||!rideStateReady||activeRide||!navigator.onLine)return;confirmed=true;const form=$('ride-form');if(form.requestSubmit)return form.requestSubmit();if(form.reportValidity())form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));};
$('edit-ride').onclick=()=>{reviewing=false;$('ride-summary').hidden=true;$('ride-form').hidden=false;$('saved-place-tools').hidden=false;confirmed=false;};
// Lightweight Lucide-style SVG controls; only trusted, static paths become HTML.
const iconPaths={bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',list:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6m-6 4h6m-6 4h4"/>',search:'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',pin:'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',locate:'<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/><path d="M9 21v-8h6v8"/>',work:'<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V4h8v3M3 12h18m-9 0v3"/>'};
function placeIcon(name){const node=document.createElement('span');node.className='ui-icon';node.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(iconPaths[name]||iconPaths.star)+'</svg>';return node;}
document.querySelectorAll('[data-icon]').forEach(node=>node.replaceChildren(placeIcon(node.dataset.icon)));
const {normalizeArabicSearch:normalizePlace,matchesSuggestedPlace,isArabicPlace}=globalThis.ArabicPlaces;
function setDestination(label,point){
  if(busy||activeRide)return;
  $('destination-error').textContent='';$('ride-form').elements.destination.value=label.trim();destinationGps=validPoint(point)?{latitude:point.latitude,longitude:point.longitude,locationSource:point.id?'SAVED_ADDRESS':'MAP_PIN'}:null;
  reviewing=false;syncDestinationLabel();closeDialog('destination-picker');$('open-destination').focus?.();void updateHomeMap();
}
function openDestination(){
  if(busy||activeRide||!rideStateReady||setPending())return;
  $('destination-query').value='';$('save-place-form').hidden=true;$('save-place-note').textContent='';savePlaceId='';
  renderPlaces();openDialog('destination-picker');$('destination-query').focus?.();void loadPlaces(true);
}
function renderPickupPlaces(){
 const results=$('pickup-results');results.replaceChildren();const query=normalizePlace($('pickup-query').value);if(!query)return;
 for(const place of placesData.suggestedPlaces.filter(p=>p.isActive!==false&&validPoint(p)&&matchesSuggestedPlace(p,query))){const button=document.createElement('button');button.type='button';button.className='place-result';button.textContent=(place.name||place.label||'')+(place.addressText?' · '+place.addressText:'');button.onclick=()=>{if(busy||activeRide||setPending())return;gpsTask++;gps={latitude:place.latitude,longitude:place.longitude,locationSource:'MAP_PIN'};$('ride-form').elements.pickup.value=place.addressText||place.label||place.name;$('gps-note').textContent='تم تحديد موقع الانطلاق';results.replaceChildren();void updateHomeMap();};results.append(button);}
}
$('pickup-query').oninput=()=>{gpsTask++;gps=null;renderPickupPlaces();void updateHomeMap();};
function renderPlaces(){
  for(const [id,source] of [['saved',placesData.savedPlaces],['suggested',placesData.suggestedPlaces]]){const chips=$(id+'-chips');chips.replaceChildren();$(id+'-shortcuts').hidden=!source?.length;(source||[]).slice(0,6).forEach(place=>{const button=document.createElement('button');button.type='button';button.className='quiet place-chip';button.append(placeIcon(place.icon==='HOME'?'home':place.icon==='WORK'?'work':'star'));const text=document.createElement('span');text.textContent=place.label||place.name||place.addressText;button.append(text);button.onclick=()=>setDestination(place.addressText||place.label||place.name,place);chips.append(button);});}

 renderPickupPlaces();
  $('save-destination').hidden=!$('destination-query').value.trim()||!!activeRide||busy;
  const query=normalizePlace($('destination-query').value),results=$('destination-results');results.replaceChildren();$('close-destination-suggestions').hidden=true;if(!query)return;
  const sections=[['المواقع المحفوظة',placesData.savedPlaces],['وجهاتك الأخيرة',placesData.recentDestinations],['مواقع مقترحة',placesData.suggestedPlaces]];
  for(const [label,places] of sections){
    const matches=(places||[]).filter(p=>p.isActive!==false&&matchesSuggestedPlace(p,query));
    if(!matches.length){if(label==='المواقع المحفوظة'&&placesLoaded&&!query){const note=document.createElement('p');note.className='muted small';note.textContent='لا توجد أماكن محفوظة بعد';results.append(note);}continue;}
    const section=document.createElement('section'),heading=document.createElement('h3');heading.textContent=label;section.append(heading);
    matches.forEach(place=>{const button=document.createElement('button');button.type='button';button.className='place-result';button.append(placeIcon(place.icon==='HOME'?'home':place.icon==='WORK'?'work':label==='المواقع المحفوظة'?'star':'pin'));const text=document.createElement('span'),title=document.createElement('strong');title.textContent=place.label||place.addressText;text.append(title);if(place.addressText&&place.addressText!==place.label){const subtitle=document.createElement('small');subtitle.textContent=place.addressText;text.append(subtitle);}button.append(text);button.onclick=()=>{setDestination(place.addressText||place.label||place.name,place);results.replaceChildren();};section.append(button);});results.append(section);
  }
  $('close-destination-suggestions').hidden=!results.children.length;
  $('use-destination-text').hidden=!query;$('use-destination-text').textContent='استخدم: '+$('destination-query').value.trim();
}
async function loadPlaces(force=false){
  if(!profile||placesTask||placesLoaded&&!force)return placesTask;
  const generation=placesEpoch;let task;
  $('places-loading').hidden=false;$('places-error').hidden=true;$('retry-places').hidden=true;
  task=(async()=>{try{const result=await api('places');if(generation!==placesEpoch||!profile)return;placesData={savedPlaces:result.savedPlaces||[],recentDestinations:result.recentDestinations||[],suggestedPlaces:(result.suggestedPlaces||[]).filter(isArabicPlace)};placesLoaded=true;renderPlaces();}catch(e){if(generation===placesEpoch){$('places-error').textContent='تعذر تحميل أماكنك. يمكنك كتابة الوجهة أو اختيارها على الخريطة.';$('places-error').hidden=false;$('retry-places').hidden=false;}}finally{if(generation===placesEpoch)$('places-loading').hidden=true;}})();
  placesTask=task;try{await task;}finally{if(placesTask===task)placesTask=null;}
}
$('open-destination').onclick=openDestination;
$('ride-form').elements.destination.onclick=()=>renderPlaces();

$('close-destination').onclick=()=>{closeDialog('destination-picker');$('open-destination').focus?.();};
$('destination-picker').addEventListener('cancel',event=>{event.preventDefault();$('close-destination').onclick();});
$('destination-query').oninput=()=>{destinationGps=null;reviewing=false;$('destination-error').textContent='';savePlaceId='';$('save-place-form').hidden=true;renderPlaces();void updateHomeMap();};
function closeDestinationSuggestions(){$('destination-results').replaceChildren();$('close-destination-suggestions').hidden=true;}
$('close-destination-suggestions').onclick=event=>{event?.stopPropagation?.();closeDestinationSuggestions();};
$('destination-query').onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation?.();closeDestinationSuggestions();}else if(event.key==='Enter'){event.preventDefault();$('use-destination-text').onclick();}};
document.addEventListener('pointerdown',event=>{const target=event.target;if(target!==$('destination-query')&&target!==$('close-destination-suggestions')&&!$('destination-results').contains?.(target))closeDestinationSuggestions();});
$('use-destination-text').onclick=()=>{const text=$('destination-query').value.trim();if(text)setDestination(text,null);};
$('retry-places').onclick=()=>void loadPlaces(true);
$('save-destination').onclick=()=>{$('save-place-form').hidden=false;$('save-place-form').elements.label.focus?.();};
$('save-place-form').addEventListener('submit',async event=>{
  event.preventDefault();if(saveBusy||!profile)return;
  const label=event.target.elements.label.value.trim(),text=$('destination-query').value.trim()||$('ride-form').elements.destination.value.trim();
  if(!label||!text){$('save-place-note').textContent='اكتب اسم المكان والوجهة أولًا.';return;}
  saveBusy=true;const generation=placesEpoch;const button=event.target.querySelector('button[type="submit"]');if(button)button.disabled=true;$('save-place-note').textContent='جارٍ حفظ المكان…';
  try{savePlaceId||=crypto.randomUUID();const point=text===$('ride-form').elements.destination.value.trim()&&validPoint(destinationGps)?destinationGps:null;await api('places','POST',{id:savePlaceId,label,addressText:text,icon:event.target.elements.icon.value||'OTHER',latitude:point?.latitude??null,longitude:point?.longitude??null});if(generation!==placesEpoch)return;savePlaceId='';$('save-place-note').textContent='تم حفظ المكان';await loadPlaces(true);}
  catch(e){if(generation===placesEpoch)$('save-place-note').textContent=customerMessage(e.message,'تعذر حفظ المكان. حاول مرة أخرى.');}
  finally{saveBusy=false;if(button)button.disabled=false;}
});
$('journey-map').ontoggle=()=>{if($('journey-map').open)void updateHomeMap();};
// Native dialogs handle focus trapping. This also supports an older showModal-less browser.
document.addEventListener('keydown',event=>{
  const panel=!$('map-picker').hidden?$('map-picker'):!$('destination-picker').hidden?$('destination-picker'):null;if(!panel)return;
  if(event.key==='Escape'){event.preventDefault();if(panel===$('map-picker'))closeMap();else $('close-destination').onclick();return;}
  if(event.key==='Tab'){const controls=[...panel.querySelectorAll('button,input,select,textarea')].filter(n=>!n.disabled&&!n.hidden&&n.getClientRects().length);if(!controls.length)return;const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
});

// Restore only the customer's own device session; Office API is never involved.
const startup=device&&device.registered!==false?$('resume').onclick():Promise.resolve();

const themeControl=$('taxi-theme'),media=matchMedia('(prefers-color-scheme: dark)');
function applyTheme(){document.documentElement.dataset.taxiTheme=themeControl.value==='system'?(media.matches?'dark':'light'):themeControl.value;}
try{themeControl.value=localStorage.getItem('dispatchpro.theme')||'system';}catch{}
applyTheme();themeControl.onchange=()=>{try{localStorage.setItem('dispatchpro.theme',themeControl.value);}catch{}applyTheme();};media.addEventListener('change',applyTheme);
$('customer-menu').onclick=()=>{if(profile){$('account-tab').onclick();$('taxi-theme').focus();}else error('سجّل الدخول لعرض إعدادات حسابك');};
$('customer-notifications').onclick=()=>{if(profile)openDialog('notification-center');else error('سجّل الدخول لمتابعة حالة الرحلة');};
$('account-tab').onclick=()=>{$('request-panel').hidden=true;$('history-panel').hidden=true;$('profile-panel').hidden=false;$('profile-details').textContent=profile?[profile.fullName,profile.phone].filter(Boolean).join(' · '):'';for(const id of ['request-tab','history-tab','account-tab']){$(id).classList.toggle('active',id==='account-tab');$(id).setAttribute('aria-current',id==='account-tab'?'page':'false');}};
for(const id of ['request-tab','history-tab']){const old=$(id).onclick;$(id).onclick=(...args)=>{$('profile-panel').hidden=true;$('account-tab').classList.remove('active');$('account-tab').removeAttribute('aria-current');return old?.(...args);};}
// Keep booking first; maps load only when the passenger opens them or a ride is active.
$('journey-map').open=true;



requestAnimationFrame(()=>{const splash=document.getElementById("brand-splash");splash?.remove();});

window.addEventListener('dispatchpro-panel-open',event=>{if(event.detail?.id!=='map-picker')closeMap();if(event.detail?.id!=='destination-picker')closeDialog('destination-picker');if(event.detail?.id!=='notification-center')closeDialog('notification-center');});
const communicationNotices=new Map();
try{$('message-sound').checked=localStorage.getItem('dispatchpro.customer.message-sound')!=='false';}catch{}
$('message-sound').onchange=()=>{try{localStorage.setItem('dispatchpro.customer.message-sound',String($('message-sound').checked));}catch{}};
$('close-notifications').onclick=()=>closeDialog('notification-center');
window.addEventListener('dispatchpro-customer-lock',()=>{communicationNotices.clear();$('notification-items').replaceChildren();closeDialog('notification-center');});
window.addEventListener('dispatchpro-communication-data',event=>{
 if(!profile)return;let newMessage=false;
 for(const item of event.detail?.chat||[]){if(!communicationNotices.has(item.id))newMessage=true;communicationNotices.set(item.id,{...item,label:'رسالة من '+(item.senderName||'السائق')+' · '+item.text,kind:'chat'});}
 for(const item of event.detail?.rideEvents||[])communicationNotices.set(item.id,{...item,label:statuses[item.status?.replace(/([a-z])([A-Z])/g,'$1_$2').toUpperCase()]||'تحديث حالة الرحلة',kind:'ride'});
 while(communicationNotices.size>50)communicationNotices.delete(communicationNotices.keys().next().value);
 const items=$('notification-items');items.replaceChildren();
 if(!communicationNotices.size){const empty=document.createElement('p');empty.textContent='لا توجد تنبيهات جديدة.';items.append(empty);}
 for(const item of [...communicationNotices.values()].reverse()){const button=document.createElement('button');button.type='button';button.className='quiet full-width';button.textContent=item.label;button.onclick=()=>{closeDialog('notification-center');if(item.kind==='chat'){pendingChatOpen=item.rideId;void openNotificationRide(item.rideId);}else void openNotificationRide(item.rideId);};items.append(button);}
 const unread=Object.values(event.detail?.unread||{}).reduce((sum,n)=>sum+(Number.isFinite(n)?n:0),0);$('customer-notifications').setAttribute('aria-label','تنبيهات الرحلة'+(unread?' · '+unread+' رسالة غير مقروءة':''));
 if(newMessage&&!window.dispatchProCustomerNative&&$('message-sound').checked&&!document.hidden&&audio?.state==='running'){const tone=audio.createOscillator(),gain=audio.createGain();tone.frequency.value=660;gain.gain.setValueAtTime(.0001,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.08,audio.currentTime+.02);gain.gain.exponentialRampToValueAtTime(.0001,audio.currentTime+.2);tone.connect(gain);gain.connect(audio.destination);tone.start();tone.stop(audio.currentTime+.22);}
});
window.addEventListener('pointerdown',()=>{if(!window.dispatchProCustomerNative)try{audio??=new AudioContext();void audio.resume();}catch{}},{once:true});
window.dispatchProCustomerBack=()=>{const call=document.querySelector?.('dialog.ride-call[open]');if(call){if(communication?.call?.caller||communication?.call?.owned)communication.minimize();return true;}const chat=document.querySelector?.('dialog.ride-chat[open]');if(chat){chat.close();return true;}if(!$('notification-center').hidden){closeDialog('notification-center');return true;}if(!$('map-picker').hidden){closeMap();return true;}if(!$('destination-picker').hidden){closeDialog('destination-picker');return true;}if(profile&&$('request-panel').hidden){$('request-tab').onclick();return true;}return false;};
if(window.visualViewport){const resize=()=>{document.documentElement.style.setProperty('--customer-viewport-height',window.visualViewport.height+'px');const keyboard=window.innerHeight-window.visualViewport.height>120;document.body.classList.toggle('keyboard-open',keyboard);if(keyboard&&document.activeElement?.matches('input,textarea'))document.activeElement.scrollIntoView({block:'nearest'});};window.visualViewport.addEventListener('resize',resize);resize();}

for(const [id,icon,label]of [['quick-home','HOME','البيت'],['quick-work','WORK','العمل']])$(id).onclick=()=>{const place=placesData.savedPlaces.find(p=>p.icon===icon);if(place){setDestination(place.addressText||place.label,place);return;}$('save-place-form').hidden=false;$('save-place-form').elements.icon.value=icon;$('save-place-form').elements.label.value=label;$('destination-query').focus();error('اكتب عنوان '+label+' في الوجهة، ثم احفظ المكان.');};
$('quick-saved').onclick=()=>{if(placesData.savedPlaces.length)$('saved-shortcuts').scrollIntoView({block:'center',behavior:'smooth'});else error('لا توجد أماكن محفوظة بعد. اختر وجهة واحفظها لاستخدامها لاحقًا.');};

function arrivalAckKey(){return key+'.arrival-acks.'+device?.accountId;}
let arrivalAckTask=null;
async function flushArrivalAcks(){if(arrivalAckTask||!profile||!navigator.onLine)return;const account=device.accountId,key=arrivalAckKey();arrivalAckTask=(async()=>{let queue=[];try{queue=JSON.parse(localStorage.getItem(key)||'[]');}catch{}for(const item of queue){if(!profile||device.accountId!==account)return;try{await api('rides/'+item.rideId+'/arrival-ack','POST',{eventId:item.eventId});}catch(e){if(![404,409].includes(e.status))continue;}let current=[];try{current=JSON.parse(localStorage.getItem(key)||'[]');}catch{}localStorage.setItem(key,JSON.stringify(current.filter(x=>x.eventId!==item.eventId)));}})();try{await arrivalAckTask;}finally{arrivalAckTask=null;}}

async function acknowledgeArrival(ride,button){if(button.disabled||!ride.arrivalEventId)return;button.disabled=true;arrivalPort?.postMessage(JSON.stringify({type:'arrival-ack',eventId:ride.arrivalEventId}));let queue=[];try{queue=JSON.parse(localStorage.getItem(arrivalAckKey())||'[]');}catch{}if(!queue.some(q=>q.eventId===ride.arrivalEventId))queue.push({rideId:ride.id,eventId:ride.arrivalEventId});localStorage.setItem(arrivalAckKey(),JSON.stringify(queue.slice(-64)));button.textContent='تم إيقاف تذكيرات هذا الهاتف';await flushArrivalAcks();if(profile)watch();}

$('history-current').onclick=()=>{historyCurrent=true;$('history-paging').hidden=true;$('history-current').classList.add('active');$('history-past').classList.remove('active');historyTask++;list('history',lastRides.filter(r=>!['COMPLETED','CANCELLED','NO_DRIVER_AVAILABLE'].includes(r.rideStatus||r.status)));};
$('history-past').onclick=()=>{page=1;void history();};

$('enable-arrival-alerts').onclick=()=>{if(arrivalPort){arrivalPort.postMessage(JSON.stringify({type:'notification-permission'}));$('arrival-permission-note').textContent='تحكم بالصوت والاهتزاز من إعدادات تنبيهات الهاتف.';}else if('Notification' in window){void Notification.requestPermission().then(p=>{$('arrival-permission-note').textContent=p==='granted'?'التنبيهات مفعلة أثناء فتح التطبيق.':'اسمح بالتنبيهات من إعدادات المتصفح.';});}else $('arrival-permission-note').textContent='تنبيهات الخلفية تحتاج إعداد التطبيق على جهازك.';};

$('ride-form').addEventListener('input',()=>syncDestinationLabel());
