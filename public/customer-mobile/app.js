import { createMap, createJourneyMap } from './maps.js';
const $=id=>document.getElementById(id);
const key='dispatchpro.customer.device.v1';
const statuses={NO_DRIVER_AVAILABLE:'لا يوجد سائق متاح حاليًا؛ حاول طلب رحلة لاحقًا',DRIVER_ASSIGNED:'تم العثور على سائق',DRIVER_ARRIVING:'السائق في الطريق إليك',DRIVER_ARRIVED:'وصل السائق',IN_TRIP:'الرحلة جارية',REJECTED:'رفض السائق؛ بانتظار إعادة الإرسال من المكتب',SEARCHING_DRIVER:'جارٍ البحث عن أقرب سائق',OFFERED:'بانتظار رد السائق',REQUESTED:'تم استلام الطلب',ASSIGNED:'تم إرسال الطلب للسائق',ACCEPTED:'وافق السائق',ARRIVED:'وصل السائق',IN_PROGRESS:'الرحلة جارية',COMPLETED:'تمت الرحلة بنجاح',CANCELLED:'تم إلغاء الطلب'};
let device,token='',profile,controller,timer,cursor='',delay=1500,epoch=0,page=1,gps=null,destinationGps=null,busy=false,loginTask,activeRide=null;
let homeMap,homeMapTask,customerPoint=null,confirmed=false,reviewing=false,mapGeneration=0,mapFocus='';
try{device=JSON.parse(localStorage.getItem(key)||'null');}catch{}
const pendingKey=()=>key+'.ride.'+device.accountId;
function error(message=''){$('error').textContent=message;$('error').hidden=!message;}
function connection(message){$('connection').textContent=message;}
async function raw(route,method='GET',body,signal){const response=await fetch('/api/customer/'+route,{method,cache:'no-store',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(35000)]):AbortSignal.timeout(15000)});const data=await response.json().catch(()=>({}));if(!response.ok){const e=new Error(data.detail||data.error||(response.status===401?'انتهت الجلسة. افتح حسابك مجددًا.':'تعذر إتمام الطلب'));e.status=response.status;throw e;}return data;}
async function login(){if(!loginTask)loginTask=raw('login','POST',{tenant:device.tenant,username:'customer-'+device.accountId.replaceAll('-',''),password:device.deviceSecret}).then(result=>{token=result.accessToken;}).finally(()=>{loginTask=null;});return loginTask;}
async function api(route,method='GET',body,signal){try{return await raw(route,method,body,signal);}catch(e){if(e.status!==401||!profile)throw e;await login();return raw(route,method,body,signal);}}
function buttonBusy(value){busy=value;document.querySelectorAll('form button,#resume,#confirm-ride,#edit-ride').forEach(b=>b.disabled=value||!navigator.onLine);$('request-ride').disabled=value||!navigator.onLine||!!activeRide&&!(device&&localStorage.getItem(pendingKey()));$('active-request-note').hidden=!activeRide;}
function card(ride){
  const article=document.createElement('article');article.className='card'+((ride.rideStatus||ride.status)==='COMPLETED'?' complete':'');
  const badge=document.createElement('span');badge.className='badge';badge.textContent=statuses[ride.rideStatus||ride.workflowStatus||ride.status]||ride.status;article.append(badge);
  const title=document.createElement('h3');title.textContent=ride.pickup+' ← '+ride.destination;article.append(title);
  const add=text=>{const p=document.createElement('p');p.textContent=text;article.append(p);};
  add(new Date(ride.createdAt).toLocaleString('ar-PS'));
  if(ride.scheduledAt)add('الحجز: '+new Date(ride.scheduledAt).toLocaleString('ar-PS'));
  if(ride.driver){add('السائق: '+ride.driver.fullName);if(ride.driver.phone){const call=document.createElement('a');call.href='tel:'+ride.driver.phone;call.textContent='اتصال بالسائق · '+ride.driver.phone;article.append(call);}}
  if(ride.vehicle)add('السيارة: '+[ride.vehicle.make,ride.vehicle.model,ride.vehicle.color,ride.vehicle.plate].filter(Boolean).join(' · '));
  if(ride.tracking){
    if(ride.tracking.distanceMeters!=null)add('المسافة إلى السائق: '+(ride.tracking.distanceMeters/1000).toFixed(1)+' كم');
    if(ride.tracking.etaMinutes)add('الوصول التقريبي: '+ride.tracking.etaMinutes+' دقيقة');
    add('آخر موقع: '+new Date(ride.tracking.updatedAt).toLocaleTimeString('ar'));

  }else if(ride.driver&&!['COMPLETED','CANCELLED'].includes(ride.status))add('موقع السائق غير متاح أو قديم');
  if(!['IN_PROGRESS','IN_TRIP','COMPLETED','CANCELLED'].includes(ride.rideStatus||ride.workflowStatus||ride.status)){
    const cancel=document.createElement('button');cancel.type='button';cancel.className='quiet';cancel.textContent='إلغاء الطلب';
    cancel.onclick=()=>void cancelRide(ride,cancel);article.append(cancel);
  }
  return article;
}
async function cancelRide(ride,button){
  if(button.disabled)return;
  button.disabled=true;error();
  try{await api('rides/'+encodeURIComponent(ride.id)+'/cancel','POST',{});cursor='';watch();}
  catch(e){error(e.message);button.disabled=false;}
}
const liveMaps=new Map();
function list(id,rides){if(id==='rides')for(const [key,view] of liveMaps){if(!rides.some(r=>r.id===key&&r.tracking)){view.map.remove();liveMaps.delete(key);}}const target=$(id);target.replaceChildren();if(!rides.length){const p=document.createElement('p');p.className='muted';p.textContent='لا توجد رحلات بعد';target.append(p);}else rides.forEach(r=>target.append(card(r)));}
function journeyPoints(ride){return {customer:customerPoint,pickup:ride?.pickupLocation||gps,destination:ride?.destinationLocation||destinationGps,driver:ride?.tracking};}
async function updateHomeMap(ride=activeRide){
  if(!profile)return;
  const generation=mapGeneration;try{if(!homeMapTask)homeMapTask=createJourneyMap($('home-map'),journeyPoints(ride)).then(view=>{if(generation!==mapGeneration){view.map.remove();return null;}return homeMap=view;});const view=await homeMapTask;if(!view||generation!==mapGeneration)return;view.update(journeyPoints(ride));const focus=ride?.tracking?ride.id+':driver':ride?.id||'draft';if(focus!==mapFocus){mapFocus=focus;view.fit();}$('home-map-error').hidden=true;requestAnimationFrame(()=>view.map.resize());}
  catch(e){homeMapTask=null;$('home-map-error').hidden=false;$('home-map-error').textContent='الخريطة غير متاحة مؤقتًا. يمكنك كتابة العنوان واستخدام تحديد الموقع.';}
}
function showJourney(ride){const state=ride?.rideStatus||ride?.status;const banner=$('journey-status');banner.hidden=!ride;banner.textContent=ride?(statuses[state]||state):'';banner.className='journey-status'+(['SEARCHING_DRIVER','OFFERED','REQUESTED'].includes(state)?' searching':'');$('ride-form').hidden=!!activeRide||reviewing;$('ride-summary').hidden=!!activeRide||!reviewing;void updateHomeMap(ride);}
$('fit-map').onclick=()=>{if(homeMap)homeMap.fit();else void updateHomeMap();};
function stop(){epoch++;controller?.abort();clearTimeout(timer);}
function watch(){stop();if(!profile||document.hidden||!navigator.onLine)return;const run=epoch;controller=new AbortController();const signal=controller.signal;async function poll(){try{const result=await api('updates?cursor='+encodeURIComponent(cursor),'GET',undefined,signal);if(signal.aborted||run!==epoch)return;cursor=result.cursor;activeRide=result.rides.find(r=>!['COMPLETED','CANCELLED','NO_DRIVER_AVAILABLE'].includes(r.rideStatus||r.status)&&!r.scheduledAt)||null;buttonBusy(busy);list('rides',result.rides);showJourney(activeRide||result.rides[0]);connection('متصل بخدمة الرحلات');delay=1500;const active=result.rides.some(r=>!['COMPLETED','CANCELLED'].includes(r.rideStatus||r.status));timer=setTimeout(poll,active?200:60000);}catch(e){if(signal.aborted||run!==epoch)return;connection('إعادة الاتصال…');if(e.status===401||e.status===403){lock();error(e.message);return;}delay=Math.min(delay*2,60000);timer=setTimeout(poll,delay);}}void poll();}
function setPending(){let pending=null;try{pending=JSON.parse(localStorage.getItem(pendingKey())||'null');}catch{}$('pending-note').hidden=!pending;const form=$('ride-form');for(const field of form.querySelectorAll('input,select,textarea'))field.disabled=!!pending;if(pending){form.elements.pickup.value=pending.pickup.addressText;form.elements.destination.value=pending.destination;form.elements.notes.value=pending.notes||'';}return pending;}
async function opened(){profile=await raw('me');$('welcome').hidden=true;$('account').hidden=false;$('name').textContent='أهلًا، '+profile.fullName;const pending=setPending();cursor='';error();watch();void updateHomeMap();if(!pending&&!gps)$('locate').onclick();}
function lock(){stop();profile=null;token='';activeRide=null;$('welcome').hidden=false;$('account').hidden=true;$('register').hidden=!!device;$('returning').hidden=!device;list('rides',[]);list('history',[]);mapGeneration++;mapFocus='';reviewing=false;homeMap?.map.remove();homeMap=null;homeMapTask=null;connection('الحساب مقفل');}
$('register').elements.tenant.value=new URL(location.href).searchParams.get('office')||'';
$('register').hidden=!!device;$('returning').hidden=!device;
$('register').addEventListener('submit',async event=>{event.preventDefault();if(busy)return;buttonBusy(true);error();try{const values=Object.fromEntries(new FormData(event.target));device={tenant:values.tenant.trim(),accountId:crypto.randomUUID(),deviceSecret:Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join(''),fullName:values.fullName.trim(),phone:values.phone.trim(),registered:false};localStorage.setItem(key,JSON.stringify(device));const result=await raw('register','POST',device);token=result.accessToken;device.registered=true;localStorage.setItem(key,JSON.stringify(device));await opened();}catch(e){error(e.message);if(e.status===400||e.status===409){localStorage.removeItem(key);device=null;}else{$('register').hidden=true;$('returning').hidden=false;}}finally{buttonBusy(false);}});
$('resume').onclick=async()=>{if(busy)return;buttonBusy(true);error();try{if(!device.registered){const result=await raw('register','POST',device);token=result.accessToken;device.registered=true;localStorage.setItem(key,JSON.stringify(device));}else await login();await opened();}catch(e){error(e.message);}finally{buttonBusy(false);}};
$('lock').onclick=lock;
$('recover').onclick=()=>{$('register').hidden=false;$('returning').hidden=true;error();};
$('ride-form').elements.when.onchange=event=>{$('schedule-label').hidden=event.target.value!=='later';$('schedule-note').hidden=event.target.value!=='later';$('ride-form').elements.scheduledAt.required=event.target.value==='later';};
$('ride-form').elements.destination.oninput=()=>{void updateHomeMap();};
$('ride-form').elements.pickup.oninput=()=>{$('gps-note').textContent=gps?'العنوان يصف النقطة المحددة؛ لتغيير الموقع استخدم الخريطة.':'حدد نقطة الانطلاق على الخريطة أو استخدم موقعي الحالي.';};
$('locate').onclick=()=>{if(!navigator.geolocation){error('تحديد الموقع غير متاح. اكتب العنوان.');return;}$('locate').disabled=true;navigator.geolocation.getCurrentPosition(position=>{gps={latitude:position.coords.latitude,longitude:position.coords.longitude};customerPoint={...gps};void updateHomeMap().then(()=>homeMap?.fit());$('gps-note').textContent='تم تحديد الموقع. أضف معلمًا واضحًا إن أمكن.';if(!$('ride-form').elements.pickup.value)$('ride-form').elements.pickup.value='موقعي الحالي';$('locate').disabled=false;},()=>{error('تعذر تحديد الموقع. اسمح بالموقع أو اختر نقطة الانطلاق على الخريطة.');$('locate').disabled=false;},{enableHighAccuracy:true,timeout:10000,maximumAge:15000});};
$('ride-form').addEventListener('submit',async event=>{event.preventDefault();if(busy||activeRide&&!localStorage.getItem(pendingKey()))return;if(!confirmed&&!setPending()){if(!gps){error('اسمح بتحديد موقعك أو اختر نقطة الانطلاق على الخريطة للبحث عن أقرب سائق');return;}showSummary();return;}confirmed=false;buttonBusy(true);$('confirm-ride').disabled=true;error();try{let body=setPending();if(!body){if(!gps)throw Error('اسمح بتحديد موقعك أو اختر نقطة الانطلاق على الخريطة للبحث عن أقرب سائق');const values=Object.fromEntries(new FormData(event.target));const scheduledAt=values.when==='later'?new Date(values.scheduledAt).toISOString():null;if(scheduledAt&&Date.parse(scheduledAt)<=Date.now())throw Error('اختر موعدًا في المستقبل');body={id:crypto.randomUUID(),pickup:{addressText:values.pickup.trim(),locationSource:gps?.locationSource|| (gps?'CUSTOMER_GPS':'MANUAL_TEXT'),...gps},destination:values.destination.trim(),destinationLocation:destinationGps?{addressText:values.destination.trim(),...destinationGps}:null,notes:values.notes.trim(),scheduledAt};localStorage.setItem(pendingKey(),JSON.stringify(body));}const created=await api('rides','POST',body);reviewing=false;$('ride-summary').hidden=true;if(!body.scheduledAt){activeRide={...created,pickup:body.pickup.addressText,destination:body.destination,rideStatus:created.rideStatus||'SEARCHING_DRIVER',pickupLocation:body.pickup,destinationLocation:body.destinationLocation};showJourney(activeRide);}localStorage.removeItem(pendingKey());const pickupLabel=body.pickup.addressText;event.target.reset();destinationGps=null;if(gps)event.target.elements.pickup.value=pickupLabel;$('schedule-label').hidden=true;$('schedule-note').hidden=true;event.target.elements.scheduledAt.required=false;cursor='';watch();}catch(e){error(e.message);if([400,403,404,409].includes(e.status))localStorage.removeItem(pendingKey());}finally{setPending();buttonBusy(false);$('confirm-ride').disabled=false;}});
async function history(){try{const result=await api('history?page='+page);list('history',result.items);$('page').textContent=String(page);$('previous').disabled=page===1;$('next').disabled=page*20>=result.total;}catch(e){error(e.message);}}
$('history-tab').onclick=()=>{$('history-panel').hidden=false;$('request-panel').hidden=true;$('history-tab').classList.add('active');$('request-tab').classList.remove('active');page=1;void history();};
$('request-tab').onclick=()=>{$('history-panel').hidden=true;$('request-panel').hidden=false;$('request-tab').classList.add('active');$('history-tab').classList.remove('active');requestAnimationFrame(()=>homeMap?.map.resize());};
$('previous').onclick=()=>{if(page>1){page--;void history();}};$('next').onclick=()=>{page++;void history();};
document.addEventListener('visibilitychange',()=>document.hidden?stop():watch());
window.addEventListener('offline',()=>{stop();connection('لا يوجد اتصال');buttonBusy(busy);});window.addEventListener('online',()=>{connection('جارٍ الاتصال');buttonBusy(busy);watch();});
buttonBusy(false);
if('serviceWorker'in navigator&&window.isSecureContext)navigator.serviceWorker.register('./sw.js').catch(()=>{});

