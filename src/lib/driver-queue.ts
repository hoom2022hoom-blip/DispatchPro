export type QueueEntry = { shiftId: string; joinedAt: string; id?: string; driverId?: string; queueLocationId?: string | null; position?: number; enteredAt?: string; status?: string };
export type QueueAction = { type: 'add' | 'remove' | 'up' | 'down' | 'move'; shiftId: string; now?: string; beforeShiftId?: string };

export function changeQueue(entries: QueueEntry[], action: QueueAction): QueueEntry[] {
  const result = entries.map(entry => ({ ...entry }));
  const index = result.findIndex(entry => entry.shiftId === action.shiftId);
  if (action.type === 'add') {
    if (index < 0) result.push({ shiftId: action.shiftId, joinedAt: action.now ?? new Date().toISOString() });
  } else if (action.type === 'remove') {
    if (index >= 0) result.splice(index, 1);
  } else if (action.type === 'move' && index >= 0 && action.beforeShiftId !== action.shiftId) {
    const [entry] = result.splice(index, 1);
    const target = result.findIndex(item => item.shiftId === action.beforeShiftId);
    result.splice(target < 0 ? result.length : target, 0, entry);
  } else if (index >= 0) {
    const target = action.type === 'up' ? index - 1 : index + 1;
    if (target >= 0 && target < result.length) [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}
