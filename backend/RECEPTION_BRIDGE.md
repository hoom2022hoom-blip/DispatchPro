# ReceptionBackend + independent call worker

Continuation of Phase 1, 2026-09-27. This uses the existing reception table, edit/create forms, queue, drag/drop and footer. It adds an API controller for those components, not a replacement project or final dashboard redesign.

## What is connected

- `getReceptionBackend(..., true)` selects the ASP.NET provider. Creation/editing, call ingestion, daily numbering and queue actions use authenticated API requests.
- The API-mode reception screen also reads rides/drivers/vehicles/shifts/queue/latest call from the same tenant API. It does not subscribe to Firebase or IndexedDB. Existing modes retain their original providers.
- A same-origin Next.js proxy forwards the logged-in employee's JWT. No worker secret is exposed to the browser. The token is held in memory only; reload/logout requires login again. Expired sessions report an error and never fall back to another database.
- Polling every two seconds uses ETags/304; errors back off to five seconds. Service worker routing is NetworkOnly for `/api/reception/*`, preventing offline cache reuse between offices.
- `scripts/reception-worker.mjs` runs independently of the browser. It reads the existing immutable call journal produced by `/api/calls`, sends unacknowledged events to the API, and persists checkpoints only after a matching successful acknowledgement.
- Checkpoints are scoped to the API URL and authenticated tenant ID. Process restart, network failure, lost acknowledgements and parallel workers cannot create a second order for an event. A corrupt/conflicting event remains pending for retry and does not prevent processing other records.
- API ingestion commits event, reception order, daily number and audit entry in one PostgreSQL transaction. Replayed events preserve staff edits. Same event ID with different payload returns 409; repeated calls with new IDs remain separate requests.

## Enable deliberately for one office

Keep the existing integration senders and network settings. Do not change the Android, iCall UDP or WhatsApp endpoints. The existing Next.js call receiver must still run to accept their HTTP events; only the office browser may be closed.

1. Apply migrations using the existing backend configuration:

```powershell
dotnet run --project backend/DispatchPro.Api -- --migrate
```

2. Use the office administrator API account to enable `CallerId` and/or `WhatsApp` using `PUT /api/v1/features/{key}?enabled=true`. These flags are off by default. Create a dedicated worker role using `POST /api/v1/roles`, grant only `reception.ingest` using `POST /api/v1/permissions`, then create its user through `POST /api/v1/users`. The previous administrator role can manage these grants; existing seeds are not overwritten. Do not give the worker interactive administration permissions.

3. Set these in the Next.js environment before `dev` or `build` (examples are in `.env.example`):

```powershell
$env:NEXT_PUBLIC_RECEPTION_BACKEND = 'api'
$env:DISPATCHPRO_API_URL = 'http://127.0.0.1:9010'
npm.cmd run dev
```

Open the existing home reception screen and log in with the API **office slug, username and password**. Its data comes from that office's PostgreSQL records. API mode uses the existing reception components; legacy Firebase-only chat/admin actions are not mixed into this reception view. Other old screens remain on their existing providers.

4. Start the worker in a separate process with these environment variables; the worker does not automatically load `.env` files:

```powershell
$env:DISPATCHPRO_API_URL = 'http://127.0.0.1:9010'
$env:DISPATCHPRO_WORKER_TENANT = '<office slug>'
$env:DISPATCHPRO_WORKER_USERNAME = '<dedicated worker user>'
$env:DISPATCHPRO_WORKER_PASSWORD = '<secret from your secret store>'
# Set this only when the call receiver uses a custom path:
# $env:DISPATCHPRO_LOCAL_DATA_DIR = '<same directory as the receiver>'
npm.cmd run reception:worker
# One-pass verification, exit code 1 if any delivery remains unsuccessful:
npm.cmd run reception:worker -- --once
```

Remote API URLs require HTTPS. No static office IP is embedded. Configure the worker through an existing service manager for unattended reboot startup; no scheduled task or machine-wide service is installed by this change. Stop with Ctrl+C.

**Backlog behavior:** the first worker run processes the existing journal for the configured office, including events recorded before startup. Use a separate data directory for a new/test office; do not point two office workers at the same journal unless intentionally copying those events. Switching API providers does not import old Firebase/IndexedDB rides or renumber them.

## Endpoints and compatibility storage

All routes are under `/api/v1/reception`, protected by the authenticated tenant:

| Path | Method | Required permission |
|---|---|---|
| `/calls` | POST | `reception.ingest` or `rides.write` |
| `/snapshot` | GET | `rides.read`; returns ETag |
| `/rides/{legacyId}` | PUT | `rides.write`; changing fare also requires `pricing.adjust` and `ManualPricing` |
| `/queue` | POST | `rides.write` |
| `/shifts` | POST | `rides.write`; existing API driver/vehicle IDs |
| `/shifts/{id}/end` | POST | `rides.write`; no busy driver |

The reception tables preserve the legacy contract, including string IDs, nine statuses, landline/unknown caller numbers, pending state and manual fare fields. The subsequent `CustomerPlacesUnifiedRequests` migration now links every reception order to one canonical `RideRequest` and `Ride`, backfills existing records, and projects canonical requests into reception. Unknown callers need no fake Customer registration. Driver assignment/status updates share the tenant transaction lock. See [customer places and live calls](../docs/CUSTOMER_PLACES_AND_LIVE_CALLS.md) for the current implementation and verification.

Daily numbering uses Jerusalem time and a tenant-scoped counter. Orders keep their number/day/created time through edits. Writes carry `receptionVersion`; stale changed writes return 409, while an identical lost-response retry is acknowledged. Active assignments atomically leave the queue. Reentering the queue after completion remains explicit. Assignment is rejected until the reception address is complete. Unknown coordinates remain zero, not fabricated GPS positions.

MANUAL/CUSTOMER_APP call-journal records are acknowledged without automatically creating orders, matching the existing receiver. Manual orders are created through the existing form. Caller customer names are enriched from the target office's API Customer table; no automatic Firebase customer import is performed.

## Verification

- `npm.cmd test`: 21 passed, including previous iCall/WhatsApp/LAN/reception tests and new worker/proxy/provider checks.
- `dotnet test backend/DispatchPro.Tests --no-restore` with isolated `TAXI_TEST_POSTGRES`: 21 passed, zero skipped. Includes real PostgreSQL transaction/tenant/queue/replay tests and a live HTTP API subprocess running the actual Node worker and TypeScript provider through the proxy.
- API build, Next.js API-mode production build, type checking, migration model check and backend smoke are run for this continuation. Existing Next.js Handlebars/Genkit/browser metadata warnings remain unrelated.
- Tests use disposable databases on the project-local PostgreSQL/PostGIS test server; production data and the installed office database service are untouched.

The new migrations are `ReceptionBridge` and `ReceptionWriteReplay`. No production cutover, credential changes, data import or office network changes are performed automatically.