let picker;
async function pickLocation(target){
  if(busy||activeRide||setPending())return;
  const panel=$('map-picker');panel.hidden=false;$('map-title').textContent=target==='pickup'?'اختر نقطة الانطلاق':'اختر الوجهة';
  picker?.map.remove();picker=null;
  const point=(target==='pickup'?gps:destinationGps)||gps||{latitude:32.2211,longitude:35.2544};
  const select=point=>{if(target==='pickup'){gps=point;if(!$('ride-form').elements.pickup.value)$('ride-form').elements.pickup.value='نقطة الانطلاق على الخريطة';$('gps-note').textContent='تم تحديد نقطة الانطلاق على الخريطة';}else{destinationGps=point;if(!$('ride-form').elements.destination.value)$('ride-form').elements.destination.value='الوجهة على الخريطة';}$('map-note').textContent='تم تحديد الموقع؛ يمكنك إضافة اسم الشارع أو معلم قريب في خانة العنوان.';void updateHomeMap();};
  try{picker=await createMap($('map-canvas'),point,select);}catch(e){error(e.message);}
}
$('pick-pickup').onclick=()=>void pickLocation('pickup');
$('pick-destination').onclick=()=>void pickLocation('destination');
$('close-map').onclick=()=>{$('map-picker').hidden=true;picker?.map.remove();picker=null;};

