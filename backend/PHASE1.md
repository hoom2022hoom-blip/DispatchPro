# Phase 1 — backend foundation

Follow-up implemented: [ReceptionBackend API bridge and independent call worker](RECEPTION_BRIDGE.md). The phase-one descriptions below are the foundation baseline; API reception is now available as an explicit configuration mode.

This extends the existing DispatchPro API. The Next.js ReceptionBackend still uses IndexedDB/Firebase; no existing data is migrated and no caller device configuration changes.

## Configuration and startup

.NET 8 and PostgreSQL with PostGIS are required. Keep credentials in environment variables or a secret store, never in Git.

```powershell
$env:Auth__SigningKey = '<random secret of at least 32 bytes>'
$env:ConnectionStrings__Taxi = 'Host=localhost;Port=5433;Database=dispatchpro;Username=dispatchpro;Password=<password>'
dotnet restore backend/DispatchPro.Api --configfile backend/NuGet.Config
dotnet build backend/DispatchPro.Api --no-restore
dotnet run --no-build --project backend/DispatchPro.Api -- --migrate
$env:Seed__TenantSlug = 'example-office'
$env:Seed__TenantName = 'Example Office'
$env:Seed__AdminUsername = 'admin'
$env:Seed__AdminPassword = '<at least 14 characters>'
dotnet run --no-build --project backend/DispatchPro.Api -- --seed
dotnet run --no-build --project backend/DispatchPro.Api
```

Seed is explicit and idempotent by tenant slug. Repeating it does not reset passwords or overwrite settings. Repeat with a different slug to provision another independent office. Seed includes roles, permissions, vehicle classes, four pricing modes, feature flags and an administrator. There is no fixed office name or password. It does not fabricate customers or real journeys.

Default API address: `http://127.0.0.1:9010`; override with `ASPNETCORE_URLS`. Use HTTPS termination for deployment. No CORS origin is enabled by default. Configure deployment origins before connecting mobile/web clients. JWT expires after 30 minutes; permissions and account activation are checked from the database on every authenticated request. Database credentials for migrations should be separate from runtime credentials in production.

`compose.yaml` supplies a PostGIS-enabled **development** database. It retains the existing volume and legacy reception SQL. Existing volumes still need `--migrate`; startup does not automatically run migrations. EF tables are distinct from legacy lower-case reception tables. Never delete a volume to upgrade a database.

## API contract

All paths below use `/api/v1`. Except login, every endpoint requires a Bearer token. Cross-office IDs are either not found or rejected; tenant headers and tenant fields cannot select another office. Lists are bounded to 200 records; cursor pagination is future work.

| Route | Methods | Permission / behavior |
|---|---|---|
| `/auth/login` | POST | `{tenant,username,password}`; token; IP rate limited |
| `/me`, `/tenant` | GET | Own identity / tenant only |
| `/customers` | GET, POST | `customers.read/write`; `{fullName,phone}` |
| `/otp/request` | POST | `customers.write`; provider abstraction; returns 503 until configured |
| `/users` | GET, POST | `users.write`; `{username,password,roleId}`; hashes never returned |
| `/roles`, `/permissions` | GET, POST, PUT `/{id}` | `users.write`; office-specific role grants |
| `/offices` | GET, POST, PUT `/{id}` | `settings.write` |
| `/drivers`, `/vehicles` | GET, POST, PUT `/{id}` | `users.write` |
| `/features` | GET | Own office flags |
| `/features/{key}?enabled=true` | PUT | `settings.write` |
| `/vehicle-classes` | GET, POST, PUT `/{id}` | `pricing.write` |
| `/pricing/profiles`, `/pricing/rules`, `/pricing/routes`, `/pricing/zones`, `/pricing/services` | GET, POST, PUT `/{id}` | `pricing.write` |
| `/pricing/quote` | POST | `pricing.read`; rule, meter, optional route/class/zone/services |
| `/ride-requests` | POST, GET | `rides.write/read`; creates request + ride + audit atomically |
| `/rides` | GET | `rides.read` |
| `/rides/{id}` | GET | `rides.read`; office view with request and customer |
| `/rides/{id}/assignment` | PUT | `rides.write`; `{driverId,version}` |
| `/driver/rides/{id}` | GET | `rides.drive`; assigned driver only; phone/name/notes after acceptance |
| `/rides/{id}/status` | PUT | `rides.write` or assigned `rides.drive`; `{status,version}` |
| `/rides/{id}/price` | POST, GET | `pricing.write/read`; quote input saves estimate/calculated/final |
| `/rides/{id}/price/adjustment` | PUT | `pricing.adjust`; `{finalPrice,reason,version}` |
| `/audit` | GET | `audit.read`; latest 200 events |

