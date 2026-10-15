import type { OfficeDriver } from './office';
import type { Ride } from './types';

// Presentation only; callers retain their existing assignment eligibility.
export const driverGroups = [
  { label: 'متاح', color: 'bg-emerald-50 text-emerald-800', dot: 'bg-emerald-600' },
  { label: 'بانتظار القبول', color: 'bg-orange-50 text-orange-900', dot: 'bg-orange-500' },
  { label: 'مشغول', color: 'bg-red-50 text-red-800', dot: 'bg-red-600' },
  { label: 'غير متصل', color: 'bg-slate-100 text-slate-600', dot: 'bg-slate-500' },
] as const;

export function driverPresentation(driver: OfficeDriver, rides: Ride[]) {
  const active = rides.filter(ride => ride.driverId === driver.id && ['assigned', 'driver-accepted', 'driver-arriving', 'arrived', 'in-progress'].includes(ride.status));
  const group = driverStatusGroup(driver.active,driver.status,active.map(r=>r.status));
  return { driverGroup: group, waitingCount: rides.filter(ride => ride.queuedDriverId === driver.id).length };
}
export function driverStatusGroup(activeDriver:boolean,status:string,rideStatuses:string[]) {
  return !activeDriver || ['Offline', 'Suspended'].includes(status) ? 3
    : rideStatuses.some(status => status !== 'assigned') ? 2
    : rideStatuses.some(status => status === 'assigned') ? 1
    : status === 'Busy' ? 2 : 0;
}
