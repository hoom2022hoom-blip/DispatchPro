# Current office reception

Open `/office/orders`. The request table occupies the flexible main area; the queue is approximately 23% at desktop widths and stacks on smaller screens. Queue rows contain position, driver name, location and entry time, plus explicit reorder/remove controls. Driver profiles no longer display queue metadata.

The unified queue is tenant-wide. Select **إضافة للدور**, search by driver name, choose the driver, then select an active QueueLocation. Locations remain independently editable at `/office/queue`, but do not partition positions. Adding does not require a vehicle or shift and creates no ReceptionShift. Reordering/removal renumbers the full tenant queue; location changes preserve position and entry time. Existing advisory locks and tenant-driver uniqueness prevent duplicate entries.

`UnifiedReceptionQueue` merges existing positions by entry time, previous position and ID, preserving IDs, locations and timestamps. It clears queue-to-shift references while retaining historical shift records and legacy endpoints for compatibility. Rollback is refused when direct queue entries exist rather than fabricating shifts or deleting entries.

The table columns are request number, time, phone, customer name, address, driver, status, send, cancel. Address text and FIXED/VARIABLE type are editable inline with no map requirement. AddressType is persisted on the existing RideRequest; reception payload carries the same value and the compatibility addressStatus field. Invalid/stale writes fail without overwriting the editor's draft.

Choosing a driver (search picker or drag from the queue) saves the choice without sending. The separate send button changes the state to SENT. **This is a local mock flow, not delivery to a driver application.** The current application uses the existing ReceptionBackend/API write route. `dispatchStatus` persists in ReceptionOrder.Payload, mapped to canonical ride states:

| Dispatch state | Existing ride state |
| --- | --- |
| PENDING | pending (legacy waiting accepted) |
| SENT | assigned |
| ACCEPTED | driver-accepted (legacy driver-arriving accepted) |
| REJECTED | waiting |
| ARRIVED | arrived |
| STARTED | in-progress |
| COMPLETED | completed |
| CANCELLED | cancelled |

Each state has text and color. Manual state changes use the same tenant/permission/version checks as reception edits. A `reception.status-changed` AuditLog stores ActorId, EntityId, CreatedAt and JSON Detail with previous/next dispatch states in the transaction. Replay retries do not duplicate the transition. Canonical API transitions also project into this audit. Completed/cancelled orders retain the existing final-state guard. Active sends require an available driver and completed address; assigning/sending does not rotate or remove the queue.

Verification covers mounted React queue add/search/location controls, global display, order columns, inline address/type, driver selection and mock dispatch controls; PostgreSQL integration covers global 1/2/3 numbering, no shift creation, deduplication, moves/removal, entry-time retention, state audit and tenant isolation. The local Next proxy smoke uses the existing test Dispatcher on DispatchProTaxi and leaves only labeled test records and terminal requests, with its queue entries removed. No external integrations or network settings are changed.

Legacy local-demo/firestore queue behavior and historical shift management are retained for compatibility; the current API-backed office flow is the unified interface above.
