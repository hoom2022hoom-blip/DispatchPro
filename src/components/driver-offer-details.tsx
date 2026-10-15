"use client";
import type {DriverRide} from '@/lib/driver-api';

/** Displays only fields already supplied by the driver's authorized response. */
export function DriverOfferDetails({ride,now}:{ride:DriverRide;now:number}) {
  const expires=Date.parse(ride.offerExpiresAt??'');
  const remaining=Number.isFinite(expires)?Math.max(0,Math.ceil((expires-now)/1000)):null;
  const money=(value:number)=>`${value} ${!ride.currency||ride.currency==='ILS'?'₪':ride.currency}`;
  return <div className="driver-offer-details" aria-label="تفاصيل الطلب قبل القبول">
    <h2>طلب جديد</h2>
    <dl className="driver-offer-route">
      <div><dt>الزبون</dt><dd>{ride.fullName?.trim()||'الاسم غير متاح قبل القبول'}</dd></div>
      <div><dt>الانطلاق</dt><dd>{ride.pickup?.trim()||'يحدده المكتب'}</dd></div>
      <div><dt>الوجهة</dt><dd>{ride.destination?.trim()||'الوجهة غير محددة'}</dd></div>
    </dl>
    <dl className="driver-offer-metrics">
      <div><dt>السعر</dt><dd>{ride.finalFare!=null?money(ride.finalFare):ride.estimatedPrice!=null?`تقديري: ${money(ride.estimatedPrice)}`:'السعر لم يحدد بعد'}</dd></div>
      <div><dt>المسافة إلى الزبون</dt><dd>{ride.offerDistanceMeters!=null?`${(ride.offerDistanceMeters/1000).toFixed(1)} كم تقريبًا`:'غير متوفرة'}</dd></div>
      <div><dt>الوصول التقديري</dt><dd>{ride.offerEtaSeconds!=null?`${Math.ceil(ride.offerEtaSeconds/60)} دقيقة`:'غير متوفر'}</dd></div>
      <div className="driver-offer-deadline"><dt>مهلة الرد</dt><dd role={remaining==null?undefined:'timer'}>{remaining==null?'غير محددة':remaining===0?'انتهت المهلة':`${remaining} ثانية`}</dd></div>
    </dl>
  </div>;
}
