import test from 'node:test';
import assert from 'node:assert/strict';
import {findCustomerByPhone,matchesCustomer,locationFromPlace} from '../src/lib/customer-places.ts';

test('customer search resolves local and international phones plus customer name and location fields',()=>{
 const customer={id:'customer-a',fullName:'ليلى',phone:'+970591234500',secondaryPhone:'0561234500'};
 assert.equal(findCustomerByPhone([customer],'0591234500'),customer);
 assert.equal(findCustomerByPhone([customer],'+970 59 123 4500'),customer);
 assert.equal(findCustomerByPhone([customer],'0561234500'),customer);
 assert.equal(findCustomerByPhone([customer],'00972 (59) 123-4500'),customer);
 assert.equal(findCustomerByPhone([customer],'٠٥٩١٢٣٤٥٠٠'),customer);
 assert.equal(matchesCustomer('',customer.phone,'+972 59 123 4500'),true);
 assert.equal(findCustomerByPhone([customer],'0590000000'),undefined);
 assert.equal(matchesCustomer('حي الجامعة شارع القدس',customer.phone,'الجامعة'),true);
 const place={customerName:customer.fullName,phone:customer.phone,address:{id:'home',customerId:customer.id,label:'البيت',icon:'HOME',addressText:'شارع القدس',neighborhood:'حي الجامعة',street:'شارع القدس',latitude:32.22,longitude:35.25,notes:'قرب المدرسة',isDefault:true,version:1}};
 assert.deepEqual(locationFromPlace(place),{customerId:'customer-a',savedAddressId:'home',passengerName:'ليلى',passengerPhone:'+970591234500',addressText:'شارع القدس',neighborhood:'حي الجامعة',street:'شارع القدس',latitude:32.22,longitude:35.25,locationSource:'SAVED_ADDRESS',notes:'قرب المدرسة'});
});
