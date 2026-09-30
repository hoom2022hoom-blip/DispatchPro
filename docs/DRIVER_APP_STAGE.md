# Driver App / Notifications — 2026-09-29

## Resume here

Previous Office/Admin, reports, reception, iCall, WhatsApp and Site Bridge work was retained. No imports, network configuration changes, vehicle-assignment migrations or Customer App work were performed.

The existing Next.js `/driver` route now uses the existing ASP.NET tenant login and driver permission. It is a browser/PWA MVP, not Flutter (no Flutter project was present). The legacy Firebase driver components remain on disk, but `/driver` no longer mounts them. The configured `DISPATCHPRO_API_URL` and existing authenticated `/api/reception` proxy are reused.

Implemented: login/logout; Available/Offline; request card; accept/reject; customer/contact/location/notes after acceptance; Arrived → InProgress → Completed; paged history; driver and office notices; connection status; bounded exponential retry; no automatic replay of writes. Tokens are held in memory, expire under the existing 30-minute authentication policy, and are cleared on logout. Browser notification permission is requested only from a button.

## Existing model preserved

- Ride states remain Pending, Assigned, Accepted, Arrived, InProgress, Completed, Cancelled. Reject returns an Assigned ride to Pending and clears its driver; a durable Rejected audit notice records the decision. Version/ownership checks protect writes.
- DriverVehicleAssignment/history and CurrentVehicleId are untouched. Availability does not require a vehicle. Going Offline removes the driver's queue entry after verifying there is no active order.
- Completion uses existing RidePrice.FinalPrice when a price record exists, otherwise the office order's recorded totalFare (including zero). It does not create pricing rules or invent an amount.
- A necessary availability bug was fixed: reception cannot send an active request to an Offline driver, and an old shift/queue entry cannot make an Offline driver display as Available. No other reception behavior was changed.

## Notifications

Durable notices reuse AuditLog. Ride mutations record safe status/recipient notices within the same transaction, including office/reception assignments. No customer name, phone or notes enter notification payloads before acceptance. Driver reads are scoped to the authenticated driver and tenant.

A lightweight process signal wakes a single outstanding request after commit. The 25-second timeout catches writes made through other API processes; there is no rapid client polling. Failed connections back off to 60 seconds. Driver and office browser notifications complement the in-app feed. Authenticated API data stays in the existing NetworkOnly PWA route cache policy.

**Boundary:** browser delivery requires the app to remain open; a closed or OS-suspended app has no guaranteed push delivery. There is no configured Web Push/FCM provider or native mobile app in this stage. Reopening the app recovers the durable feed after login. Read markers are local to the current UI session.

## Verification (new tests only)

- `tests/driver-app.test.mjs`: 4 passed (API authentication/logout, versions, proxy, errors, notification fallback).
- `tests/driver-app-render.test.mjs`: 1 passed (actual React screen, privacy before accept, lifecycle, offline disabling, history, logout).
- `tests/driver-availability.test.mjs`: 1 passed (Offline overrides a stale shift/queue).
- `DriverAppTests`: 1 real PostgreSQL integration scenario passed, no skips (auth, ownership/privacy, availability, assignment, commit wake-up, reject, lifecycle, history, notices, unchanged vehicle history).
- `DriverOfflineReceptionTests`: 1 real PostgreSQL scenario passed, no skips (Offline refusal and notice generation from the existing reception save route).
- `npm.cmd run typecheck`: passed.
- `npm.cmd run build`: passed, invoked once; existing Handlebars/Genkit bundler warnings remain. `/driver` output: 5.07 kB route / 107 kB first-load JavaScript.

The existing project-local PostgreSQL test cluster was started on its existing loopback endpoint and stopped after verification. Tests created and removed only randomized disposable databases. The initial backend test compilation encountered the already-running API executable lock; test output was redirected to `bin/DriverStage/` with `UseAppHost=false`, without stopping the running API. Existing successful test suites were not rerun.

## Operational follow-up

Load the updated API and frontend in the normal deployment/restart window; this task does not replace the currently running API process. No database migration is required. Validate delivery and reconnect behavior on the actual driver's phone/browser. If receiving requests with the app fully closed is required, configure and test a push provider in a separate driver follow-up. Customer App remains unstarted.
