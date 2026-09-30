# Independent customer dispatch

Customer: http://127.0.0.1:9005/customer-mobile/index.html?office=office-test-ba6da3f686

Driver: http://127.0.0.1:9005/driver-mobile/index.html

Office: http://127.0.0.1:9005/office/orders

Customer device authentication remains separate from office authentication. Customer requests now start `AUTO_NEAREST` on the server even when the office's reception policy is `MANUAL`. The existing hosted worker handles sequential offers, rejection and expiration without an open office browser. Office overrides still stop automatic dispatch for that ride.

The customer interface requests GPS when the customer opens their account, supports map selection for pickup/destination and requires a pickup point for new automatic requests. Existing API text-address clients remain compatible. Driver offers include pickup/destination coordinates, distance and a countdown; expired acceptance is disabled in the UI and rejected on the server.

The additive `rideStatus` field exposes `SEARCHING_DRIVER`, `DRIVER_ASSIGNED`, `DRIVER_ARRIVING`, `DRIVER_ARRIVED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`. An unaccepted offer remains `SEARCHING_DRIVER`; legacy `status` and `workflowStatus` values remain available. Driver identity, car and live GPS appear to the customer after acceptance.

Automatic candidates must be active, available, have fresh GPS, have no other active ride and have a ready vehicle. Existing fleet records with a null `CurrentVehicleId` are supported when exactly one active, ready vehicle is linked through `Vehicle.DriverId`; ambiguous vehicle associations are not guessed. No schema migration or existing data rewrite was needed.

## Verification on 2026-09-30

- `node scripts/test-independent-customer.mjs`: new end-to-end test against a disposable real PostgreSQL/PostGIS database. Office stays in `MANUAL`, and first office login occurs after customer creation, nearest offer, rejection, real worker timeout and acceptance. Covers stale/offline/inactive/busy/maintenance exclusion, one driver at a time, duplicate request replay, late acceptance denial, car/tracking visibility, all lifecycle states, reception reassignment and cancellation.
- `node tests/independent-customer-ui.test.mjs`: customer account → automatic browser geolocation callback → map destination → request with customer token only; missing pickup coordinates block submission. This is a simulated browser environment, not a physical GPS test.
- `node scripts/verify-independent-customer.mjs`: actual Next proxy → deployed local API → existing PostgreSQL test tenant. Customer request and acceptance precede office login. Customer acceptance update: 175 ms; office arriving update: 68 ms. A second authenticated GPS fix updated customer tracking. The test request was cancelled and the prior test GPS restored. Evidence: ignored `.dispatchpro-local/independent-customer-live-result.json`.
- TypeScript check, API Release publish and driver web bundle completed. The unrelated prior test suites were not rerun.

The current local API binary is `.dispatchpro-local/gps-dispatch-api/DispatchPro.Api.dll` on port 9010, recorded in `.dispatchpro-local/automatic-dispatch-activation.json`. Normal startup remains `Start-DispatchPro.cmd` using the existing project. The frontend remains on port 9005. See [real-phone LAN GPS diagnosis](DRIVER_GPS_LAN_FIX.md) for the subsequent HTTPS fix.

## Completion verification on 2026-09-30

The existing automatic-dispatch implementation and working-tree changes were preserved. The remaining API status-transition issue was fixed: completing or cancelling a ride releases a Busy driver, but preserves an Offline driver instead of bringing them online implicitly. Two real PostgreSQL regression scenarios cover both terminal transitions.

- Existing `CompleteHailingStageTests` plus `IndependentCustomerDispatchTests`: 16 passed, none skipped. Covers the ten requested scenarios, concurrent requests, cancellation/acceptance race, and eligibility changes while an offer is pending.
- New completion/cancellation Offline regression cases: 2 passed, none skipped.
- Selected customer/driver/reception/GPS UI and proxy tests: 12 passed after updating two stale expectations for the accepted-driver text and distinct full-row colors.
- TypeScript typecheck, API Release publish, and driver web bundle succeeded. No new migration or production data rewrite was required.
- Live verification through the existing Next proxy and the updated local API passed: customer request and nearest-driver acceptance before office login, customer update in 411 ms, office update in 175 ms, and a second GPS tracking update. All three application URLs returned HTTP 200. The test ride was cancelled and the previous test-driver GPS restored.

Physical location permission and interactive phone/browser testing remain unverified because no browser is connected to the automation tool. Coordinates in automated tests are synthetic. These localhost URLs are for this computer; no public deployment, tunnel, firewall, payment or pricing changes were made.
