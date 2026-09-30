# Office Bridge (Windows, Node.js 24)

The independent agent reads the existing immutable `calls` journal and copies iCall/LANDLINE_ICALL and WHATSAPP events to its own durable outbox. It reuses the existing reception worker, authentication, checkpoints and API transaction deduplication. It opens no listening port, changes no sender or network configuration and never accesses GRIDCMS. Stopping it does not stop the old office software or existing receiver.

iCall remains on its existing `scripts/icall-udp-adapter.mjs` path. WhatsApp Business remains on the existing Android call-event sender and `/api/calls` or LAN gateway. This is not a new WhatsApp Cloud API integration and does not scrape WhatsApp. The existing receiver must keep running to record events. The bridge cannot recover calls that were never captured by that receiver.

Copy `scripts/office-bridge.config.example.json` to `.dispatchpro-local/office-bridge.json`. Paths resolve relative to the config. Set the source to the existing journal directory, choose an explicit `startAfter` rollout time (older records are not imported), and keep a separate state directory. Changing tenant requires a separate config/state directory; do not share one office inbox with multiple offices unintentionally.

Set `apiUrl` to the deployed API HTTPS origin, `tenant` to the office slug and `tenantId` to its UUID. Remote plain HTTP is rejected. Local verification may use `http://127.0.0.1:9010`. A remote deployment URL has not been supplied or provisioned.

Create a dedicated role containing only `reception.ingest`, and a corresponding worker user, through the existing admin APIs. Enable CallerId and WhatsApp flags only for the intended tenant. Store `{ "username": "...", "password": "..." }` in the ignored credentials file; restrict its Windows access to the operating account. No secrets belong in Git or logs.

Manual foreground launch from the project directory:

```powershell
node --experimental-strip-types scripts/office-bridge.mjs --config .dispatchpro-local/office-bridge.json
```

Add `--once` for one pass. Ctrl+C stops the foreground agent. For a hidden background process, use `Start-Process -WindowStyle Hidden` with Node and those same arguments, setting the project working directory explicitly. A future Windows Task Scheduler entry can use this command and a dedicated Windows account; no task/service/autostart is installed here. Run a single instance per state directory.

The included `node scripts/start-office-bridge.mjs --config .dispatchpro-local/office-bridge.json` launches that command hidden and reports its PID, without requiring changes to PowerShell execution policy. Check the state directory's `agent.log`; stop only the reported agent PID when needed. The prepared local config uses a synthetic inbox and isolated test tenant, not the live office journal. Its credentials are under `.dispatchpro-local` and ignored by Git. Replace it with a reviewed office-specific config/state directory for rollout.

API: `POST /api/v1/reception/bridge/calls`, bearer authentication, fields `source` (LANDLINE/WHATSAPP), `callerNumber`, `eventId`, `receivedAt`, `tenantId`, optional line/location. The API rejects a tenant ID different from the authenticated identity. It adapts LANDLINE to the existing reception contract. Existing feature flags still apply. No migrations are required.

Durability: stable source IDs are preserved. Import precedes network calls, reconnect uses bounded exponential retry, and checkpoints are written only after a matching acknowledgement. Lost responses can cause transport retries, but the server creates one logical call/request. Conflicts remain pending rather than being silently acknowledged. Stop/start retains the outbox. No queue records are automatically deleted. Monitor free disk space; disk failure prevents new durable captures and is reported locally. Logs rotate at approximately 1 MiB with one previous file, and contain categories/counters only. Event spool files necessarily contain caller data and require local access protection.

The simulated validation proves the API path, not physical iCall/WhatsApp delivery or a remote Internet deployment. Existing mounted React tests cover rendering without scrolling; live browser visual verification requires an available browser.
