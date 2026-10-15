"use client";
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {useOfficeAuth} from '@/hooks/use-office-auth';
import {apiReceptionBackend as api} from '@/lib/reception-api';
import {receptionError} from '@/lib/reception-feedback';
import {TaxiTheme} from './taxi-theme';
export function LoginForm(){
 const auth=useOfficeAuth(),router=useRouter();
 const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[remember,setRemember]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(auth.authReady&&auth.authenticated)router.replace('/office/orders');},[auth.authReady,auth.authenticated,router]);
 if(!auth.authReady||auth.authenticated)return <div role="status">جارٍ استعادة جلسة المكتب…</div>;
 return <main dir="rtl" className="taxi-login taxi-surface"><section className="taxi-login-card"><img src="/customer-mobile/office-logo.webp" width="112" height="112" alt="تكسي نابلس والمهندس"/><h1>نظام إدارة المكتب</h1><p>مرحبًا بك، ابدأ يوم العمل</p><form onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{await api.login('',username,password,remember);setPassword('');router.replace('/office/orders');}catch(e){setError(receptionError(e));}finally{setBusy(false);}}}><label>اسم المستخدم<input required autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} maxLength={100}/></label><label>كلمة المرور<input required type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} maxLength={512}/></label><label className="taxi-remember"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/>تذكرني</label>{error&&<p role="alert" className="taxi-error">{error}</p>}<button disabled={busy} type="submit">{busy?'جارٍ تسجيل الدخول…':'تسجيل الدخول'}</button></form><TaxiTheme/></section><aside className="taxi-login-art" aria-label="تكسي نابلس والمهندس"><img src="/customer-mobile/office-logo.webp" alt=""/><div><h2>تكسي نابلس والمهندس</h2><p>ثقة · أمان · دائمًا معكم</p></div></aside></main>;
}
