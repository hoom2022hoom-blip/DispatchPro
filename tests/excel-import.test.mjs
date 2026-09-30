import test from 'node:test';
import assert from 'node:assert/strict';
import {phone,planImport} from '../scripts/lib/excel-import.mjs';
const row=(cells,n=2)=>({cells,row:n});
test('Excel phones preserve zero and normalize equivalent mobile formats',()=>{
  for(const v of ['0591234567','591234567','+970591234567','00970591234567','٠٥٩١٢٣٤٥٦٧'])assert.equal(phone(v),'+970591234567');
  assert.equal(phone('invalid'),null);assert.equal(phone('092345678'),null);assert.equal(phone('092345678',true),'092345678');
});
test('Excel import skips existing and repeated records but adds distinct customer addresses',()=>{
  const books={x:{Customers:[row({}),row({A:'0591234567',B:'Name',C:'New address'}),row({A:'0591234567',B:'Name',C:'New address'},3),row({A:'bad',B:'Name'},4)],CstAddressT:[row({}),row({C:'0591234567',D:' Existing  address '}),row({C:'0590000000',D:'Orphan'})],Drivers:[row({}),row({B:'Driver',E:'0591234567'}),row({B:'Driver',E:'0591234567'},3),row({B:'--'},4)]}};
  const p=planImport(books,{customers:[{Id:'1',Phone:'+970591234567'}],addresses:[{CustomerId:'1',AddressText:'Existing address'}],drivers:[]});
  assert.equal(p.customers.length,0);assert.equal(p.addresses.length,1);assert.equal(p.drivers.length,1);assert.deepEqual(p.stats,{duplicates:5,invalid:3});
});
