import {driverStatusGroup} from './driver-presentation';
import type {VoiceAccess} from './voice-client';
import {mapSearchIndex,matchesMapSearchIndex} from './map-search';
export type MapDriver={connectionStatus?:'online'|'offline'|'unknown';recordedHeading?:number;id:string;fullName:string;phone?:string;active:boolean;status:string;voice?:VoiceAccess;driverAppEnabled?:boolean;radioEnabled?:boolean;gpsEnabled?:boolean;locationSource?:string;driverConnection?:{connected:boolean;lastSeenAt:string|null};radioConnection?:{connected:boolean;lastSeenAt:string|null};voiceState?:{connected:boolean;talking:boolean;channels:string[]};vehicle?:{id:string;plate:string;status:string;active:boolean}|null;previousLocation?:GpsPoint|null;currentRide:{id:string;status:string;orderId?:string;orderNumber?:number|null;rideRequestId?:string;assignedDriver?:string;assignedVehicle?:string|null;pickup?:string;pickupLatitude?:number|null;pickupLongitude?:number|null;destination?:string;destinationLatitude?:number|null;destinationLongitude?:number|null}|null;waitingCount:number;locationStatus:string;updatedAt:string|null;location:{latitude:number;longitude:number;accuracy:number;updatedAt:string}|null};
export type DriverMapData={serverTime:string;locationMaxAgeSeconds:number;drivers:MapDriver[]};
export type GpsPoint={id:string;rideId:string|null;latitude:number;longitude:number;accuracy:number;timestamp:string};
export type GpsRoute={from:string;to:string;hasMore:boolean;points:GpsPoint[]};
export const mapDriverGroup=(d:MapDriver)=>driverStatusGroup(d.active,d.status,d.currentRide?[d.currentRide.status==='Assigned'?'assigned':'in-progress']:[]);
export const lastKnownLocation=(d:MapDriver)=>d.location&&Number.isFinite(d.location.latitude)&&Number.isFinite(d.location.longitude)&&Math.abs(d.location.latitude)<=90&&Math.abs(d.location.longitude)<=180&&(d.location.latitude!==0||d.location.longitude!==0)?d.location:null;
export const liveLocation=(d:MapDriver,now:number,maxAge:number)=>['FRESH','READY'].includes(d.locationStatus)&&lastKnownLocation(d)&&Number.isFinite(d.location!.accuracy)&&d.location!.accuracy>=0&&d.location!.accuracy<=50&&now-Date.parse(d.location!.updatedAt)<=maxAge*1000&&now>=Date.parse(d.location!.updatedAt)-10000?d.location:null;
export function locationLabel(d:MapDriver,now:number,maxAge=120){
 const location=lastKnownLocation(d);if(!location)return 'لا يوجد موقع مسجل';
 if(!Number.isFinite(location.accuracy)||location.accuracy<0||location.accuracy>50)return 'دقة GPS منخفضة أو غير معروفة';
 if(liveLocation(d,now,maxAge))return 'موقع مباشر';
 const minutes=Math.max(0,Math.floor((now-Date.parse(location.updatedAt))/60000));
 if(!Number.isFinite(minutes))return 'آخر موقع معروف';
 return minutes>=60?`آخر موقع منذ ${Math.floor(minutes/60)} ساعة`:`آخر موقع منذ ${minutes} دقيقة`;
}
const driverSearchIndexes=new WeakMap<MapDriver,{signature:string;index:ReturnType<typeof mapSearchIndex>}>();
export function matchesMapDriver(d:MapDriver,query:string){
 const fields=[d.fullName,d.id,d.phone??'',d.vehicle?.plate??'',operationalStatus(d).label,d.status??''],signature=JSON.stringify(fields);
 let cached=driverSearchIndexes.get(d);
 if(!cached||cached.signature!==signature){cached={signature,index:mapSearchIndex(fields)};driverSearchIndexes.set(d,cached);}
 return matchesMapSearchIndex(cached.index,query);
}
export type MapGpsFilter='All'|'Live'|'Stale'|'Poor'|'Missing';
export const mapGpsFilters=[{value:'All',label:'كل المواقع'},{value:'Live',label:'GPS مباشر'},{value:'Stale',label:'GPS قديم'},{value:'Poor',label:'دقة منخفضة'},{value:'Missing',label:'بلا موقع'}] as const;
export function mapGpsQuality(d:MapDriver,now:number,maxAge:number):Exclude<MapGpsFilter,'All'>{
 const location=lastKnownLocation(d);if(!location)return 'Missing';
 if(!Number.isFinite(location.accuracy)||location.accuracy<0||location.accuracy>50)return 'Poor';
 return liveLocation(d,now,maxAge)?'Live':'Stale';
}
export const matchesMapGpsFilter=(d:MapDriver,filter:MapGpsFilter,now:number,maxAge:number)=>filter==='All'||mapGpsQuality(d,now,maxAge)===filter;
// No GPS and old GPS do not establish an offline connection.
export const mapDriverOffline=(d:MapDriver)=>d.status==='Offline';
export const mapStatuses=[
 {status:'Available',label:'متاح',color:'text-emerald-600',dot:'bg-emerald-600'},
 {status:'Assigned',label:'طلب معروض',color:'text-yellow-500',dot:'bg-yellow-500'},
 {status:'Accepted',label:'متجه للزبون',color:'text-yellow-600',dot:'bg-yellow-500'},
 {status:'DriverArriving',label:'متجه للزبون',color:'text-yellow-500',dot:'bg-yellow-500'},
 {status:'Arrived',label:'وصل',color:'text-yellow-600',dot:'bg-yellow-500'},
 {status:'InProgress',label:'في رحلة',color:'text-blue-600',dot:'bg-blue-600'},
 {status:'Offline',label:'غير متصل',color:'text-red-600',dot:'bg-red-600'},
] as const;
export function operationalStatus(d:MapDriver){const status=!d.active||['Offline','Suspended'].includes(d.status)?'Offline':d.currentRide?.status??(d.status==='Busy'?'InProgress':'Available');return mapStatuses.find(s=>s.status===status)??mapStatuses[6];}
export const operationFilters=[{status:'All',label:'الكل'},{status:'Available',label:'متاح'},{status:'DriverArriving',label:'متجه للزبون'},{status:'InProgress',label:'في رحلة'},{status:'Offline',label:'غير متصل'}];
export function matchesOperationFilter(d:MapDriver,filter:string){const s=operationalStatus(d).status;return filter==='All'||(filter==='DriverArriving'?['Assigned','Accepted','DriverArriving','Arrived'].includes(s):s===filter);}
export function headingTarget(d:MapDriver){const r=d.currentRide;if(!r)return {label:'لا توجد وجهة حالية',latitude:null,longitude:null};const trip=r.status==='InProgress';return {label:`متجه إلى ${trip?r.destination?.trim()||'الوجهة غير محددة':r.pickup?.trim()||'موقع الالتقاط غير محدد'}`,latitude:trip?r.destinationLatitude:r.pickupLatitude,longitude:trip?r.destinationLongitude:r.pickupLongitude};}
export function gpsAgeLabel(d:MapDriver,now:number){const t=Date.parse(d.location?.updatedAt??'');if(!Number.isFinite(t))return 'غير متاح';const seconds=Math.max(0,Math.floor((now-t)/1000));return seconds<60?`قبل ${seconds} ثانية`:seconds<3600?`قبل ${Math.floor(seconds/60)} دقيقة`:`قبل ${Math.floor(seconds/3600)} ساعة`;}
export function targetDistance(d:MapDriver,now:number,maxAge:number){const l=liveLocation(d,now,maxAge),t=headingTarget(d);if(!l||t.latitude==null||t.longitude==null||!Number.isFinite(t.latitude)||!Number.isFinite(t.longitude)||Math.abs(t.latitude)>90||Math.abs(t.longitude)>180)return null;const r=Math.PI/180,h=Math.sin((t.latitude-l.latitude)*r/2)**2+Math.cos(l.latitude*r)*Math.cos(t.latitude*r)*Math.sin((t.longitude-l.longitude)*r/2)**2;return 6371*2*Math.asin(Math.sqrt(Math.min(1,h)));}
export function gpsMotion(a:Pick<GpsPoint,'latitude'|'longitude'|'accuracy'|'timestamp'>|null|undefined,b:Pick<GpsPoint,'latitude'|'longitude'|'accuracy'|'timestamp'>|null|undefined){
 if(!a||!b||![a,b].every(p=>Number.isFinite(p.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180&&Number.isFinite(p.accuracy)&&p.accuracy>=0&&p.accuracy<=50))return null;
 const seconds=(Date.parse(b.timestamp)-Date.parse(a.timestamp))/1000;if(!Number.isFinite(seconds)||seconds<1||seconds>60)return null;
 const r=Math.PI/180,lat1=a.latitude*r,lat2=b.latitude*r,dl=(b.longitude-a.longitude)*r;
 const h=Math.sin((lat2-lat1)/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dl/2)**2;
 const meters=6371000*2*Math.asin(Math.sqrt(Math.min(1,h)));if(meters/seconds>55)return null;
 const moving=meters>Math.max(10,a.accuracy+b.accuracy);
 const bearing=moving?(Math.atan2(Math.sin(dl)*Math.cos(lat2),Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dl))*180/Math.PI+360)%360:null;
 return {meters:moving?meters:0,speed:moving?meters/seconds*3.6:0,bearing};
}
export const bearingLabel=(bearing:number|null|undefined)=>bearing==null?'غير متاح':['شمال','شمال شرق','شرق','جنوب شرق','جنوب','جنوب غرب','غرب','شمال غرب'][Math.round(bearing/45)%8];
export const driverMotion=(d:MapDriver)=>gpsMotion(d.previousLocation,d.location?{...d.location,timestamp:d.location.updatedAt}:null);
// Render only recorded points: a straight connection would imply unobserved movement.
export const routeGeoJson=(points:GpsPoint[])=>({type:'FeatureCollection' as const,features:points.map(p=>({type:'Feature' as const,properties:{timestamp:p.timestamp,endpoint:p===points[0]?'start':p===points.at(-1)?'last':'point'},geometry:{type:'Point' as const,coordinates:[p.longitude,p.latitude]}}))});
// Connect consecutive observations only; never bridge GPS gaps or impossible jumps.
export function routeSegments(points:GpsPoint[]){
 const lines:number[][][]=[];
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i];
  if(gpsMotion(a,b))lines.push([[a.longitude,a.latitude],[b.longitude,b.latitude]]);
 }
 return {type:'Feature' as const,properties:{},geometry:{type:'MultiLineString' as const,coordinates:lines}};
}
