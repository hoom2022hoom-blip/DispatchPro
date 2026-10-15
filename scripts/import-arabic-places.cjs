// Offline OpenStreetMap JSON converter. Never translate names or synthesize coordinates.
const fs=require('node:fs');
const {isArabicText,normalizeArabicSearch}=require('../public/customer-mobile/place-search.js');
function convert(elements,tenantId){
 if(!tenantId)throw new Error('TenantId مطلوب');
 const seen=new Set(),places=[];
 const categories={hospital:'مستشفى',clinic:'عيادة',university:'جامعة',school:'مدرسة',pharmacy:'صيدلية',bank:'بنك',restaurant:'مطعم',mosque:'مسجد'};
 for(const element of elements){
  const tags=element.tags||{};
  const name=tags['name:ar']||tags.name;
  if(!isArabicText(name,true))continue;
  const latitude=element.lat??element.center?.lat,longitude=element.lon??element.center?.lon;
  if(typeof latitude!=='number'||typeof longitude!=='number'||!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180||latitude===0&&longitude===0)continue;
  const arabic=(...values)=>values.find(v=>isArabicText(v,true))||'';
  const area=arabic(tags['addr:suburb:ar'],tags['addr:suburb'],tags['addr:city:ar'],tags['addr:city']);
  const addressText=arabic(tags['addr:street:ar'],tags['addr:street']);
  const category=categories[tags.amenity]||(tags.amenity==='place_of_worship'&&tags.religion==='muslim'?'مسجد':'');
  const key=`${normalizeArabicSearch(name)}|${latitude}|${longitude}`;
  if(seen.has(key))continue;seen.add(key);
  places.push({name,addressText,area,category,latitude,longitude,isActive:true,tenantId,sortOrder:places.length});
 }
 return places;
}
module.exports={convert};
if(require.main===module){
 const [source,target,tenantId]=process.argv.slice(2);
 if(!source||!target||!tenantId)throw new Error('حدد ملف المصدر وملف الناتج ومعرف المكتب');
 const data=JSON.parse(fs.readFileSync(source,'utf8'));
 fs.writeFileSync(target,JSON.stringify(convert(data.elements||[],tenantId),null,2));
}
