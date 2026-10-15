import {driverTrace} from './driver-runtime-diagnostics.js';
/** @param {unknown} value @returns {Record<string,unknown>} */
const record=value=>value&&typeof value==='object'&&!Array.isArray(value)?/** @type {Record<string,unknown>} */(value):{};
/** @param {unknown} value */ const string=value=>typeof value==='string'?value:'';
const statuses=new Set(['Pending','Assigned','Accepted','DriverArriving','Rejected','Arrived','InProgress','Completed','Cancelled']);
export class DriverPayloadError extends Error{/** @param {string} field */ constructor(field){super('تعذر قراءة بيانات الرحلة؛ أعد تحديثها من المكتب');this.field=field;this.name='DriverPayloadError';driverTrace('payload-invalid',{kind:this.name,field});}}
/** @param {unknown} value @returns {import('./driver-api').DriverRide} */
export function normalizeDriverRide(value){
 const raw=record(value);
 if(!string(raw.id))throw new DriverPayloadError('ride.id');
 if(!statuses.has(string(raw.status)))throw new DriverPayloadError('ride.status');
 if(!Number.isSafeInteger(raw.version)||Number(raw.version)<0)throw new DriverPayloadError('ride.version');
 /** @type {Record<string,unknown>} */ const ride={id:raw.id,status:raw.status,version:raw.version,pickup:string(raw.pickup),destination:string(raw.destination)};
 for(const key of ['source','notes','fullName','phone','addressText','neighborhood','street','fareMode','fareSource','currency','startedAt','completedAt','meterStartedAt','offerExpiresAt'])if(key in raw)ride[key]=string(raw[key]);
 for(const key of ['finalFare','meterCalculatedFare','distanceKm','durationSeconds','waitingSeconds','offerDistanceMeters','offerEtaSeconds','estimatedPrice','latitude','longitude','destinationLatitude','destinationLongitude'])if(key in raw){const n=raw[key];ride[key]=typeof n==='number'&&Number.isFinite(n)?n:null;}
 for(const key of ['offerDistanceMeters','offerEtaSeconds','estimatedPrice'])if(typeof ride[key]==='number'&&Number(ride[key])<0)ride[key]=null;
 for(const key of ['latitude','destinationLatitude'])if(typeof ride[key]==='number'&&Math.abs(Number(ride[key]))>90)ride[key]=null;
 for(const key of ['longitude','destinationLongitude'])if(typeof ride[key]==='number'&&Math.abs(Number(ride[key]))>180)ride[key]=null;
 return /** @type {import('./driver-api').DriverRide} */(ride);
}
/** @param {unknown} value @returns {import('./driver-api').DriverProfile} */
export function normalizeDriverProfile(value){
 const raw=record(value);if(!string(raw.id)||!['Offline','Available','Busy','Suspended'].includes(string(raw.status)))throw new DriverPayloadError('driver.identity');
 return /** @type {import('./driver-api').DriverProfile} */({...raw,id:raw.id,fullName:string(raw.fullName)||'السائق',status:raw.status,currentVehicleId:string(raw.currentVehicleId)||null,vehicleNumber:string(raw.vehicleNumber),plate:string(raw.plate),allowDriverManualFare:raw.allowDriverManualFare===true});
}
/** @param {unknown} value @returns {import('./driver-api').DriverSnapshot} */
export function normalizeDriverSnapshot(value){
 const raw=record(value);if(!Array.isArray(raw.rides))throw new DriverPayloadError('snapshot.rides');
 const notices=(Array.isArray(raw.notices)?raw.notices:[]).flatMap(n=>{const r=record(n);return string(r.id)&&string(r.action)?[{id:string(r.id),action:string(r.action),entityId:string(r.entityId),createdAt:string(r.createdAt)}]:[];});
 const jobs=(Array.isArray(raw.jobs)?raw.jobs:[]).flatMap(j=>{const r=record(j);return string(r.id)?[{...r,id:string(r.id),pickup:string(r.pickup),destination:string(r.destination)}]:[];});
 return /** @type {import('./driver-api').DriverSnapshot} */({driver:normalizeDriverProfile(raw.driver),rides:raw.rides.map(normalizeDriverRide),notices,jobs});
}
