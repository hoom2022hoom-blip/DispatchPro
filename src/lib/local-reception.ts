import Dexie, { type Table } from 'dexie';
import type { Ride, Driver, Vehicle, Shift } from './types';
import { businessDay, numberLegacyRides } from './ride-numbering';
import { changeQueue, type QueueEntry, type QueueAction } from './driver-queue';
import { activeRideStatuses } from './ride-status';
import { callReceptionRide, findCallCustomer, type ReceptionCustomer } from './call-reception';
import type { CallEvent } from './call-events';

// Demo requests must never enter the production offline synchronization queue.
const database = new Dexie('DispatchProReceptionDemo');
database.version(1).stores({ rides: 'id,createdAt' });
database.version(2).stores({
  rides: 'id,createdAt,orderDay,[orderDay+orderNumber]', counters: 'day',
  drivers: 'id', vehicles: 'id', shifts: 'id', queue: 'id',
}).upgrade(async transaction => {
  const rides = numberLegacyRides<Ride>(await transaction.table('rides').toArray());
  if (rides.length) await transaction.table('rides').bulkPut(rides);
  const counters = new Map<string, number>();
  rides.forEach(ride => counters.set(ride.orderDay!, Math.max(counters.get(ride.orderDay!) ?? 0, ride.orderNumber!)));
  for (const [day, value] of counters) await transaction.table('counters').put({ day, value });
});
database.version(3).stores({ customers: 'id,phoneNumber' });
export const localCustomers: Table<ReceptionCustomer, string> = database.table('customers');
export const localRides: Table<Ride, string> = database.table('rides');
export const localDrivers: Table<Driver, string> = database.table('drivers');
export const localVehicles: Table<Vehicle, string> = database.table('vehicles');
export const localShifts: Table<Shift, string> = database.table('shifts');
export const localQueue: Table<{ id: string; entries: QueueEntry[] }, string> = database.table('queue');
const counters: Table<{ day: string; value: number }, string> = database.table('counters');

export async function saveLocalRide(ride: Ride, createOnly = false): Promise<Ride> {
  return database.transaction('rw', [localRides, counters, localQueue, localShifts], async () => {
    const existing = await localRides.get(ride.id);
    if (createOnly && existing) return existing;
    if (ride.receptionPending && activeRideStatuses.includes(ride.status)) throw new Error('أكمل بيانات الاستقبال قبل تعيين السائق');
    const day = existing?.orderDay ?? businessDay(ride.createdAt);
    let number = existing?.orderNumber;
    if (!number) {
      number = ((await counters.get(day))?.value ?? 0) + 1;
      await counters.put({ day, value: number });
    }
    if (activeRideStatuses.includes(ride.status)) {
      const shift = ride.shiftId ? await localShifts.get(ride.shiftId) : undefined;
      if (!shift || shift.status !== 'active' || shift.driverId !== ride.driverId) throw new Error('الوردية غير متاحة');
      const busy = (await localRides.toArray()).some(other => other.id !== ride.id && other.driverId === ride.driverId && activeRideStatuses.includes(other.status));
      if (busy) throw new Error('السائق مشغول بطلب آخر');
    }
    const saved = { ...ride, createdAt: existing?.createdAt ?? ride.createdAt, orderDay: day, orderNumber: number };
    await localRides.put(saved);
    if (ride.shiftId && activeRideStatuses.includes(ride.status)) {
      const queue = (await localQueue.get('main'))?.entries ?? [];
      await localQueue.put({ id: 'main', entries: changeQueue(queue, { type: 'remove', shiftId: ride.shiftId }) });
    }
    return saved;
  });
}

export async function receiveLocalCall(event: CallEvent) {
  const customer = findCallCustomer(await localCustomers.toArray(), event.phone);
  const ride = await callReceptionRide(event, customer);
  if (ride) await saveLocalRide(ride, true);
}

export async function updateLocalQueue(action: QueueAction) {
  return database.transaction('rw', [localQueue, localShifts, localRides], async () => {
    if (action.type === 'add') {
      const shift = await localShifts.get(action.shiftId);
      if (!shift || shift.status !== 'active') throw new Error('الوردية غير نشطة');
      if ((await localRides.toArray()).some(ride => ride.driverId === shift.driverId && activeRideStatuses.includes(ride.status))) throw new Error('السائق مشغول');
    }
    await localQueue.put({ id: 'main', entries: changeQueue((await localQueue.get('main'))?.entries ?? [], action) });
  });
}

export async function createLocalShift(name: string, car: string) {
  name = name.trim(); car = car.trim();
  if (!name || !car) throw new Error('أدخل اسم السائق والسيارة');
  return database.transaction('rw', [localDrivers, localVehicles, localShifts, localQueue], async () => {
    const drivers = await localDrivers.toArray();
    const vehicles = await localVehicles.toArray();
    const driver = drivers.find(item => item.name === name);
    const vehicle = vehicles.find(item => item.nickname === car);
    if ((await localShifts.toArray()).some(shift => shift.status === 'active' && (shift.driverId === driver?.id || shift.vehicleId === vehicle?.id))) throw new Error('السائق أو السيارة في وردية بالفعل');
    const id = crypto.randomUUID(), driverId = driver?.id ?? crypto.randomUUID(), vehicleId = vehicle?.id ?? crypto.randomUUID();
    await localDrivers.put({ id: driverId, name, phoneNumber: driver?.phoneNumber ?? '', rating: driver?.rating ?? 0, status: 'on-shift', location: driver?.location ?? { x: 32.2211, y: 35.2544 }, currentShiftId: id });
    await localVehicles.put({ id: vehicleId, nickname: car, make: '', model: '', year: null, vin: '', mileage: null, status: 'active', createdAt: vehicle?.createdAt ?? new Date(), updatedAt: new Date(), currentShiftId: id });
    await localShifts.put({ id, driverId, vehicleId, status: 'active', startTime: new Date() });
    await localQueue.put({ id: 'main', entries: changeQueue((await localQueue.get('main'))?.entries ?? [], { type: 'add', shiftId: id }) });
  });
}
