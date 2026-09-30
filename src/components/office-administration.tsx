"use client";
import {useEffect, useState} from 'react';
import Link from 'next/link';
import {apiReceptionBackend as api} from '@/lib/reception-api';

type Access={actorId:string;tenantId:string;permissions:string[]};
type Account={id:string;username:string;roleId:string;active:boolean};
type Role={id:string;name:string;codes:string[]};
type Office={id:string;name:string;timeZone:string;officeWhatsAppNumber:string};
type Notice={id:string;action:string;createdAt:string;entityId:string};
const input='block w-full rounded border p-2';
const button='rounded border px-3 py-2 disabled:opacity-40';
const labels:Record<string,string>={'users.write':'إدارة المستخدمين والأدوار','settings.write':'إعدادات المكتب','rides.read':'عرض الطلبات والتقارير','rides.write':'إدارة الطلبات والدور','rides.drive':'صلاحيات السائق','customers.read':'عرض العملاء','customers.write':'إدارة العملاء','pricing.read':'عرض الأسعار','pricing.write':'إدارة الأسعار','pricing.adjust':'تعديل الأجرة','audit.read':'سجل النشاط والتنبيهات','reception.ingest':'إدخال مكالمات المكتب'};
export function OfficeAdministration(){
 const [access,setAccess]=useState<Access|null>(null),[tab,setTab]=useState('office');
 const [users,setUsers]=useState<Account[]>([]),[total,setTotal]=useState(0),[roles,setRoles]=useState<Role[]>([]),[codes,setCodes]=useState<string[]>([]),[offices,setOffices]=useState<Office[]>([]);
 const [search,setSearch]=useState(''),[page,setPage]=useState(1),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
 const [user,setUser]=useState<Account|null>(null),[username,setUsername]=useState(''),[password,setPassword]=useState(''),[roleId,setRoleId]=useState(''),[active,setActive]=useState(true);
 const [role,setRole]=useState<Role|null>(null),[roleName,setRoleName]=useState(''),[selectedCodes,setSelectedCodes]=useState<string[]>([]);
 const [office,setOffice]=useState<Office|null>(null),[notices,setNotices]=useState<Notice[]>([]),[seen,setSeen]=useState<string[]>([]);
 const can=(permission:string)=>access?.permissions.includes(permission);
 useEffect(()=>{let live=true;void api.administration<Access>('administration/access').then(a=>{if(live)setAccess(a);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[]);
 useEffect(()=>{
  if(!access)return;let live=true;setLoading(true);setError('');
  const timer=setTimeout(()=>{void (async()=>{
   if(tab==='users'||tab==='roles'){
    if(!access.permissions.includes('users.write'))return;
    const r=await api.administration<{roles:Role[];codes:string[]}>('administration/roles');if(live){setRoles(r.roles);setCodes(r.codes);}
    if(tab==='users'){const u=await api.administration<{items:Account[];total:number}>(`administration/users?search=${encodeURIComponent(search)}&page=${page}`);if(live){setUsers(u.items);setTotal(u.total);}}
   }else if(tab==='office'&&access.permissions.includes('settings.write')){const o=await api.administration<Office[]>('offices');if(live)setOffices(o);}
   else if(tab==='notifications'&&access.permissions.includes('audit.read')){const n=await api.administration<Notice[]>('administration/notifications');if(live){setNotices(n);try{setSeen(JSON.parse(sessionStorage.getItem(`office-notices:${access.tenantId}:${access.actorId}`)??'[]'));}catch{setSeen([]);}}}
  })().catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoading(false);});},search?180:0);
  return()=>{live=false;clearTimeout(timer);};
 },[access,tab,search,page,revision]);
 const save=async(work:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');setSuccess('');try{await work();setSuccess('تم الحفظ');setRevision(r=>r+1);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const editUser=(u:Account|null)=>{setUser(u);setUsername(u?.username??'');setPassword('');setRoleId(u?.roleId??roles[0]?.id??'');setActive(u?.active??true);};
 const editRole=(r:Role|null)=>{setRole(r);setRoleName(r?.name??'');setSelectedCodes(r?.codes??[]);};
 return <main dir="rtl" className="h-full space-y-4 overflow-auto p-5"><h1 className="text-2xl font-bold">إدارة المكتب والإعدادات</h1>
  <nav className="flex flex-wrap gap-2">{[['office','المكتب والمواقع'],['users','المستخدمون'],['roles','الأدوار والصلاحيات'],['notifications','التنبيهات الداخلية']].map(([key,label])=><button key={key} className={button} aria-pressed={tab===key} onClick={()=>{setTab(key);setError('');setSuccess('');}}>{label}</button>)}</nav>
  {error&&<p role="alert" className="text-red-700">{error}</p>}{success&&<p role="status">{success}</p>}{loading&&<p role="status">جارٍ التحميل…</p>}
  {!access&&!error&&<p>جارٍ التحقق من الصلاحيات…</p>}
  {access&&!can(tab==='office'?'settings.write':tab==='notifications'?'audit.read':'users.write')&&<p>ليس لديك صلاحية إدارة هذا القسم. تواصل مع مدير المكتب.</p>}
  {tab==='office'&&can('settings.write')&&<section className="space-y-3"><h2 className="font-bold">المكتب</h2>{offices.map(o=><button key={o.id} className={button} onClick={()=>setOffice({...o})}>{o.name}</button>)}<button className={button} onClick={()=>setOffice({id:'',name:'',timeZone:'Asia/Jerusalem',officeWhatsAppNumber:''})}>إضافة مكتب</button>
   {office&&<form className="max-w-lg space-y-3" onSubmit={e=>{e.preventDefault();void save(async()=>{await api.administration(`offices${office.id?'/'+office.id:''}`,office.id?'PUT':'POST',{...office,id:office.id||undefined});setOffice(null);});}}><label>اسم المكتب<input required maxLength={150} className={input} value={office.name} onChange={e=>setOffice({...office,name:e.target.value})}/></label><label>المنطقة الزمنية<input required className={input} value={office.timeZone} onChange={e=>setOffice({...office,timeZone:e.target.value})}/></label><button disabled={busy} className={button}>حفظ المكتب</button></form>}
   <h2 className="pt-4 font-bold">المواقع</h2><p>إضافة المواقع وتعديلها وتفعيلها متاحة في إدارة الدور الحالية.</p><Link className="inline-block rounded border p-2" href="/office/queue">إدارة المواقع</Link>
  </section>}
  {tab==='users'&&can('users.write')&&<section className="space-y-3"><label>بحث المستخدمين<input className={input} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></label><p>إجمالي المستخدمين: {total}</p><button className={button} onClick={()=>editUser(null)}>مستخدم جديد</button>
   <table className="w-full text-right"><thead><tr><th>المستخدم</th><th>الدور</th><th>الحالة</th><th>تعديل</th></tr></thead><tbody>{users.map(u=><tr key={u.id}><td>{u.username}</td><td>{roles.find(r=>r.id===u.roleId)?.name??'—'}</td><td>{u.active?'نشط':'معطّل'}</td><td><button className={button} onClick={()=>editUser(u)}>تعديل</button></td></tr>)}</tbody></table>
   <div className="flex gap-3"><button className={button} disabled={page===1||loading} onClick={()=>setPage(p=>p-1)}>السابق</button><span>صفحة {page}</span><button className={button} disabled={page*50>=total||loading} onClick={()=>setPage(p=>p+1)}>التالي</button></div>
   <form className="max-w-lg space-y-3 rounded border p-4" onSubmit={e=>{e.preventDefault();void save(async()=>{if(user)await api.administration(`administration/users/${user.id}`,'PUT',{roleId,active});else await api.administration('users','POST',{username,password,roleId});editUser(null);});}}>
    <h2>{user?'تعديل المستخدم':'إضافة مستخدم'}</h2><label>اسم المستخدم<input required maxLength={100} disabled={!!user} className={input} value={username} onChange={e=>setUsername(e.target.value)}/></label>
    {!user&&<label>كلمة المرور (14 حرفًا على الأقل)<input required minLength={14} maxLength={512} type="password" autoComplete="new-password" className={input} value={password} onChange={e=>setPassword(e.target.value)}/></label>}
    <label>الدور<select required className={input} value={roleId} onChange={e=>setRoleId(e.target.value)}><option value="">اختر الدور</option>{roles.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
    {user&&<label><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/> حساب نشط</label>}<button disabled={busy} className={button}>حفظ المستخدم</button>
   </form>
  </section>}
  {tab==='roles'&&can('users.write')&&<section className="space-y-3">{roles.map(r=><button key={r.id} className={button} onClick={()=>editRole(r)}>{r.name}</button>)}<button className={button} onClick={()=>editRole(null)}>دور جديد</button>
   <form className="max-w-xl space-y-3 rounded border p-4" onSubmit={e=>{e.preventDefault();void save(async()=>{let id=role?.id;if(!id){const r=await api.administration<Role>('roles','POST',{name:roleName});id=r.id;setRole({...r,codes:[]});}await api.administration(`administration/roles/${id}`,'PUT',{name:roleName,codes:selectedCodes});editRole(null);});}}><label>اسم الدور<input required maxLength={100} className={input} value={roleName} onChange={e=>setRoleName(e.target.value)}/></label><div className="grid gap-2 sm:grid-cols-2">{codes.map(code=><label key={code}><input type="checkbox" checked={selectedCodes.includes(code)} onChange={e=>setSelectedCodes(c=>e.target.checked?[...c,code]:c.filter(x=>x!==code))}/> {labels[code]??code}</label>)}</div><button disabled={busy} className={button}>حفظ الصلاحيات</button></form>
  </section>}
  {tab==='notifications'&&can('audit.read')&&<section className="space-y-3"><p>آخر 50 حدثًا في المكتب · غير المقروء: {notices.filter(n=>!seen.includes(n.id)).length}</p><p className="text-sm text-slate-500">سجل نشاط داخلي. حالة القراءة محفوظة لهذه الجلسة؛ لا إرسال خارجي.</p><button className={button} disabled={loading} onClick={()=>setRevision(r=>r+1)}>تحديث</button><button className={button} onClick={()=>{const ids=notices.map(n=>n.id);setSeen(ids);try{sessionStorage.setItem(`office-notices:${access!.tenantId}:${access!.actorId}`,JSON.stringify(ids));}catch{setError('تعذر حفظ حالة القراءة لهذه الجلسة');}}}>تعليم الكل كمقروء</button>{notices.map(n=><article key={n.id} className={`rounded border p-3 ${seen.includes(n.id)?'':'bg-blue-50'}`}><p>{n.action}</p><time>{new Date(n.createdAt).toLocaleString('ar',{timeZone:'Asia/Jerusalem'})}</time><details><summary>تفاصيل الحدث</summary><bdi>{n.entityId}</bdi></details></article>)}{!loading&&!notices.length&&<p>لا توجد تنبيهات.</p>}</section>}
 </main>;
}
