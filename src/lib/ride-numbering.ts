export function businessDay(date: Date | string = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(date));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}

export type NumberedRide = { id: string; createdAt: Date; orderDay?: string; orderNumber?: number };

// Used only for previously unnumbered local records. Existing numbers are immutable.
export function numberLegacyRides<T extends NumberedRide>(rides: T[]): T[] {
  const counters = new Map<string, number>();
  for (const ride of rides) {
    if (ride.orderNumber && ride.orderDay) counters.set(ride.orderDay, Math.max(counters.get(ride.orderDay) ?? 0, ride.orderNumber));
  }
  return [...rides].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)).map(ride => {
    if (ride.orderNumber && ride.orderDay) return ride;
    const day = businessDay(ride.createdAt);
    const number = (counters.get(day) ?? 0) + 1;
    counters.set(day, number);
    return { ...ride, orderDay: day, orderNumber: number };
  });
}
