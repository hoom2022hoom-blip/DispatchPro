import type { Ride, RideStatus } from './types';
import { activeRideStatuses } from './ride-status';

export type ReceptionEdit = {
  passengerName: string;
  address: string;
  addressStatus: 'default' | 'variable';
  notes: string;
  status: RideStatus;
};

export function applyReceptionEdit(ride: Ride, values: ReceptionEdit, optionalAddress = false): Ride {
  if ((!optionalAddress || values.address.trim().length > 0) && values.address.trim().length < 3 && values.status !== 'cancelled' && (ride.latitude == null || ride.longitude == null)) throw new Error('أدخل عنوانًا من ثلاثة أحرف على الأقل أو حدد نقطة على الخريطة');
  if (activeRideStatuses.includes(values.status) && !ride.driverId) throw new Error('احفظ بيانات الطلب ثم عيّن السائق من خانته في الجدول');
  return {
    ...ride,
    passengerName: values.passengerName.trim(),
    pickup: { ...ride.pickup, name: values.address.trim() },
    ...(ride.rideRequestId ? { addressText: values.address.trim(), ...(ride.pickup.name !== values.address.trim() ? { savedAddressId: null, locationSource: 'MANUAL_TEXT' as const } : {}) } : {}),
    addressStatus: values.addressStatus,
    addressType: values.addressStatus==='variable'?'VARIABLE':'FIXED',
    dispatchStatus: undefined,
    notes: values.notes.trim(),
    status: values.status,
    receptionPending: false,
    ...(values.status === 'cancelled' ? { driverId: null, shiftId: null, assignedAt: undefined } : {}),
  };
}
