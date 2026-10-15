import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useVoice,PttButton} from '../../src/components/ptt-control';
import {RideCommunicationControl,RideCallButton} from '../../src/components/ride-communication';
import {RideChat} from '../../src/components/ride-chat';
import {enableQaBrowserSound} from '../../src/lib/qa-audio.js';
const fixture=(window as any).qaFixture;
function Station(){
 const [audioOn,setAudioOn]=useState(false);const [role,setRole]=useState('office'),[password,setPassword]=useState(''),[token,setToken]=useState(''),[note,setNote]=useState(''),[rides,setRides]=useState<any[]>([]),[creating,setCreating]=useState(false),[timed,setTimed]=useState(false);
 const user=role==='office'?fixture.officeUser:fixture.peerUser;
 const request=React.useCallback(async(path:string,method='GET',body?:unknown,signal?:AbortSignal)=>{const r=await fetch('/api/v1/'+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:body?JSON.stringify(body):undefined,signal});if(!r.ok)throw Error('تعذر تنفيذ طلب QA: '+r.status);return r.json();},[token]);
 const peerRequest=React.useCallback((path:string,method?:string,body?:unknown,signal?:AbortSignal)=>request('customer-app/'+path,method,body,signal),[request]);
 const officeCommunication=React.useCallback((path:string,method?:string,body?:unknown,signal?:AbortSignal)=>request('office-qa/'+path,method,body,signal),[request]);
 const voice=useVoice(token&&role==='office'?request:undefined,true,false);
 useEffect(()=>{if(!token)return;let active=true;let timer:ReturnType<typeof setTimeout>;const update=async()=>{try{const data=await request(role==='office'?'reception/snapshot':'customer-app/updates');if(active)setRides(data.rides??[]);}catch{if(active)setNote('تعذر تحديث بيانات الاختبار');}finally{if(active)timer=setTimeout(update,3000);}};void update();return()=>{active=false;clearTimeout(timer);};},[token,role,request]);
 async function createFixture(){
  if(creating)return;setCreating(true);
  try{
   const status=await fetch('/qa/status').then(r=>r.json());if(status.environment!=='DriverQa')throw Error('هذه ليست بيئة QA');
   const before=await request('reception/snapshot');
   if(before.rides.some((r:any)=>!['completed','cancelled','waiting'].includes(r.status)))throw Error('أنه الطلب التجريبي السابق أولًا من مكتب QA');
   const created=await request('ride-requests','POST',{customerId:fixture.customerId,destination:'وجهة اختبار عامة — نابلس',source:'MANUAL',location:{addressText:'نقطة اختبار عامة — نابلس',latitude:32.2211,longitude:35.2544,locationSource:'MAP_PIN'},notes:'QA ONLY — synthetic coordinates; no real customer'});
   const snapshot=await request('reception/snapshot'),row=snapshot.rides.find((r:any)=>r.rideRequestId===created.rideRequestId);
   if(!row)throw Error('أنشئ الطلب في QA لكنه لم يظهر في المكتب؛ لا تكرر الإنشاء قبل المراجعة');
   await request('reception/rides/'+row.id,'PUT',{...row,totalFare:25,fareMode:'OFFICE_MANUAL',dropoff:{name:'وجهة اختبار عامة — نابلس',coords:{x:32.225,y:35.261}}});
   const fresh=await request('rides/'+created.id);
   const assigned=timed?await request('dispatch/rides/'+created.id+'/mode','PUT',{mode:'AUTO_NEAREST',version:fresh.ride.version}):await request('rides/'+created.id+'/assignment','PUT',{driverId:fixture.driverId,version:fresh.ride.version});
   setNote(assigned.status==='Assigned'?'أرسل الطلب الوهمي بسعر 25 إلى سائق QA فقط':'الطلب موجود في QA؛ تحقق من جاهزية السائق وGPS في لوحة المكتب');
  }catch(e){setNote((e as Error).message+' — راجع مكتب QA قبل إعادة المحاولة');}
  finally{setCreating(false);}
 }
 return <main dir="rtl" style={{maxWidth:720,margin:'auto',padding:24}}><h1 style={{fontSize:24,fontWeight:700}}>محطة اختبار DispatchPro QA</h1><p>هذه بيئة وهمية منفصلة. لا تستخدم بيانات أو أرقام عملاء. لا يبدأ الإرسال الصوتي حتى الضغط ومنح الموجة.</p>
 {!token?<form onSubmit={async e=>{e.preventDefault();try{const r=await fetch('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenant:fixture.tenant,username:user,password})});if(!r.ok)throw Error('بيانات حساب الاختبار غير صحيحة');const data=await r.json();setToken(data.accessToken);setPassword('');}catch(e){setNote((e as Error).message);}}}><label>طرف الاختبار<select value={role} onChange={e=>setRole(e.target.value)}><option value="office">مكتب الاختبار — مخشير عام وخاص</option><option value="peer">راكب وهمي — مكالمة ورسائل الرحلة</option></select></label><p>الحساب: {user}</p><label>كلمة مرور حساب QA<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><button>دخول الاختبار</button></form>:<>
 <button onClick={()=>{setToken('');setRides([]);enableQaBrowserSound(false);setAudioOn(false);}}>إغلاق جلسة هذه الصفحة</button>
 {role==='office'?<section><h2>المخشير مع سائق QA</h2><button onClick={()=>{enableQaBrowserSound(!audioOn);setAudioOn(!audioOn);if(typeof Notification!=='undefined')void Notification.requestPermission().catch(()=>{});}}>{audioOn?'كتم صوت مكتب QA':'تفعيل صوت مكتب QA'}</button><RideCommunicationControl request={officeCommunication as any} rides={[{id:fixture.driverId,status:"Accepted"}]}/><RideCallButton rideId={fixture.driverId} label="مكالمة داخلية إلى سائق QA"/><RideChat rideId={fixture.driverId} request={officeCommunication as any} label="محادثة سائق QA"/><p>{voice.status.message}</p><button onClick={()=>void voice.client?.prepareMicrophone()}>تجهيز ميكروفون المكتب</button><div style={{display:'flex',gap:12}}><PttButton client={voice.client} status={voice.status} channel="public" label="عام QA — اضغط مطولًا">عام — اضغط مطولًا</PttButton><PttButton client={voice.client} status={voice.status} channel="private" driverId={fixture.driverId} label="خاص QA — اضغط مطولًا">خاص بسائق QA</PttButton></div><p>قبل إنشاء الطلب: افتح تطبيق QA على الهاتف وتأكد من حساب الاختبار والجاهزية. إنشاء الطلب هنا يؤثر على قاعدة QA فقط.</p><label style={{display:'block'}}><input type="checkbox" style={{display:'inline',width:'auto',minHeight:'auto',marginLeft:8}} checked={timed} onChange={e=>setTimed(e.target.checked)}/>عرض بمهلة الخادم — يحتاج GPS حديثًا وسائقًا متاحًا</label><button disabled={creating} onClick={()=>void createFixture()}>{creating?'جارٍ تجهيز طلب QA…':'إرسال طلب وهمي بسعر 25 إلى سائق QA'}</button><a href="/office" target="_blank">فتح لوحة مكتب الاختبار</a></section>:<>
 <RideCommunicationControl request={peerRequest as any} rides={rides}/>
 {rides.map(ride=><article key={ride.id}><h2>{ride.pickup||'رحلة اختبار'}</h2><p>{ride.status}</p>{['Accepted','DriverArriving','Arrived','InProgress'].includes(ride.status)&&<><button onClick={()=>window.dispatchEvent(new CustomEvent('dispatchpro-call-start',{detail:{rideId:ride.id}}))}>مكالمة داخلية إلى سائق QA</button><RideChat rideId={ride.id} request={peerRequest as any}/></>}</article>)}
 <p>هذا القسم يختبر مسار الراكب والسائق القائم. مكتب QA له قناة داخلية مستقلة أعلاه دون تغيير صلاحيات الراكب.</p></>}
 <details><summary>بيانات الحالة الوهمية</summary><pre style={{whiteSpace:'pre-wrap',direction:'ltr',fontSize:12}}>{JSON.stringify(rides.map(r=>({id:r.id,status:r.status,version:r.version})),null,2)}</pre></details></>}
 <p role="status">{note}</p></main>;
}
createRoot(document.getElementById('app')!).render(<Station/>);

