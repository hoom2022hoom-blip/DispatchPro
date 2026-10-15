"use client";
import {useParams} from 'next/navigation';
import dynamic from 'next/dynamic';
const loading=()=> <p role="status" className="p-6 text-slate-600">جارٍ تجهيز الصفحة…</p>;
const OfficePage=dynamic(()=>import('@/components/office-page').then(m=>m.OfficePage),{loading});
const OfficeDriverMap=dynamic(()=>import('@/components/office-driver-map').then(m=>m.OfficeDriverMap),{ssr:false,loading});
export default function Page(){const {section}=useParams<{section:string}>();return section==='driver-map'?<OfficeDriverMap/>:<OfficePage key={section} section={section}/>;}
