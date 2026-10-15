import test from 'node:test';
import assert from 'node:assert/strict';
import search from '../public/customer-mobile/place-search.js';
import importer from '../scripts/import-arabic-places.cjs';
import {customerMobile} from './helpers/customer-mobile.mjs';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {registerHooks} from 'node:module';
import {receptionRenderHooks} from './helpers/reception-render.mjs';
const place={name:'مستشفى رفيديا',addressText:'شارع الجامعة',area:'رفيديا',category:'مستشفى',latitude:32.24,longitude:35.27,isActive:true};
test('shared Arabic partial search and normalization preserve stored labels',()=>{
 for(const q of ['رف','مست','جام'])assert.ok(search.matchesSuggestedPlace(place,q));
 assert.equal(search.normalizeArabicSearch('  إِلى   آفاق أريحا '),'الي افاق اريحا');
 assert.ok(search.matchesSuggestedPlace({...place,area:'بلاطة'},'بلاطة'));
 assert.ok(search.matchesSuggestedPlace({...place,area:'عسكر'},'عسكر'));
 assert.ok(search.matchesSuggestedPlace({...place,name:'جامعة النجاح'},'نجاح'));
 assert.equal(search.matchesSuggestedPlace(place,'hospital'),false);
 assert.equal(search.matchesSuggestedPlace({...place,name:'Hospital'},''),false);
 assert.equal(search.matchesSuggestedPlace({...place,addressText:'Hospital'},'رف'),false);
 assert.equal(place.name,'مستشفى رفيديا');
});
test('import uses trusted Arabic source names and coordinates and deduplicates',()=>{
 const source={lat:32.24,lon:35.27,tags:{'name:ar':'مستشفى رفيديا',name:'Rafidia Hospital',amenity:'hospital','addr:suburb':'رفيديا'}};
 const result=importer.convert([source,source,{lat:32.2,lon:35.2,tags:{name:'English Only'}},{tags:{'name:ar':'بلاطة'}}],'tenant');
 assert.equal(result.length,1);assert.equal(result[0].name,'مستشفى رفيديا');assert.equal(result[0].category,'مستشفى');assert.equal(result[0].latitude,source.lat);
});
test('served customer searches Arabic area and category and rejects English',async()=>{
 const app=await customerMobile({places:{suggestedPlaces:[place],savedPlaces:[],recentDestinations:[]}});
 try{for(const q of ['رف','جام','مست']){app.nodes.get('pickup-query').value=q;app.nodes.get('pickup-query').oninput();assert.equal(app.nodes.get('pickup-results').children.length,1);}
 app.nodes.get('pickup-query').value='hospital';app.nodes.get('pickup-query').oninput();assert.equal(app.nodes.get('pickup-results').children.length,0);
 }finally{app.context.hooks.lock();}
});
test('office management filters area/category and driver uses same matcher',async()=>{
 const hooks=receptionRenderHooks();let view;
 const stub=registerHooks({resolve(s,c,next){if(s==='@/lib/reception-api')return{url:'data:text/javascript,export const apiReceptionBackend=globalThis.arabicPlacesApi;',shortCircuit:true};return next(s,c);}});
 globalThis.arabicPlacesApi={administration:async()=>[{...place,id:'p',version:1,sortOrder:0},{...place,id:'q',name:'جامعة النجاح',area:'عسكر',category:'جامعة',version:1,sortOrder:1}]};
 try{
  const {OfficeSuggestedPlaces}=await import('../src/components/office-suggested-places.tsx');
  const {SuggestedPlaceSearch,matchesSuggestedPlace}=await import('../src/components/suggested-place-search.tsx');
  assert.equal(matchesSuggestedPlace,search.matchesSuggestedPlace);
  await act(async()=>{view=TestRenderer.create(React.createElement(OfficeSuggestedPlaces));});
  for(const query of ['رف','عسكر','جام','hospital']){
   await act(async()=>view.root.findByProps({'aria-label':'ابحث في المواقع المقترحة'}).props.onChange({target:{value:query}}));
   assert.equal(view.root.findAllByType('article').length,query==='hospital'?0:query==='جام'?2:1);
  }
  await act(async()=>view.unmount());
  await act(async()=>{view=TestRenderer.create(React.createElement(SuggestedPlaceSearch,{items:[{...place,id:'p'}],target:'destination',value:'مست',onChange(){},onSelect(){}}));});
  await act(async()=>view.root.findByType('input').props.onFocus());
  assert.ok(view.root.findAllByType('button').some(b=>b.children.join('').includes('مستشفى رفيديا')));
 }finally{await act(async()=>view?.unmount());stub.deregister();hooks.deregister();delete globalThis.arabicPlacesApi;}
});
