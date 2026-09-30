# Mobile journey UX stage

Built on the working customer and driver PWAs. No database migration, new package,
native project, dispatch rewrite, GPS scheduler change or office redesign.

## Delivered

- Customer: persistent MapLibre home map, current-position/pickup/destination/driver
  markers, map selection with descriptive address fields, review before confirmation
  (pickup, destination, notes, existing scheduling, straight-line distance when both
  coordinates exist), searching/accepted/arrival/trip/completion states, vehicle and
  policy-controlled contact details. Immediate local locking prevents a second ride
  before the first server snapshot. Existing pending request IDs still handle retries.
- Driver: large availability and ride-action buttons, first received time and existing
  server-clock countdown, accepted-ride map and ordered progress. Navigation targets
  pickup before starting and destination during the trip. The map observes successful
  existing GPS sends; it creates no additional geolocation watcher or API traffic.
- Shared map markers update in place without resetting the viewport on every GPS
  update. Missing/stale server tracking removes the driver marker. Manual fit controls
  remain available. MapLibre/OSM are reused; no paid routing/geocoding was added.
- Customer API adds only `pickupLocation` and `destinationLocation` to the existing
  authenticated ride representation. These are needed after reload/device restoration.
  Driver privacy and status/assignment APIs are unchanged.
- Driver PWA copies the existing MapLibre assets, serves them on its existing test host,
  and permits only the OSM tile origin plus the required MapLibre blob worker in CSP.

## Files changed in this stage

- `public/customer-mobile/{index.html,app.css,app.js,maps.js,sw.js}`
- `src/components/{driver-api-dashboard.tsx,driver-journey-map.tsx}`
- `driver-mobile/{build.mjs,index.html,serve.mjs}`
- Generated `public/driver-mobile/{app.js,app.css,index.html,maps.js,maplibre-gl.js,maplibre-gl.css}`
- `backend/DispatchPro.Api/Endpoints/CustomerAppEndpoints.cs`
- `backend/DispatchPro.Tests/IndependentCustomerDispatchTests.cs`
- `tests/{independent-customer-ui,customer-hailing-ui,driver-app-render,mobile-journey-map}.test.mjs`
- This report; temporary build/test/activation scripts under `.dispatchpro-local`.

## Validation

16 relevant client tests passed (map/marker reuse, summary, duplicate confirmation,
GPS clock correction, timeout, driver lifecycle/navigation, proxy and mobile runtime).
Driver render test rerun passed after navigation assertions. 21 PostgreSQL integration
scenarios passed, none skipped: independent dispatch, complete hailing and driver API.
They exercise acceptance/rejection/expiry, real-time office/customer states, full
lifecycle, manual assignment/override, GPS recovery/accuracy, concurrency and isolation.
TypeScript, JavaScript syntax checks, driver PWA build and API publish passed.

Activated `.dispatchpro-local/mobile-journey-api/DispatchPro.Api.dll` on the existing
9010 listener. Health and customer/driver assets returned HTTP 200 on existing 9005.

## Real phone acceptance steps

1. Keep the existing ADB reverse/localhost setup. Reload customer and driver PWAs.
2. On the driver phone keep GPS enabled and mark available. Verify connection/GPS.
3. Customer: use current location, select destination on map, enter a clear address.
   Review summary, confirm once, and tap again to verify there is only one request.
4. Verify searching, driver offer/countdown and acceptance. Verify customer and office
   show the assigned driver; phone contact appears only if allowed by office policy.
5. Observe driver movement markers. Open navigation to pickup. Progress through
   arriving, arrived, start trip. Navigation should now target destination.
6. Complete the trip. Verify customer completion, office completion and driver waiting
   available. Separately exercise rejection, timeout and a manual office assignment.

## Limits

No browser provider was connected to the UI tool, so visual browser review and physical
phone verification were unavailable in this session. The automated tests do not replace
those checks. Road routing/search geocoding are not provided by the existing map stack;
selection is by map, addresses are editable and the displayed distance is explicitly
straight-line. Native navigation opens the existing Google Maps destination link.
