import type { ReceptionSnapshot } from './reception-api';
import type { CallEvent } from './call-events';
export type OfficeDriver = { id: string; fullName: string; phone: string; phoneLocal: string; whatsappPhone: string; whatsappCountryCode: '+970' | '+972'; hasWhatsApp: boolean; whatsappEnabled: boolean; active: boolean; isActive?: boolean; status: 'Available' | 'Busy' | 'Offline' | 'Suspended'; nationalId: string; address: string; dateOfBirth: string | null; licenseNumber: string; licenseType: string; licenseIssueDate: string | null; licenseExpiryDate: string | null; hireDate: string | null; notes: string; currentVehicleId: string | null };
export type VehicleAssignment = { id: string; driverId: string; vehicleId: string; startedAt: string; endedAt: string | null; changedBy: string | null; notes: string; plate: string; make: string; model: string };
export type QueueLocation = { id: string; name: string; isActive: boolean; sortOrder: number };
export type DriverQueueMutation = { type: 'add' | 'transfer' | 'remove' | 'up' | 'down' | 'move'; driverId: string; queueLocationId: string | null; beforeDriverId?: string; vehicleId?: string; confirmTransfer?: boolean; fromLocationId?: string | null };
export type OfficeVehicle = { id: string; driverId: string; vehicleClassId: string; plate: string; make: string; model: string; color: string; year: number | null; registrationExpiryDate?: string | null; insuranceExpiryDate?: string | null; active: boolean; status: 'ACTIVE' | 'MAINTENANCE' | 'OFFLINE' };
export type OfficeData = { currentUser?:{username:string}; today: string; officeWhatsAppNumber: string; driverEligibility?: DriverEligibility[]; drivers: OfficeDriver[]; vehicles: OfficeVehicle[]; classes: { id: string; name: string }[]; reception: ReceptionSnapshot; calls: CallEvent[] };
export const liveRideStatuses = ['assigned','driver-accepted','driver-arriving','arrived','in-progress'];
export function officeDriverStatus(driver: OfficeDriver, data: OfficeData) {
  if (driver.status === 'Suspended') return 'SUSPENDED';
  if (data.reception.rides.some(r => r.driverId === driver.id && liveRideStatuses.includes(r.status))) return 'BUSY';
  if (!driver.active || driver.status === 'Offline') return 'OFFLINE';
  if (driver.status === 'Busy') return 'BUSY';
  return data.reception.queue?.some(q=>q.driverId===driver.id) || data.reception.shifts.some(s => s.driverId === driver.id && s.status === 'active') || driver.status === 'Available' ? 'AVAILABLE' : 'OFFLINE';
}
export function driverVehicle(driver: OfficeDriver, data: OfficeData) { return data.vehicles.find(v => v.id === driver.currentVehicleId); }
export function vehicleLabel(vehicle?: OfficeVehicle) { return vehicle ? `${vehicle.plate} | ${vehicle.make} ${vehicle.model}`.trim() : 'غير مرتبط بسيارة'; }
export function searchDrivers(data: OfficeData, query: string) { const value=query.trim().toLocaleLowerCase(); return data.drivers.filter(d=>`${d.fullName} ${d.phoneLocal??d.phone} ${d.nationalId??''} ${vehicleLabel(driverVehicle(d,data))}`.toLocaleLowerCase().includes(value)); }
export function officeMetrics(data: OfficeData) {
 const today = data.reception.rides.filter(r => r.orderDay === data.today);
 return {today: today.length, active: data.reception.rides.filter(r => ['pending','waiting',...liveRideStatuses].includes(r.status)).length,
 available: data.drivers.filter(d => officeDriverStatus(d,data)==='AVAILABLE').length, busy: data.drivers.filter(d => officeDriverStatus(d,data)==='BUSY').length,
 vehicles: data.vehicles.length, completed: today.filter(r=>r.status==='completed').length};
}

export type DriverEligibility={driverId:string;username:string|null;accountActive:boolean;online:boolean;available:boolean;vehicleReady:boolean;locationStatus:string;locationUpdatedAt:string|null;locationAccuracy:number|null;driverConnection?:{connected:boolean;lastSeenAt:string|null};radioConnection?:{connected:boolean;lastSeenAt:string|null};voiceState?:{connected:boolean;talking:boolean;channels:string[]};eligible:boolean;reasons:string[]};
export const eligibilityLabels:Record<string,string>={DRIVER_APP_DISABLED:'تطبيق السائق موقوف',INACTIVE:'السائق معطّل',ACCOUNT_DISABLED:'حساب التطبيق معطّل',OFFLINE:'غير متصل / غير متاح',BUSY:'مشغول',NO_LOCATION:'GPS غير موجود',STALE_LOCATION:'الموقع قديم',POOR_ACCURACY:'دقة GPS غير كافية',NO_LINKED_VEHICLE:'لا توجد سيارة مرتبطة',NO_READY_VEHICLE:'السيارة غير جاهزة',ACTIVE_ORDER:'مشغول برحلة'};
