import type { Ride, RideStatus } from './types';
export type DispatchStatus = 'PENDING'|'SENT'|'ACCEPTED'|'REJECTED'|'ARRIVING'|'ARRIVED'|'STARTED'|'COMPLETED'|'CANCELLED';
export const dispatchStates: Record<DispatchStatus,{label:string;color:string;status:RideStatus}> = {
 PENDING:{label:'بانتظار الإرسال',color:'bg-slate-100 text-slate-700',status:'pending'},
 SENT:{label:'أُرسل للسائق',color:'bg-amber-100 text-amber-900',status:'assigned'},
 ACCEPTED:{label:'مقبول',color:'bg-green-100 text-green-800',status:'driver-accepted'},
 REJECTED:{label:'مرفوض',color:'bg-red-100 text-red-800',status:'waiting'},
 ARRIVING:{label:'السائق في الطريق',color:'bg-blue-100 text-blue-800',status:'driver-arriving'},
 ARRIVED:{label:'وصل السائق',color:'bg-blue-100 text-blue-800',status:'arrived'},
 STARTED:{label:'بدأت الرحلة',color:'bg-violet-100 text-violet-800',status:'in-progress'},
 COMPLETED:{label:'مكتمل',color:'bg-emerald-100 text-emerald-800',status:'completed'},
 CANCELLED:{label:'ملغي',color:'bg-slate-200 text-slate-700',status:'cancelled'},
};
export const receptionColumns=['\u0639\u062f\u062f','الوقت','الهاتف','اسم الزبون','العنوان','السائق','الحالة','إرسال','تكرار'];
export function receptionRowPresentation(ride:Ride):{color:string;label:string} {
 if(ride.rideStatus==='NO_DRIVER_AVAILABLE')return {color:'bg-rose-100 hover:bg-rose-200',label:'لا يوجد سائق متاح'};
 const state=dispatchState(ride);
 if(['PENDING','SENT'].includes(state)&&['REJECTED','TIMEOUT','UNAVAILABLE'].includes(ride.lastDispatchOutcome??''))return {color:'bg-orange-100 hover:bg-orange-200',label:ride.lastDispatchOutcome==='REJECTED'?'رفض السابق · الانتقال للسائق التالي':ride.lastDispatchOutcome==='TIMEOUT'?'انتهت المهلة · السائق التالي':'السائق غير متاح · الانتقال للتالي'};
 const colors:Record<DispatchStatus,string>={PENDING:'bg-yellow-50 hover:bg-yellow-100',SENT:'bg-amber-100 hover:bg-amber-200',ACCEPTED:'bg-green-100 hover:bg-green-200',REJECTED:'bg-orange-100 hover:bg-orange-200',ARRIVING:'bg-blue-100 hover:bg-blue-200',ARRIVED:'bg-cyan-100 hover:bg-cyan-200',STARTED:'bg-violet-100 hover:bg-violet-200',COMPLETED:'bg-gray-100 hover:bg-gray-200',CANCELLED:'bg-red-100 hover:bg-red-200'};
 return {color:colors[state],label:state==='PENDING'&&ride.dispatchMode!=='MANUAL'&&ride.rideStatus==='SEARCHING_DRIVER'?'جارٍ البحث عن سائق':dispatchStates[state].label};
}
export function dispatchState(ride:Ride):DispatchStatus {
 if(ride.status==='driver-arriving')return 'ARRIVING';
 if(ride.dispatchStatus && dispatchStates[ride.dispatchStatus])return ride.dispatchStatus;
 return ({assigned:'SENT','driver-accepted':'ACCEPTED','driver-arriving':'ARRIVING',arrived:'ARRIVED','in-progress':'STARTED',completed:'COMPLETED',cancelled:'CANCELLED'} as Partial<Record<RideStatus,DispatchStatus>>)[ride.status]??'PENDING';
}
export function changeDispatch(ride:Ride,state:DispatchStatus):Ride {
 if(['SENT','ACCEPTED','ARRIVING','ARRIVED','STARTED'].includes(state)&&!ride.driverId)throw new Error('اختر السائق أولًا');

 return {...ride,receptionPending:false,dispatchStatus:state,status:dispatchStates[state].status,shiftId:null,...(state==='CANCELLED'?{driverId:null}:{}),...(state==='SENT'?{assignedAt:new Date()}:{} )};
}

export function duplicateReceptionRide(ride: Ride, id: string, now = new Date()): Ride {
 const addressText = ride.addressText ?? ride.pickup.name;
 return {
  id,
  customerId: ride.customerId,
  passengerPhone: ride.passengerPhone,
  passengerName: ride.passengerName,
  addressText,
  addressStatus: ride.addressType === 'VARIABLE' || ride.addressStatus === 'variable' ? 'variable' : 'default',
  addressType: ride.addressType ?? (ride.addressStatus === 'variable' ? 'VARIABLE' : 'FIXED'),
  savedAddressId: ride.savedAddressId,
  latitude: ride.latitude,
  longitude: ride.longitude,
  locationSource: ride.locationSource,
  pickup: { name: addressText, coords: { x: ride.latitude ?? ride.pickup.coords.x, y: ride.longitude ?? ride.pickup.coords.y } },
  ...(ride.dropoff ? { dropoff: { ...ride.dropoff, coords: { ...ride.dropoff.coords } } } : {}),
  source: ride.source,
  notes: ride.notes,
  totalFare: 0,
  movingFee: false,
  status: 'pending',
  dispatchStatus: 'PENDING',
  driverId: null,
  createdAt: new Date(now),
  updatedAt: new Date(now),
  receptionPending: false,
 };
}
