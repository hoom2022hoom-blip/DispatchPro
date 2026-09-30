# Phase 1 verification — 2026-09-27

Continuation: reception API bridge and independent worker are now verified with **21 backend tests + 21 JavaScript tests**, all passing with no skips, plus API build, API-mode Next.js production build and smoke. See [reception bridge verification and setup](RECEPTION_BRIDGE.md). The Phase 1 counts below are retained as historical results.

Branch: `taxi-nablus-development`. Existing local work was preserved; no commit/reset, production migration, office network change or frontend provider cutover was performed.

## Results

| Check | Result |
|---|---|
| `dotnet build backend/DispatchPro.Api --no-restore` | Passed, 0 warnings, 0 errors |
| `dotnet test backend/DispatchPro.Tests --no-restore` with `TAXI_TEST_POSTGRES` | 17 passed, 0 failed, 0 skipped |
| Unit coverage | 16 cases: phone normalization/rejection, meter composition, night boundaries, minimum/return/manual fares, ride transitions |
| Real PostgreSQL integration | Passed: migrations/reapplication, seed idempotency, two tenants, JWT rejection, RBAC, tenant header spoofing, cross-office read/write/FK prevention, duplicate phone scoping, PostGIS polygon persistence, estimates/adjustments/audit, stale price rejection, feature gating, active-driver unique constraint, customer privacy before acceptance, full ride lifecycle, immutable audit records |
| `node backend/smoke.mjs` | Passed: live, unavailable-DB readiness 503, protected API 401, legacy call path not replaced |
| `npm.cmd test` | 17 passed, 0 failed, including iCall UDP, LAN gateway, WhatsApp/event handling, IndexedDB and reception |
| `npm.cmd run build` | Passed; existing Handlebars/Genkit and outdated browser metadata warnings remain |
| EF `migrations has-pending-model-changes` | No pending model changes |
| `git diff --check` | Passed; Git reports existing LF/CRLF conversion notices |

The Next.js build initially hit sandbox `spawn EPERM`; it passed when rerun with process execution permission. NuGet restore likewise required network permission. Windows EventLog dependency was removed from the API logging setup so a restricted, portable console host works without EventLog access.

The integration server used a project-local copy of PostgreSQL 18.6 and PostGIS 3.6.2 on `127.0.0.1:55439`. It did not use or modify the installed PostgreSQL service. Integration tests create and remove only randomized disposable databases. The temporary server was stopped after verification. Downloaded binaries and cluster files remain ignored under `.tools` for local reuse; they are not part of the source changes.

## Files added or changed in this task

### Existing files updated

- `docs/TAXI_NABLUS_MASTER_PLAN.md`
- `backend/README.md`
- `backend/NuGet.Config`
- `backend/compose.yaml`
- `backend/smoke.mjs`
- `backend/DispatchPro.Api/DispatchPro.Api.csproj`
- `backend/DispatchPro.Api/Program.cs`

### Files added

- `backend/PHASE1.md`
- `backend/VERIFICATION.md`
- `backend/DispatchPro.Api/appsettings.json`
- `backend/DispatchPro.Api/Domain/Models.cs`
- `backend/DispatchPro.Api/Infrastructure/TaxiDb.cs`
- `backend/DispatchPro.Api/Infrastructure/Migrations/20260926222054_TaxiFoundation.cs`
- `backend/DispatchPro.Api/Infrastructure/Migrations/20260926222054_TaxiFoundation.Designer.cs`
- `backend/DispatchPro.Api/Infrastructure/Migrations/20260926222442_ActiveDriverConstraint.cs`
- `backend/DispatchPro.Api/Infrastructure/Migrations/20260926222442_ActiveDriverConstraint.Designer.cs`
- `backend/DispatchPro.Api/Infrastructure/Migrations/TaxiDbModelSnapshot.cs`
- `backend/DispatchPro.Api/Services/Security.cs`
- `backend/DispatchPro.Api/Services/PricingEngine.cs`
- `backend/DispatchPro.Api/Services/PhoneAndOtp.cs`
- `backend/DispatchPro.Api/Endpoints/TaxiEndpoints.cs`
- `backend/DispatchPro.Tests/DispatchPro.Tests.csproj`
- `backend/DispatchPro.Tests/UnitTests.cs`
- `backend/DispatchPro.Tests/IntegrationTests.cs`

Builds also regenerate ignored output and the already-modified `tsconfig.tsbuildinfo`. Existing frontend, Android and integration source changes predate this task; they were not replaced. `backend/db/001_reception.sql` remains unchanged.

## Remaining boundary

This is a backend foundation, not a deployed replacement for the office system. Real SMS OTP delivery/public mobile registration, Flutter apps, live GPS, chat, push, payment, reports/export and backup services are not implemented. Pricing meter inputs are supplied by authorized staff. The existing UI still writes to Firebase/IndexedDB. Connect the ASP.NET reception provider and ingestion worker with compatibility tests before any real-data cutover.
