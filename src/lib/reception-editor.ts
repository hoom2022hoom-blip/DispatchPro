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

  if (activeRideStatuses.includes(values.status) && !ride.driverId) throw new Error('احفظ بيانات الطلب ثم عيّن السائق من خانته في الجدول');
  return {
    ...ride,
    passengerName: values.passengerName.trim(),
    pickup: { ...ride.pickup, name: values.address.trim() },
    ...(ride.rideRequestId || ride.receptionPending ? { addressText: values.address.trim(), ...(ride.pickup.name !== values.address.trim() ? { savedAddressId: null, locationSource: ride.latitude!=null&&ride.longitude!=null?ride.locationSource:'MANUAL_TEXT' as const } : {}) } : {}),
    addressStatus: values.addressStatus,
    addressType: values.addressStatus==='variable'?'VARIABLE':'FIXED',
    dispatchStatus: undefined,
    notes: values.notes.trim(),
    status: values.status,
    receptionPending: false,
    ...(values.status === 'cancelled' ? { driverId: null, shiftId: null, assignedAt: undefined } : {}),
  };
}
