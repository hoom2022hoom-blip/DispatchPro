# Customer places, unified requests and live calls

Continuation on `taxi-nablus-development`, 2026-09-27. Existing local work is preserved. No production migration, office network change or integration sender change was performed.

## Live last call

The local polling loop previously waited for asynchronous reception persistence before continuing. API display also depended on the full reception snapshot. In-flight polling could overwrite a newer pushed event. The fix separates display updates from queued persistence, maintains a stable subscription, rejects stale responses, and exposes an immutable latest-call snapshot through React `useSyncExternalStore`. API latest-call polling is independent (one second); pushed events update React immediately. Both call and reception HTTP paths bypass service-worker caching. No scroll, manual refresh or forced repaint is used.

Mounted React regression tests deliver two calls without any interaction, keep the first persistence operation unresolved, and verify that the second number renders. A stale response cannot restore the previous call. This verifies state/render behavior; a physical office browser/GPU session was not exercised.

## Requests and location

Reception creation and canonical creation share one RideRequest/Ride and a reception projection. Canonical sources are WHATSAPP, LANDLINE, CUSTOMER_APP and MANUAL; the existing LANDLINE_ICALL adapter remains accepted and is normalized. Replay retains staff edits and avoids duplicate requests. Customer identity is optional for unknown callers.

Requests store addressText, neighborhood, street, nullable latitude/longitude, locationSource and notes, plus optional customerId/savedAddressId. Supported sources are CUSTOMER_GPS, WHATSAPP_LOCATION, MAP_PIN, ADDRESS_SEARCH, MANUAL_TEXT and SAVED_ADDRESS. A text address works without GPS. Structured customer-app/WhatsApp coordinates are accepted by the API; WhatsApp coordinate text and links containing coordinates can also be pasted. Short links are not expanded.

SavedAddress has the requested customer, label, address, coordinate, notes, default and timestamp fields, with icon and optimistic version added. A customer can have multiple labels, including HOME/WORK/FAMILY/OTHER or custom text. Request locations are snapshots: deleting a saved address clears the reference but preserves the requested location.

`/api/v1/saved-addresses` supports list/search/create; `/{id}` supports read/update/delete. JWT tenant scope, composite tenant foreign keys, permissions, locking and optimistic versions isolate offices. Default addresses are unique per customer.

The existing office map in API mode supports saved markers, HOME/WORK/OTHER icons, customer/phone/neighborhood/street search, pin placement and dragging, customer creation/selection, popup request/edit/delete, and save-as-new/update. Text-only addresses remain editable/deletable without a pin. Reception can select a saved address or use a pin without saving it. Address search covers the saved address book; no external street geocoding service was introduced.

## Changed files for this continuation

- `src/hooks/use-incoming-call.ts`, `src/hooks/use-api-last-call.ts`
- `src/lib/reception-api.ts`, `src/lib/reception-proxy.ts`, `src/lib/customer-places.ts`, `src/lib/call-events.ts`, `src/lib/types.ts`, `src/lib/reception-editor.ts`
- `src/components/api-reception.tsx`, `src/components/customer-places-map.tsx`, `src/components/location-fields.tsx`, `src/components/call-logger-form.tsx`, `src/components/reception-edit-form.tsx`
- `src/app/admin/map/page.tsx`, `src/app/api/reception/[...path]/route.ts`, `src/context/auth-context.tsx`, `next.config.ts`
- `backend/DispatchPro.Api/Domain/Models.cs`, `Domain/Reception.cs`, `Domain/SavedAddress.cs`
- `backend/DispatchPro.Api/Infrastructure/TaxiDb.cs`, `Services/Locations.cs`, `Services/ReceptionService.cs`
- `backend/DispatchPro.Api/Endpoints/TaxiEndpoints.cs`, `Endpoints/ReceptionEndpoints.cs`, `Endpoints/SavedAddressEndpoints.cs`, `Program.cs`
- `backend/DispatchPro.Api/Migrations/20260927041903_CustomerPlacesUnifiedRequests.cs`, its `.Designer.cs`, and `TaxiDbModelSnapshot.cs`
- `backend/DispatchPro.Tests/CustomerPlacesTests.cs`, `tests/customer-places.test.mjs`, `tests/last-call-render.test.mjs`
- `package.json`, `package-lock.json`, `backend/RECEPTION_BRIDGE.md`, this document; generated TypeScript incremental metadata may also change.

## Verification and rollout

- JavaScript: 26 passed, zero failures/skips.
- .NET: 29 passed, zero failures/skips, using disposable PostgreSQL/PostGIS databases. Includes migration of old reception and canonical records, manual addresses, multiple addresses, saved-address requests, pin updates, replay and cross-office isolation.
- .NET build: zero warnings/errors. TypeScript checking passed.
- API-mode Next.js production build passed; existing Handlebars/Genkit webpack warnings remain.
- EF reports no pending model changes; API smoke passed. Temporary PostgreSQL test server was stopped afterward.

Apply the new migration using the existing office deployment procedure and configured credentials, then pilot live calls and map interactions in the office. The API UI remains opt-in via the existing `NEXT_PUBLIC_RECEPTION_BACKEND=api`; `/admin/map` uses the same API login. Existing integration settings and senders are unchanged.
