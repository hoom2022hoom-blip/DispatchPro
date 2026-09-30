import type { RideStatus } from './types';

// Preserve existing persisted values during the gradual backend migration.
export const statusLabels: Record<RideStatus, string> = {
  pending: 'جديد', waiting: 'انتظار', assigned: 'تم التعيين',
  'driver-accepted': 'قبل السائق', 'driver-arriving': 'السائق في الطريق', arrived: 'وصل السائق',
  'in-progress': 'في الرحلة', completed: 'مكتمل', cancelled: 'ملغي',
};
export const activeRideStatuses = ['assigned', 'driver-accepted', 'driver-arriving', 'arrived', 'in-progress'];
