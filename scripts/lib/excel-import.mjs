export function clean(value) { return String(value ?? '').normalize('NFC').replace(/\s+/gu,' ').trim(); }
export function phone(value, driver=false) {
  let v=clean(value).replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[\s()\-]/g,'');
  if (/^0097[02]/.test(v)) v='+'+v.slice(2);
  if (/^\+97[02]/.test(v)) v='0'+v.slice(4);
  if (/^5\d{8}$/.test(v)) v='0'+v;
  return (driver?/^0\d{8,9}$/:/^05\d{8}$/).test(v)?(driver?v:'+970'+v.slice(1)):null;
}
export function planImport(books, existing) {
  const customers=[],addresses=[],drivers=[],skipped=[];
  const customerPhones=new Set(existing.customers.map(c=>phone(c.Phone)).filter(Boolean));
  const idPhones=new Map(existing.customers.map(c=>[c.Id,phone(c.Phone)]));
  const addressKeys=new Set(existing.addresses.map(a=>`${idPhones.get(a.CustomerId)}\0${clean(a.AddressText)}`));
  const driverPhones=new Set(existing.drivers.map(d=>phone(d.Phone,true)).filter(Boolean));
  const stats={duplicates:0,invalid:0};
  const skip=(sheet,row,reason,duplicate=false)=>{stats[duplicate?'duplicates':'invalid']++;skipped.push({sheet,row,reason});};
  const sheets=Object.assign({},...Object.values(books));
  function address(p,text,sheet,row) {
    text=clean(text);
    if(!text || text.length>500 || !p || !customerPhones.has(p)){skip(sheet,row,'Invalid address or missing valid customer');return;}
    const key=p+'\0'+text;
    if(addressKeys.has(key)){skip(sheet,row,'Duplicate address',true);return;}
    addressKeys.add(key);addresses.push({phone:p,address:text,sheet,row});
  }
  for(const {row,cells:c} of sheets.Customers.slice(1)) {
    const p=phone(c.A),name=clean(c.B);
    if(!p||!name||name.length>150||!/[\p{L}\p{N}]/u.test(name)){skip('Customers',row,'Invalid name or phone');continue;}
    if(customerPhones.has(p))skip('Customers',row,'Duplicate customer',true);
    else {customerPhones.add(p);customers.push({phone:p,name,row});}
    if(clean(c.C))address(p,c.C,'Customers.AddressText',row);
  }
  for(const {row,cells:c} of sheets.CstAddressT.slice(1)) address(phone(c.C),c.D,'CstAddressT',row);
  for(const {row,cells:c} of sheets.Drivers.slice(1)) {
    const p=phone(c.E,true),name=clean(c.B);
    if(!p||!name||name.length>150||!/[\p{L}\p{N}]/u.test(name)){skip('Drivers',row,'Invalid name or phone');continue;}
    if(driverPhones.has(p)){skip('Drivers',row,'Duplicate driver phone',true);continue;}
    driverPhones.add(p);drivers.push({phone:p,name,address:clean(c.D),notes:clean(c.C),row});
  }
  return {customers,addresses,drivers,stats,skipped};
}
