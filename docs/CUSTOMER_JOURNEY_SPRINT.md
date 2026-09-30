# Customer journey — completed sprint, 2026-09-30

Continues the existing ASP.NET API, PostgreSQL/PostGIS, Next reception and customer/driver web apps. No parallel backend or replacement storage.

## Try locally

- Customer: http://127.0.0.1:9005/customer-mobile/index.html?office=office-test-ba6da3f686
- Driver: http://127.0.0.1:9005/driver-mobile/index.html
- Office: http://127.0.0.1:9005/office/reception
- Existing test credentials and step-by-step instructions: ignored `.dispatchpro-local/CUSTOMER-JOURNEY-TEST.md`.
- Normal subsequent startup: existing `Start-DispatchPro.cmd`. This sprint's running API is published in `.dispatchpro-local/customer-journey-api`; frontend is Next dev on the existing port 9005.

## Behavior

Customer GPS, map pins, textual pickup/destination and idempotent requests use the existing customer endpoints. Reception now subscribes to its existing snapshot endpoint with optional `?wait=true` and ETag, using the existing post-commit notification signal. Reads do not generate notification pulses. Old snapshot clients retain immediate GET/304 behavior.

Lifecycle: requested → assigned → Accepted → driver arriving → arrived → in trip → completed. Manual driver rejection is persisted as Rejected, clears assignment, releases the driver, appears red in reception and is visible to the customer; office can resend the same request. Existing automatic reject/next-driver behavior is preserved. Office cancellation synchronizes to the customer/driver and releases a busy driver.

`workflowStatus` adds the shared customer/reception values `DRIVER_ASSIGNED`, `ACCEPTED`, `DRIVER_ARRIVING`, `DRIVER_ARRIVED`, `IN_TRIP`, `COMPLETED`, `REJECTED`, `CANCELLED`. Existing API status spellings remain compatible. `DriverArriving=7` and `Rejected=8` are appended to the persisted enum, preserving all old integers. Older drivers can still go directly from Accepted to Arrived.

Migration `20260930092303_CustomerJourneyStates` extends the existing unique active-driver index to include arriving. It was applied to the local test DB after a custom-format backup; all pre-existing row counts and ID hashes were preserved. Evidence: `.dispatchpro-local/customer-journey-migration-result.json`.

Reception row colors: waiting/sent yellow, accepted green, rejected red, arriving/arrived/in trip blue, completed gray.

## Verification

- 8 real PostgreSQL integration tests passed, zero skipped: customer identity/isolation, customer → reception → authenticated driver lifecycle, refusal/resend, live notification wake, existing reception and automatic dispatch behavior.
- 28 focused Node tests passed across customer, GPS/maps, driver, reception, row colors, proxy and office session behavior. No complete unrelated test suite was run.
- TypeScript check, API Release publish, driver web bundle and actual Next routes passed.
- `node scripts/verify-customer-journey.mjs` passed through the actual frontend proxy and existing test accounts. Office saw creation in 235 ms. One request was completed after rejection/resend; a second was cancelled after acceptance/arriving. Both are labelled test requests; no real driver/customer was dispatched. History and driver release were verified.
- `.dispatchpro-local/customer-journey-live-result.json` records the IDs and observed states.

Physical GPS and a phone browser remain manually unverified: no browser is connected to the UI automation tool. The local URLs are for this computer; phone GPS requires the existing frontend to be served over authorized HTTPS. No tunnel, network, firewall or native APK changes were made. No subsequent sprint was started.
