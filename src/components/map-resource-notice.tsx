"use client";
import {mapboxEnabled,mapboxResourceOrigin} from '@/lib/mapbox-style';

export function MapResourceNotice({loading=false,error='',operationError='',retry}:{loading?:boolean;error?:string;operationError?:string;retry?:()=>void}){
 const resourceOrigin=mapboxResourceOrigin();
 const qa=mapboxEnabled()&&(resourceOrigin==='/__qa_mapbox'||resourceOrigin.startsWith('http://127.0.0.1:'));
 if(!qa&&!loading&&!error&&!operationError)return null;
 return <aside className="map-resource-notice" data-map-state={error||operationError?'error':qa?'qa':'loading'} data-map-ui-version="20261015-reference2" aria-label="حالة موارد الخريطة" dir="rtl">
  {qa&&<details><summary><strong>QA · خريطة اصطناعية وليست شوارع نابلس</strong></summary><p>السيارات والمواقع للاختبار فقط. خدمة الصوت وGPS الحقيقيان معطّلان في هذه الجلسة. النسخة reference2.</p></details>}
  {loading&&<p role="status">جارٍ تحميل مصدر الخريطة…</p>}
  {error&&<div role="alert"><p>{error}</p><p>لم تُستبدل الطبقة بخرائط أخرى تلقائيًا.</p>{retry&&<button type="button" className="rounded-lg border px-3" onClick={retry}>إعادة المحاولة</button>}</div>}
  {operationError&&<p role="alert">{operationError}</p>}
 </aside>;
}
