import fs from 'node:fs';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {registerHooks} from 'node:module';
import {receptionRenderHooks} from '../tests/helpers/reception-render.mjs';
const office=JSON.parse(fs.readFileSync('.dispatchpro-local/office-test-account.json','utf8'));
const root='http://127.0.0.1:9005';
const auth=await fetch(root+'/api/reception/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(office)});
assert.equal(auth.status,200);const token=(await auth.json()).accessToken;
const response=await fetch(root+'/api/reception/office/suggested-places',{headers:{Authorization:'Bearer '+token}});
assert.equal(response.status,200);const rows=await response.json();
globalThis.nablusReadOnlyApi={administration:async()=>rows};
const hooks=receptionRenderHooks();
const stub=registerHooks({resolve(s,c,next){if(s==='@/lib/reception-api')return{url:'data:text/javascript,export const apiReceptionBackend=globalThis.nablusReadOnlyApi;',shortCircuit:true};return next(s,c);}});
let view;const result={office:{},officeOrder:{},driver:{},dataCount:rows.length};
try{
 const {OfficeSuggestedPlaces}=await import('../src/components/office-suggested-places.tsx');
 const {OfficeOrderDestination}=await import('../src/components/office-order-destination.tsx');
 const {SuggestedPlaceSearch}=await import('../src/components/suggested-place-search.tsx');
 await act(async()=>{view=TestRenderer.create(React.createElement(OfficeSuggestedPlaces));});
 for(const q of ['رف','نجاح','مستشفى','جامعة','بلاطة','عسكر']){await act(async()=>view.root.findByProps({'aria-label':'ابحث في المواقع المقترحة'}).props.onChange({target:{value:q}}));const n=view.root.findAllByType('article').length;assert.ok(n>0);result.office[q]=n;}
 await act(async()=>view.unmount());
 for(const q of ['رف','نجاح','مستشفى','جامعة','بلاطة','عسكر']){
  await act(async()=>{view=TestRenderer.create(React.createElement(OfficeOrderDestination,{value:q,onChange(){},places:async()=>rows}));});
  await act(async()=>view.root.findByType('input').props.onFocus());
  const n=view.root.findAllByType('button').filter(b=>b.props.className?.includes('text-right')).length;assert.ok(n>0);result.officeOrder[q]=n;
  await act(async()=>view.unmount());
  await act(async()=>{view=TestRenderer.create(React.createElement(SuggestedPlaceSearch,{items:rows,target:'destination',value:q,onChange(){},onSelect(){}}));});
  await act(async()=>view.root.findByType('input').props.onFocus());
  const d=view.root.findAllByType('button').filter(b=>b.props.className?.includes('text-right')).length;assert.ok(d>0);result.driver[q]=d;
  await act(async()=>view.unmount());
 }
 fs.writeFileSync('artifacts/nablus-import/component-search-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await act(async()=>view?.unmount());stub.deregister();hooks.deregister();delete globalThis.nablusReadOnlyApi;}
