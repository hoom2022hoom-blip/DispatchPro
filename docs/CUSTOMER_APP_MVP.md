# Customer App MVP — 2026-09-29

Driver App core flow is field-verified by the user: Login, Available, receive, Accept, Arrived, Start, Complete, History and Reception synchronization all PASS. Do not repeat that phase.

## Run

The shared Android/iPhone web app is served from the existing frontend:

`http://127.0.0.1:9005/customer-mobile/index.html?office=office-test-ba6da3f686`

For a phone, use the same `/customer-mobile/index.html?office=...` path on the existing **office frontend HTTPS origin**, not the driver-only host. Open in Chrome on Android or Safari on iPhone and add to the home screen. No APK/IPA is produced. HTTPS is needed for optional geolocation and service workers. No network, DNS, tunnel or driver host changes are part of this work.

Static HTML/CSS/JS needs no frontend build. The new `src/app/api/customer/[...path]` Next route uses the existing `DISPATCHPRO_API_URL`. In development it is picked up automatically; a production frontend must include the route and updated NetworkOnly customer API cache rule in its next normal deployment. The existing ASP.NET API must run a binary containing `MapCustomerApp()`; no migration or import is required.

## Identity boundary

### Phone/recovery update — current behavior

Customer phones use the shared `CustomerPhone` policy: `+9705…`, `9705…`, `+9725…`, `9725…` and `05…` resolve to the same local `05…` value. Customer registration, lookup/search, duplicate comparison and Customer App request creation use it. Recovery normalizes the existing Customer and its linked request/passenger phone fields and Reception payloads, preserving customer IDs and workflow states.

Phone-only device recovery is enabled **only** when both `CustomerApp__TestPhoneRecoveryEnabled=true` and `CustomerApp__TestPhoneRecoveryTenant` match the requested tenant. The current ignored local configuration explicitly targets `office-test-ba6da3f686`. Default/other tenants still require verified recovery; no SMS is sent. Disable the override before production and connect verified OTP recovery there.

Recovery retains existing Customer and User records, adds a permission-free device User, and records its customer binding in the immutable `customer-app.device-linked` AuditLog event. Existing shared-ID accounts and earlier device sessions continue working. Repeating registration with the same device credential is idempotent. Multiple pre-existing equivalent Customer rows cause a conflict for review, never automatic deletion/merging.

Verified: 7 focused backend tests passed. Live **local-only** verification of `0592081197` passed all five requested checks, including all prefix forms, search, two device sessions, one unchanged Customer ID (`b105d9bc-597d-4e6b-a99f-b19b5c4cba77`) and one test ride subsequently cancelled without assigning a driver. The external-tunnel identity test was rejected by automatic approval review, so customer identity was not sent externally by this verification. The tested backend is loaded from `bin/CustomerPhoneStage` on the unchanged port 9010. Driver App, general Auth, and Reception workflow were not edited.

Registration takes office slug, full name and Palestinian phone; no national ID. The browser generates a random 256-bit device credential and account UUID before registration, saving them on this device. The backend reuses the existing User password hash and JWT issuance/login, with a permission-free CustomerApp role. New Customer and User share the same UUID; additional test devices use the binding described above. Every customer endpoint validates the dedicated role and generated username. All queries are tenant scoped and customer scoped. Outside the explicit test override, existing customer profiles cannot be claimed by entering a phone number. Registration retries with the same credential are idempotent.

This is an **unverified device account**, not SMS-verified phone ownership. Keep the device/browser data. OTP enrollment, safe account recovery and moving an existing office customer onto another device remain future work. No office/driver auth, permissions or passwords are changed. Access tokens stay in memory and renew through existing login using the stored device secret. Lock clears the in-memory session but keeps the device account.

## Requests and synchronization

Customer-only endpoints: register, me, rides/create, rides/{id}, updates, history. Pickup supports written address or one-shot GPS; destination is required. UUID requests are persisted locally until the server acknowledges them; manual retries reuse the same UUID. Writes are never sent automatically after reconnect. A retained draft is locked to avoid retrying different content under one UUID.

Requests reuse RideRequest/Ride and ReceptionService.ProjectRequest with CUSTOMER_APP source. A customer-specific projection adds existing `dropoff` and `scheduledTime` fields without changing Reception. Future bookings (up to 90 days) are a manual-office scheduling foundation, not timed automatic dispatch. They remain receptionPending for office review until the existing workflow clears it. No payment, tariff, chat, or dispatch workflow is introduced.

The existing office picker/Send flow assigns the driver. Customer states are REQUESTED, ASSIGNED, ACCEPTED, ARRIVED, IN_PROGRESS, COMPLETED, CANCELLED. Driver name and optional current vehicle are returned only at Accepted through Completed; no driver UserId/phone or other customers' data is exposed. Vehicle information represents the currently stored vehicle, not a historical vehicle snapshot. Customer cancellation is not added; office cancellations sync normally. History is paginated and restricted to the customer.

One long-poll (25 seconds) watches updates while visible, backed by the existing commit signal; retries back off to 60 seconds. Polling stops when hidden/offline. With no active orders it waits 60 seconds. There is no continuous GPS, map download, background push or automatic write replay. Customer API responses are no-store; only static shell assets are cached by the scoped service worker.

## Limited verification

`node .dispatchpro-local/test-customer-stage.mjs` runs only CustomerAppTests against a temporary PostgreSQL database that is removed afterward. It covers registration/idempotency, phone validation, customer isolation, denied office access, one immediate request, Reception/Send compatibility, all customer status mappings, driver visibility, history, scheduled booking and cancellation. It compiles only the backend/test projects into `bin/CustomerStage` to avoid the running API lock.

`node --experimental-strip-types --test tests/customer-app.test.mjs` checks only customer proxy security/transport. `node --check public/customer-mobile/app.js` checks browser script syntax. No driver suite or complete frontend build is run. Physical Android/iPhone acceptance remains to be performed.

## Verified running state

- CustomerAppTests: 1 passed, 0 skipped, using real disposable PostgreSQL. Customer proxy tests: 3 passed. Customer proxy targeted TypeScript check and browser/service-worker syntax checks passed.
- API extension loaded on the existing 127.0.0.1:9010 endpoint from `backend/DispatchPro.Api/bin/CustomerStage/DispatchPro.Api.dll` (PID 8460 at activation). Previous binary is recorded in ignored `.dispatchpro-local/customer-api-activation.json`; no migration or network change was performed. Normal future source builds include the extension automatically.
- Existing frontend at port 9005 serves the customer HTML and customer proxy successfully without a full frontend build.
- `.dispatchpro-local/verify-customer-live.mjs` passed against the live frontend/API and same office: one Customer MVP Test account and one request were reused idempotently, observed in Reception, then cancelled through the normal office save route. Customer updates and History returned CANCELLED. No driver was assigned or tested live. Its ignored account file contains test-only device credentials; do not publish it.
- Remaining: physical Android/iPhone acceptance on the existing office HTTPS deployment, SMS verification/account recovery if desired, automated scheduled dispatch if desired, and native packaging only if required. The temporary external tunnel was not changed or certified in this stage.