function showSummary(){
  reviewing=true;
  const form=$('ride-form'),target=$('summary-details');target.replaceChildren();
  const add=text=>{const p=document.createElement('p');p.textContent=text;target.append(p);};
  add('الانطلاق: '+form.elements.pickup.value);add('الوجهة: '+form.elements.destination.value);
  if(gps&&destinationGps){const rad=Math.PI/180,dlat=(destinationGps.latitude-gps.latitude)*rad,dlon=(destinationGps.longitude-gps.longitude)*rad;const a=Math.sin(dlat/2)**2+Math.cos(gps.latitude*rad)*Math.cos(destinationGps.latitude*rad)*Math.sin(dlon/2)**2;add('المسافة المباشرة التقريبية: '+(6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))).toFixed(1)+' كم (ليست مسافة الطريق)');}
  add('الموعد: '+(form.elements.when.value==='later'?form.elements.scheduledAt.value.replace('T',' · '):'الآن'));
  if(form.elements.notes.value)add('ملاحظات: '+form.elements.notes.value);
  $('ride-summary').hidden=false;form.hidden=true;$('confirm-ride').focus?.();
}
$('confirm-ride').onclick=()=>{if(busy||activeRide||!navigator.onLine)return;confirmed=true;return $('ride-form').requestSubmit();};
$('edit-ride').onclick=()=>{reviewing=false;$('ride-summary').hidden=true;$('ride-form').hidden=false;confirmed=false;};
// Restore only the customer's own device session; Office API is never involved.
const startup=device?.registered?$('resume').onclick():Promise.resolve();
if(!device)$('locate').onclick();
