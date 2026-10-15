import test from 'node:test';
import assert from 'node:assert/strict';
import {radioPresentation} from '../src/lib/radio-presentation.ts';
const base={connected:true,talking:null,needsPlayback:false,message:'المخشيرة متصلة',state:{floors:[]}};
const floor={id:'floor',channel:'public',name:'سائق QA',audioStarted:false};
test('requesting and remote busy states cannot announce a local transmission',()=>{
 for(const status of [{...base,pending:true,message:'جارٍ طلب الموجة…'},{...base,state:{floors:[floor]}},{...base,state:{floors:[{...floor,audioStarted:true}]}}]){
  const view=radioPresentation(status);assert.notEqual(view.phase,'talking');assert.doesNotMatch(view.title,/أنت تتحدث/);
 }
 assert.equal(radioPresentation({...base,pending:true}).phase,'requesting');
 assert.equal(radioPresentation({...base,state:{floors:[floor]}}).name,'سائق QA');
});
test('only the existing confirmed talking event presents the granted public/private channel',()=>{
 assert.equal(radioPresentation({...base,talking:floor}).title,'أنت تتحدث للجميع');
 assert.equal(radioPresentation({...base,talking:{...floor,channel:'private'}}).channel,'private');
 assert.equal(radioPresentation(base).phase,'idle');
 assert.equal(radioPresentation({...base,connected:false}).phase,'offline');
 assert.equal(radioPresentation({...base,talking:null,pending:false}).title,'الموجة متاحة');
});
test('a server-owned floor can show granted without claiming that transmission has started',()=>{
 const view=radioPresentation({...base,pending:true,state:{self:{id:'qa-peer'},floors:[{...floor,speaker:'qa-peer'}]}});
 assert.equal(view.phase,'granted');assert.doesNotMatch(view.title,/أنت تتحدث/);
 assert.equal(radioPresentation({...base,pending:true,state:{self:{id:'qa-peer'},floors:[{...floor,speaker:'other-peer'}]}}).phase,'requesting');
});
