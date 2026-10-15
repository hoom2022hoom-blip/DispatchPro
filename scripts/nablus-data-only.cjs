const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const dotenv=require('dotenv');
const {isArabicText,normalizeArabicSearch,matchesSuggestedPlace}=require('../public/customer-mobile/place-search.js');
dotenv.config({path:'.env.local',quiet:true});dotenv.config({path:'.env',quiet:true});
const dir='artifacts/nablus-import';fs.mkdirSync(dir,{recursive:true});
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const conn=Object.fromEntries((process.env.ConnectionStrings__Taxi||'').split(';').filter(Boolean).map(x=>{const i=x.indexOf('=');return[x.slice(0,i).toLowerCase(),x.slice(i+1)];}));
const env={...process.env,PGHOST:conn.host,PGPORT:conn.port,PGUSER:conn.username,PGPASSWORD:conn.password,PGDATABASE:conn.database};
function sql(query){const r=spawnSync('.tools/pgsql/bin/psql.exe',['-X','-v','ON_ERROR_STOP=1','-At'],{input:query,env,encoding:'utf8',windowsHide:true});if(r.error||r.status!==0)throw Error(r.error?.code||r.stderr);return r.stdout.trim();}
const jsonsql=query=>JSON.parse(sql(`SELECT coalesce(json_agg(x),'[]'::json) FROM (${query}) x;`));
const save=(name,data)=>fs.writeFileSync(`${dir}/${name}`,JSON.stringify(data,null,2));
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
function target(){const office=read('.dispatchpro-local/office-test-account.json'),bridge=read('.dispatchpro-local/office-bridge.json');if(office.tenant!==bridge.tenant)throw Error('إعدادات المكتب غير متطابقة');const tenants=jsonsql(`SELECT "Id","Slug","Name" FROM "Tenant" WHERE "Slug"=${quote(office.tenant)}`);if(tenants.length!==1||tenants[0].Id!==bridge.tenantId)throw Error('هوية المكتب غير متطابقة');return tenants[0];}
function backup(){const tenant=target();const rows=jsonsql(`SELECT * FROM "SuggestedPlace" WHERE "TenantId"=${quote(tenant.Id)} ORDER BY "Id"`);const filename=`backup-${Date.now()}.json`;save(filename,{tenant,connection:{host:conn.host,database:conn.database},rows});save('backup-reference.json',{filename,tenant,oldCount:rows.length});console.log(`BACKUP: ${dir}/${filename}\nOLD COUNT: ${rows.length}`);}
function replace(){
 const rows=read(`${dir}/dataset.json`),ref=read(`${dir}/backup-reference.json`),tenant=target();if(!rows.length||ref.tenant.Id!==tenant.Id)throw Error('المجموعة أو النسخة الاحتياطية غير صالحة');
 const old=read(`${dir}/${ref.filename}`).rows;
 const current=jsonsql(`SELECT * FROM "SuggestedPlace" WHERE "TenantId"=${quote(tenant.Id)} ORDER BY "Id"`);
 if(JSON.stringify(current)!==JSON.stringify(old))throw Error('تغيرت القائمة بعد النسخ الاحتياطي');
 const id=require('node:crypto').randomUUID;
 const required=['رف','نجاح','مستشفى','جامعة','بلاطة','عسكر'];
 rows.sort((a,b)=>Number(required.some(q=>matchesSuggestedPlace(b,q)))-Number(required.some(q=>matchesSuggestedPlace(a,q)))||a.name.localeCompare(b.name,'ar'));
 const columns=read(`${dir}/inspection.json`).columns.map(c=>c.column_name),extended=columns.includes('Area')&&columns.includes('Category');
 const inserted=rows.map((p,i)=>({...p,id:id(),sortOrder:i}));
 const fields=['Id','TenantId','Name','AddressText','Latitude','Longitude','SortOrder','IsActive','IsDeleted','Version',...(extended?['Area','Category']:[])];
 const tuples=inserted.map(p=>[quote(p.id),quote(tenant.Id),quote(p.name),quote(extended?p.addressText:[p.addressText,p.area,p.category].filter(Boolean).join(' · ')),p.latitude,p.longitude,p.sortOrder,'TRUE','FALSE',1,...(extended?[quote(p.area),quote(p.category)]:[])].join(','));
 const statement=`BEGIN; SELECT pg_advisory_xact_lock(hashtext(${quote(tenant.Id)})); LOCK TABLE "SuggestedPlace" IN SHARE ROW EXCLUSIVE MODE;
 DO $$ BEGIN IF (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p."Id"),'[]'::jsonb) FROM "SuggestedPlace" p WHERE "TenantId"=${quote(tenant.Id)}) <> ${quote(JSON.stringify(old))}::jsonb THEN RAISE EXCEPTION 'Old data changed after backup'; END IF; END $$;
 DELETE FROM "SuggestedPlace" WHERE "TenantId"=${quote(tenant.Id)};
 INSERT INTO "SuggestedPlace" (${fields.map(f=>'"'+f+'"').join(',')}) VALUES ${tuples.map(t=>'('+t+')').join(',')};
 DO $$ BEGIN IF (SELECT count(*) FROM "SuggestedPlace" WHERE "TenantId"=${quote(tenant.Id)}) <> ${rows.length} THEN RAISE EXCEPTION 'Inserted count mismatch'; END IF; END $$; COMMIT;`;
 sql(statement);save('inserted-manifest.json',{tenant,inserted,extended,oldIds:old.map(p=>p.Id),oldCount:old.length});verify();
}
function verify(){const manifest=read(`${dir}/inserted-manifest.json`),tenant=target();const rows=jsonsql(`SELECT * FROM "SuggestedPlace" WHERE "TenantId"=${quote(tenant.Id)} ORDER BY "SortOrder"`);const counts=jsonsql('SELECT "TenantId",count(*) FROM "SuggestedPlace" GROUP BY "TenantId"');const searches=Object.fromEntries(['رف','رفيديا','نجاح','مستشفى','جامعة','بلاطة','عسكر'].map(q=>[q,rows.filter(p=>matchesSuggestedPlace({name:p.Name,addressText:p.AddressText,area:p.Area,category:p.Category},q)).length]));const result={tenant,oldCount:manifest.oldCount,finalCount:rows.length,oldRemaining:rows.filter(p=>manifest.oldIds.includes(p.Id)).length,insertedPresent:rows.filter(p=>manifest.inserted.some(n=>n.id===p.Id)).length,invalidArabic:rows.filter(p=>!isArabicText(p.Name,true)||!isArabicText(p.AddressText)).length,inactive:rows.filter(p=>!p.IsActive||p.IsDeleted).length,otherTenantCounts:counts.filter(c=>c.TenantId!==tenant.Id),searches,samples:jsonsql(`SELECT "Name","AddressText","Latitude","Longitude" FROM "SuggestedPlace" WHERE "TenantId"=${quote(tenant.Id)} ORDER BY random() LIMIT 8`)};save('db-verification.json',result);console.log(JSON.stringify(result,null,2));}
function inspect(){const info={connection:{host:conn.host,port:conn.port,database:conn.database},tenants:jsonsql('SELECT "Id","Slug","Name" FROM "Tenant"'),columns:jsonsql("SELECT column_name,data_type FROM information_schema.columns WHERE table_name='SuggestedPlace'"),counts:jsonsql('SELECT "TenantId",count(*) FROM "SuggestedPlace" GROUP BY "TenantId"'),migrations:jsonsql('SELECT "MigrationId" FROM "__EFMigrationsHistory" ORDER BY "MigrationId"')};save('inspection.json',info);console.log(JSON.stringify(info,null,2));}
function classify(t){
 const a=t.amenity;
 if(t.place)return ['NEIGHBORHOODS','حي/منطقة'];
 if(t.highway&&['primary','secondary','tertiary','trunk','primary_link','secondary_link','tertiary_link'].includes(t.highway)||t.junction==='roundabout')return ['STREETS/INTERSECTIONS',t.junction==='roundabout'?'دوار':'شارع رئيسي'];
 if(['hospital','clinic','doctors','health_post'].includes(a)||t.healthcare)return ['HEALTH',a==='hospital'?'مستشفى':'مركز طبي'];
 if(['university','college','school','kindergarten'].includes(a))return ['EDUCATION',{university:'جامعة',college:'كلية',school:'مدرسة',kindergarten:'روضة'}[a]];
 if(['bus_station','taxi','parking'].includes(a)||t.public_transport==='station'||t.railway==='station')return ['TRANSPORT',a==='parking'?'موقف سيارات':a==='taxi'?'موقف تكسي':'مجمع نقل'];
 if(a==='marketplace'||['mall','department_store'].includes(t.shop))return ['SHOPPING',a==='marketplace'?'سوق':t.shop==='mall'?'مول':'مركز تسوق'];
 if(t.office==='government'||['townhall','courthouse','police','post_office'].includes(a))return ['GOVERNMENT','مؤسسة حكومية'];
 if(a==='bank')return ['LANDMARKS/OTHER','بنك'];
 if(a==='place_of_worship')return ['LANDMARKS/OTHER',t.religion==='muslim'?'مسجد':t.religion==='christian'?'كنيسة':'مكان عبادة'];
 if(['hotel','museum','attraction'].includes(t.tourism))return ['LANDMARKS/OTHER',t.tourism==='hotel'?'فندق':'معلم'];
 if(['park','stadium','sports_centre','pitch'].includes(t.leisure))return ['LANDMARKS/OTHER',t.leisure==='park'?'حديقة':'ملعب'];
 if(t.historic)return ['LANDMARKS/OTHER','معلم تاريخي'];
 return null;
}
function prepare(){
 const source=read(`${dir}/osm-source.json`),rows=[],stats={duplicates:0,invalid:0,excluded:0,categories:{}};
 const arabic=(...vs)=>vs.find(v=>isArabicText(v,true))||'';
 for(const e of source.elements){const t=e.tags||{},c=classify(t);if(!c){stats.excluded++;continue;}
  const name=t['name:ar']||t.name;
  if(!isArabicText(name,true)||name.trim().length<3||name.length>150||['كنيسة','مسجد','مدرسة','روضة','عيادة','حديقة','شارع','موقف','ملعب','سوق','بنك','مستشفى','جامعة','دوار','مركز طبي'].includes(name.trim())){stats.invalid++;continue;}
  const geometry=e.geometry||e.members?.flatMap(m=>m.geometry||[])||[];
  const point=e.lat!=null?e:geometry[Math.floor(geometry.length/2)];
  if(!point||!Number.isFinite(point.lat)||!Number.isFinite(point.lon)||point.lat<32.16||point.lat>32.30||point.lon<35.15||point.lon>35.36){stats.invalid++;continue;}
  const row={name:name.trim(),addressText:arabic(t['addr:street:ar'],t['addr:street']),area:arabic(t['addr:suburb:ar'],t['addr:suburb'],t['addr:city:ar'],t['addr:city']),category:c[1],latitude:point.lat,longitude:point.lon,group:c[0],source:`${e.type}/${e.id}`,sourceNameTag:t['name:ar']?'name:ar':'name'};
  const normalized=normalizeArabicSearch(row.name);
  const duplicate=rows.find(p=>normalizeArabicSearch(p.name)===normalized&&(p.category===row.category||p.group==='HEALTH'&&row.group==='HEALTH')&&Math.hypot((p.latitude-row.latitude)*111320,(p.longitude-row.longitude)*94100)<(c[0]==='STREETS/INTERSECTIONS'?1500:150));
  if(duplicate){if(row.category==='مستشفى')Object.assign(duplicate,row);stats.duplicates++;continue;}
  rows.push(row);stats.categories[c[0]]=(stats.categories[c[0]]||0)+1;
 }
 rows.sort((a,b)=>a.group.localeCompare(b.group)||a.name.localeCompare(b.name,'ar'));
 save('dataset.json',rows);save('dataset-stats.json',stats);
 console.log(`DATASET READY: ${rows.length}\nDUPLICATES REMOVED: ${stats.duplicates}\nINVALID REMOVED: ${stats.invalid}`);console.log(stats.categories);
 if(!rows.length)throw Error('المجموعة فارغة؛ يمنع حذف القديم');
}
async function fetchSource(){
 const query='[out:json][timeout:90];nwr(32.16,35.15,32.30,35.36)[~"^(name|name:ar)$"~"."];out body geom;';
 save('source-query.json',{endpoint:'https://overpass-api.de/api/interpreter',query,bbox:[32.16,35.15,32.30,35.36]});
 const endpoint=process.env.OSM_ENDPOINT||'https://overpass.private.coffee/api/interpreter';
 const response=await fetch(endpoint+'?data='+encodeURIComponent(query),{headers:{'User-Agent':'DispatchPro-local-data-import/1.0'},signal:AbortSignal.timeout(120000)});
 if(!response.ok)throw Error(`Overpass ${response.status}`);
 const data=await response.json();if(data.remark)throw Error(data.remark);save('source-query.json',{endpoint,query,bbox:[32.16,35.15,32.30,35.36]});save('osm-source.json',data);console.log('SOURCE RECORDS:',data.elements.length);prepare();
}
async function main(){const mode=process.argv[2];if(mode==='inspect')inspect();else if(mode==='fetch')await fetchSource();else if(mode==='prepare')prepare();else if(mode==='backup')backup();else if(mode==='replace')replace();else if(mode==='verify')verify();else throw Error('حدد الخطوة');}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
