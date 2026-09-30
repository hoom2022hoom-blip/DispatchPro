import { doc, runTransaction, serverTimestamp, deleteField, collection, getDocs } from 'firebase/firestore';
import { callReceptionRide, findCallCustomer, type ReceptionCustomer } from './call-reception';
import type { CallEvent } from './call-events';
import { db } from './firebase';
import type { Ride } from './types';
import { businessDay } from './ride-numbering';
import { activeRideStatuses } from './ride-status';
import { changeQueue, type QueueAction, type QueueEntry } from './driver-queue';

export async function saveFirestoreRide(ride: Ride, createOnly = false) {
  if (ride.receptionPending && activeRideStatuses.includes(ride.status)) throw new Error('أكمل بيانات الاستقبال قبل تعيين السائق');
  if (activeRideStatuses.includes(ride.status) && (!ride.driverId || !ride.shiftId)) throw new Error('اختر سائقًا ووردية نشطة');
  const reference = doc(db, 'rides', ride.id);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    const existing = snapshot.data();
    if (createOnly && snapshot.exists()) return;
    const day = existing?.orderDay ?? businessDay(existing?.createdAt?.toDate?.() ?? ride.createdAt);
    const counterRef = doc(db, 'rideCounters', day);
    const counter = !existing?.orderNumber ? await transaction.get(counterRef) : null;
    const orderNumber = existing?.orderNumber ?? (counter?.data()?.value ?? 0) + 1;
    const queueRef = doc(db, 'dispatch', 'driverQueue');
    const queue = await transaction.get(queueRef);
    const assigning = activeRideStatuses.includes(ride.status) && ride.driverId && ride.shiftId;
    const assignmentRef = assigning ? doc(db, 'dispatchAssignments', ride.driverId!) : null;
    if (assigning && assignmentRef) {
      const shift = await transaction.get(doc(db, 'shifts', ride.shiftId!));
      if (shift.data()?.status !== 'active' || shift.data()?.driverId !== ride.driverId) throw new Error('الوردية غير متاحة');
      const assignment = await transaction.get(assignmentRef);
      const otherId = assignment.data()?.rideId;
      if (otherId && otherId !== ride.id) {
        const other = await transaction.get(doc(db, 'rides', otherId));
        if (other.data()?.driverId === ride.driverId && activeRideStatuses.includes(other.data()?.status)) throw new Error('السائق مشغول بطلب آخر');
      }
    }
    // All transaction reads precede writes. The assignment lock is checked against its ride
    // so existing driver screens can complete/cancel rides without changing their code.
    if (!existing?.orderNumber) transaction.set(counterRef, { value: orderNumber });
    const { id, ...data } = ride;
    const fields = Object.fromEntries(Object.entries({
      ...data, orderDay: day, orderNumber,
      createdAt: existing?.createdAt ?? serverTimestamp(), updatedAt: serverTimestamp(),
    }).filter(([, value]) => snapshot.exists() || value !== undefined)
      .map(([key, value]) => [key, value === undefined ? deleteField() : value]));
    transaction.set(reference, fields, { merge: true });
    if (assigning && assignmentRef) {
      transaction.set(assignmentRef, { rideId: ride.id });
      transaction.set(queueRef, { entries: changeQueue(queue.data()?.entries ?? [], { type: 'remove', shiftId: ride.shiftId! }) });
    }
  });
}

export async function receiveFirestoreCall(event: CallEvent) {
  if (!['WHATSAPP', 'LANDLINE_ICALL'].includes(event.source)) return;
  // Existing customer accounts remain compatible; normalized matching accepts local/international formatting.
  const users = await getDocs(collection(db, 'users'));
  const customer = findCallCustomer(users.docs.map(item => ({ ...item.data(), id: item.id } as ReceptionCustomer)), event.phone);
  const ride = await callReceptionRide(event, customer);
  if (ride) await saveFirestoreRide(ride, true);
}

export async function numberFirestoreRide(ride: Ride) {
  const reference = doc(db, 'rides', ride.id);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    const existing = snapshot.data();
    if (!existing || existing.orderNumber) return;
    const day = businessDay(existing.createdAt?.toDate?.() ?? ride.createdAt);
    const counterRef = doc(db, 'rideCounters', day);
    const counter = await transaction.get(counterRef);
    const number = (counter.data()?.value ?? 0) + 1;
    transaction.set(counterRef, { value: number });
    transaction.update(reference, { orderDay: day, orderNumber: number });
  });
}

export async function updateFirestoreQueue(action: QueueAction) {
  const reference = doc(db, 'dispatch', 'driverQueue');
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (action.type === 'add') {
      const shift = await transaction.get(doc(db, 'shifts', action.shiftId));
      if (shift.data()?.status !== 'active') throw new Error('الوردية غير نشطة');
      const assignment = await transaction.get(doc(db, 'dispatchAssignments', shift.data()!.driverId));
      if (assignment.data()?.rideId) {
        const ride = await transaction.get(doc(db, 'rides', assignment.data()!.rideId));
        if (ride.data()?.driverId === shift.data()!.driverId && activeRideStatuses.includes(ride.data()?.status)) throw new Error('السائق مشغول');
      }
    }
    transaction.set(reference, { entries: changeQueue((snapshot.data()?.entries ?? []) as QueueEntry[], action) });
  });
}
