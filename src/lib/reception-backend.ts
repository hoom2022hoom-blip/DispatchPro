import type { Ride } from './types';
import type { QueueAction } from './driver-queue';
import type { CallEvent } from './call-events';
import { apiReceptionBackend } from './reception-api';

/** Stable reception write contract; storage providers retain atomic numbering/assignment. */
export interface ReceptionBackend {
  receiveCall(event: CallEvent): Promise<void>;
  saveRide(ride: Ride): Promise<void>;
  ensureRideNumber(ride: Ride): Promise<void>;
  changeQueue(action: QueueAction): Promise<void>;
}

// Lazy loading keeps local demo storage isolated from the production provider.
export const localReceptionBackend: ReceptionBackend = {
  async receiveCall(event) { await (await import('./local-reception')).receiveLocalCall(event); },
  async saveRide(ride) { await (await import('./local-reception')).saveLocalRide(ride); },
  async ensureRideNumber() { /* IndexedDB migration numbers existing requests. */ },
  async changeQueue(action) { await (await import('./local-reception')).updateLocalQueue(action); },
};

export const firestoreReceptionBackend: ReceptionBackend = {
  async receiveCall(event) { await (await import('./reception-firestore')).receiveFirestoreCall(event); },
  async saveRide(ride) { await (await import('./reception-firestore')).saveFirestoreRide(ride); },
  async ensureRideNumber(ride) { await (await import('./reception-firestore')).numberFirestoreRide(ride); },
  async changeQueue(action) { await (await import('./reception-firestore')).updateFirestoreQueue(action); },
};

export function getReceptionBackend(localDemo: boolean, useApi = process.env.NEXT_PUBLIC_RECEPTION_BACKEND === 'api'): ReceptionBackend {
  if (useApi) return apiReceptionBackend;
  return localDemo ? localReceptionBackend : firestoreReceptionBackend;
}
