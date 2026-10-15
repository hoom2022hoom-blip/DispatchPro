"use client";
import {LoginForm} from './login-form';
import {useTaxiTheme} from './taxi-theme';
import {receptionError} from '@/lib/reception-feedback';

import { OfficeLiveNotifications } from './office-live-notifications';
import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Car, Users, ClipboardList, Settings, BarChart3, Contact, LogOut, Menu } from 'lucide-react';
import { apiReceptionBackend as api } from '@/lib/reception-api';
import {useOfficeAuth} from '@/hooks/use-office-auth';
import type { OfficeData } from '@/lib/office';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import { FloatingQueueWindow } from './floating-queue-window';
import { OfficeQueuePanel, reorderOfficeQueue } from './office-queue';
const OfficeContext = createContext<{ data: OfficeData | null; tenant: string; refresh: () => Promise<void>; setMapOfficeDataNeeded?:(needed:boolean)=>void; openQueueWindow?:()=>void; registerReceptionDrop?:(handler:((result:DropResult)=>void)|null)=>void }>({ data:null,tenant:'',refresh:async()=>{} });
export const useOffice = () => useContext(OfficeContext);
const navigation = [['dashboard','الرئيسية',LayoutDashboard],['orders','الاستقبال',ClipboardList],['order-history','سجل الطلبات',ClipboardList],['driver-map','خريطة السائقين',Users],['drivers','السائقون',Users],['queue','دور السائقين',Users],['vehicles','السيارات',Car],['suggested-places','المواقع المقترحة',Contact],['customers','الزبائن',Contact],['customer-history','كشف الزبون',Contact],['customer-map','خريطة العملاء',Contact],['reports','التقارير',BarChart3],['settings','الإعدادات',Settings]] as const;
export function OfficeWorkspace({children}:{children:React.ReactNode}) {
 useTaxiTheme('dark');
 const auth=useOfficeAuth();const connected=auth.authReady&&auth.authenticated;
 const [queueWindow,setQueueWindow]=useState(false);
 const [mapOfficeDataNeeded,setMapOfficeDataNeeded]=useState(false);
 const [clock,setClock]=useState('');useEffect(()=>{const update=()=>setClock(new Date().toLocaleString('ar-PS',{timeZone:'Asia/Jerusalem'}));update();const timer=setInterval(update,1000);return()=>clearInterval(timer);},[]);
 const receptionDrop=useRef<((result:DropResult)=>void)|null>(null);
 const registerReceptionDrop=useCallback((handler:((result:DropResult)=>void)|null)=>{receptionDrop.current=handler;},[]);
 const path=usePathname(); const mapPage=path==='/office/driver-map'; const receptionPage=path==='/office/reception'||path==='/office/orders'; const [menuOpen,setMenuOpen]=useState(false);
 useEffect(()=>{setMenuOpen(false);if(mapPage)setQueueWindow(false);},[path,mapPage]);
 const [tenant,setTenant]=useState(''); const [username,setUsername]=useState(''); const [password,setPassword]=useState(''); const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [data,setData]=useState<OfficeData|null>(null);const generation=useRef(0);
 useEffect(()=>{if(auth.authenticated)setTenant(auth.tenant);},[auth.authenticated,auth.tenant]);
 useEffect(()=>{generation.current++;setData(null);setError('');},[auth.authenticated,auth.tenantId,auth.userId]);
 const refresh=useCallback(async()=>{const current=generation.current;try{const next=await api.office();if(current===generation.current){setData(next);setError('');}}catch(e){if(current===generation.current){setError(receptionError(e));if(!api.authSnapshot().authenticated)setData(null);}}},[]);
 useEffect(()=>{if(!connected||(mapPage&&!mapOfficeDataNeeded))return;let stopped=false;let timer:ReturnType<typeof setTimeout>;const poll=async()=>{await refresh();if(!stopped&&api.authSnapshot().authenticated)timer=setTimeout(poll,mapPage?15000:3000);};void poll();return()=>{stopped=true;clearTimeout(timer);};},[connected,refresh,mapPage,mapOfficeDataNeeded]);
 useEffect(()=>{if(!connected||(mapPage&&!mapOfficeDataNeeded))return;let timer:ReturnType<typeof setTimeout>|undefined;const update=()=>{if(timer)return;timer=setTimeout(()=>{timer=undefined;void refresh();},500);};window.addEventListener('dispatchpro-office-update',update);return()=>{clearTimeout(timer);window.removeEventListener('dispatchpro-office-update',update);};},[connected,refresh,mapPage,mapOfficeDataNeeded]);
 // The shared API session belongs to the signed-in office, not this component.
 // Navigation, Strict Mode and Fast Refresh must not sign out its consumers.
 useEffect(()=>()=>{generation.current++;},[]);
 const pageTitle = receptionPage ? "مساحة عمل الاستقبال" : navigation.find(([slug])=>path===`/office/${slug}`)?.[1] ?? "لوحة المكتب";
 const navigationPanel = <aside className="office-navigation flex h-full min-h-0 w-full flex-col p-2"><div className="px-1 py-4 text-center"><img className="mx-auto mb-3 h-auto max-w-full object-contain" src="/customer-mobile/office-logo.webp" width="92" height="92" alt="تكسي نابلس والمهندس"/><div className="text-sm font-bold">تكسي نابلس والمهندس</div><div className="mt-1 text-xs">نظام إدارة المكتب</div></div><nav aria-label="قائمة المكتب" className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain">{navigation.map(([slug,label,Icon])=><Link key={slug} href={`/office/${slug}`} aria-current={path===`/office/${slug}`?'page':undefined} className={`flex items-center gap-2 rounded-lg px-2 py-2 text-xs font-medium ${path===`/office/${slug}`?'bg-primary text-primary-foreground':'hover:bg-slate-100'}`}><Icon size={18} aria-hidden="true" className="shrink-0"/>{label}</Link>)}</nav><Button className="mt-3 shrink-0" variant="ghost" onClick={()=>{generation.current++;api.logout();setQueueWindow(false);setData(null);setError('');}}><LogOut size={16} className="ml-2"/>تسجيل الخروج</Button></aside>;
 if(!auth.authReady)return <div role="status" className="p-12 text-center">جارٍ استعادة جلسة المكتب…</div>;
 if(!connected)return <LoginForm/>;
 return <OfficeContext.Provider value={{data,tenant,refresh,setMapOfficeDataNeeded,openQueueWindow:()=>setQueueWindow(true),registerReceptionDrop}}><DragDropContext onDragEnd={result=>{if(receptionDrop.current)receptionDrop.current(result);else if(data)void reorderOfficeQueue(result,data,refresh).catch(e=>setError(receptionError(e)));}}><div dir="rtl" style={receptionPage?{height:'100dvh'}:undefined} className="office-theme taxi-surface reception-workspace flex h-full min-h-0 overflow-hidden bg-slate-50 text-slate-900">{(!receptionPage&&!mapPage)&&<div style={{width:mapPage?'clamp(160px,11vw,208px)':224}} className="hidden shrink-0 border-l bg-white lg:block">{navigationPanel}</div>}<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"><header className={receptionPage?"flex shrink-0 items-center justify-between gap-2 border-b bg-white px-3 py-1.5":"flex shrink-0 items-center justify-between gap-1 border-b bg-white px-2 py-2 sm:gap-3 sm:px-6"}>{<Sheet open={menuOpen} onOpenChange={setMenuOpen}><SheetTrigger asChild><Button size="sm" variant="outline" aria-label="قائمة المكتب" className={`h-9 w-9 shrink-0 p-0 ${receptionPage||mapPage?'':'lg:hidden'}`}><Menu size={18} aria-hidden="true"/></Button></SheetTrigger><SheetContent side="right" dir="rtl" className="office-theme w-64 p-0 pt-10"><SheetTitle className="sr-only">قائمة المكتب</SheetTitle>{navigationPanel}</SheetContent></Sheet>}<h1 className="min-w-0 flex-1 truncate text-sm font-bold sm:text-base">تكسي نابلس والمهندس</h1><OfficeLiveNotifications compact/><Link href="/office/settings" aria-label="إعدادات المكتب" className="rounded p-2"><Settings size={18}/></Link><Button size="sm" variant="ghost" aria-label="تسجيل الخروج" onClick={()=>{generation.current++;api.logout();setData(null);}}><LogOut size={18}/></Button><span className="hidden text-xs xl:block">{clock} · {data?.currentUser?.username||'مستخدم المكتب'}</span><span role="status" className={`office-connection hidden sm:inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${error?'bg-red-50 text-red-700':'bg-emerald-50 text-emerald-800'}`}>{error?'تعذر التحديث · البيانات قديمة':data||mapPage?'متصل · تحديث تلقائي':'جارٍ التحميل…'}</span></header>{error&&<div role="alert" className="m-4 shrink-0 rounded-lg border border-red-200 bg-red-50 p-3 text-sm">{error}<Button variant="ghost" onClick={()=>void refresh()}>إعادة المحاولة</Button></div>}{data||mapPage?<div className={path==='/office/reports'?'min-h-0 flex-1 overflow-y-auto':'min-h-0 flex-1 overflow-hidden'}>{children}</div>:<div className="p-12 text-center text-muted-foreground">{error?'تعذر تحميل بيانات المكتب. استخدم إعادة المحاولة أعلاه.':'جارٍ تحميل بيانات المكتب…'}</div>}</div></div><FloatingQueueWindow open={queueWindow&&!mapPage} onClose={()=>setQueueWindow(false)}>{data&&<OfficeQueuePanel data={data} refresh={refresh} embedded queueId="driver-queue-floating"/>}</FloatingQueueWindow></DragDropContext></OfficeContext.Provider>;
}