`/health/live` checks the process; `/health/ready` requires reachable database and applied migrations. Missing signing key prevents startup. Unconfigured OTP never accepts a fake code or logs a code. Public customer registration/token issuance via SMS is intentionally pending a real OTP provider and abuse controls.

Quote example:
```json
{
  "pricingRuleId": "<rule UUID>",
  "meter": { "kilometers": 5, "minutes": 10, "waitingMinutes": 2, "at": "2026-09-27T12:00:00Z", "returnTrip": false },
  "fixedRouteId": null,
  "vehicleClassId": null,
  "zoneId": null,
  "serviceIds": []
}
```

## Pricing semantics

- Manual returns no fabricated automatic amount. An authorized adjustment establishes the final fare.
- FixedRoute selects outbound/return fare from the explicitly chosen route.
- GpsMeter/Hybrid: base + distance × km rate + elapsed minutes × minute rate + waiting minutes × waiting rate. Inputs are supplied by authorized staff; tracking/distance verification is later work. Elapsed and waiting minutes are separate billable inputs.
- Night rules use the profile time zone; start inclusive, end exclusive; equal start/end disables night pricing. Overnight intervals work across midnight.
- Night percentage and fixed amount apply first; vehicle multiplier next; zone and service fees next; minimum fare last; final rounding is two decimals away from zero.
- The first saved estimate is preserved. Recalculation cannot replace an existing manual adjustment or switch the ride's rule. Manual/Hybrid adjustment requires a reason, stores calculated/adjustment/final amounts and actor, and appends PriceAdjustment + AuditLog in the same transaction.
- Rule changes affect subsequent calculations. Full versioned tariff snapshots, automatic polygon lookup, GPS fraud checks and payment settlement are later work.
- Zones accept optional `boundaryWkt` (Polygon/MultiPolygon, longitude/latitude EPSG:4326); geometry is persisted in PostGIS and returned as WKT.

## Isolation and concurrency

Tenant ID comes only from a validated JWT. Scoped EF query filters cover every tenant entity. Both async SaveChanges overloads enforce tenant identity; synchronous saves are disabled. Composite foreign keys prevent cross-office relations even if application validation is bypassed. Unique phone numbers are scoped to the tenant. No public cross-tenant CRUD API exists. Audit/adjustment records are append-only through the data layer; a DBA still has database-level authority.

Ride and price versions reject stale writes with 409. A partial unique PostgreSQL index prevents two active rides for one driver. Completed/cancelled rides cannot restart. Completion requires a final fare. The feature flags gate pricing combinations and scheduled/source-specific requests; features without an implemented service remain inactive foundations.

## Tests

```powershell
dotnet restore backend/DispatchPro.Tests --configfile backend/NuGet.Config
dotnet test backend/DispatchPro.Tests --no-restore
# Optional locally; required in CI for full verification:
$env:TAXI_TEST_POSTGRES = 'Host=127.0.0.1;Port=<test-port>;Database=postgres;Username=<test-role>;Password=<test-password>'
dotnet test backend/DispatchPro.Tests --no-restore
node backend/smoke.mjs
npm.cmd test
npm.cmd run build
```

The integration test creates a database with a generated `taxi_test_<UUID>` name, applies real migrations twice, seeds two tenants, exercises HTTP and database constraints, then drops **only that generated test database**. The role must have CREATE DATABASE and PostGIS extension privileges. Without `TAXI_TEST_POSTGRES`, the integration test reports skipped, never passed. Use a disposable test server.

Portable Windows PostGIS package reference: [official PostGIS installation documentation](https://postgis.net/documentation/getting_started/install_windows/released_versions/). Local binaries and database files are ignored under `.tools`; they are not deployment artifacts.

## Deferred integrations

Flutter customer/driver apps, final dashboard design, SignalR chat/live GPS, push notifications, calling, real OTP delivery, payment, reports/exports, automated backup/restore and production monitoring remain later phases. Existing Android OfficeCalls, iCall UDP, WhatsApp reception, Next.js APIs and Firebase/IndexedDB remain in place. Next migration step is a compatible ASP.NET ReceptionBackend provider plus server-side ingestion worker and idempotent event numbering, tested before any cutover.
