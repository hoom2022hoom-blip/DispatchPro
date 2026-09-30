# Driver GPS on LAN HTTP — 2026-09-30

The real-phone driver URL was `http://192.168.0.105:9005/driver-mobile/index.html`. A private LAN HTTP origin is not a secure context: browser login and polling work, but browser geolocation is blocked.

Read-only database diagnosis found Driver Test Available (1), active, in the same tenant as the customer requests, with one active ready linked vehicle. There was no DriverLocation row. Failed customer requests had AUTO_NEAREST, pickup coordinates, NO_DRIVER_AVAILABLE, and zero RideOffer rows. The failure was eligibility (NO_LOCATION), before driver delivery. No tenant, driver/user identity, or vehicle association mismatch was found.

Temporary phone URL: https://workplace-prize-pond-somewhat.trycloudflare.com/driver-mobile/index.html

This tunnel forwards to the existing application on 9005; it requires this computer, API, web server, and tunnel to remain running. The link may change when the tunnel restarts. It does not create another application or database. Use the same office/account credentials; the HTTPS origin requires a fresh login and location permission.

The driver now explicitly explains insecure HTTP and GPS permission/accuracy/freshness failures, requests precise uncached GPS, offers a retry button, and shows the server's location readiness from the existing profile/update API. Dispatch logs record exclusions and offer creation with office/ride/driver IDs, and GPS ingestion logs record acceptance/rejection without coordinates. The existing 200m accuracy and configured freshness limits remain enforced. Tenant query filters remain enabled.

Current API binary: `.dispatchpro-local/gps-dispatch-api/DispatchPro.Api.dll`. Runtime logs: `.dispatchpro-local/logs/gps-dispatch.stdout.log`. Activation record: `.dispatchpro-local/automatic-dispatch-activation.json`.

Verification: 20 PostgreSQL scenarios passed (18 existing dispatch/lifecycle tests and 2 added GPS-recovery scenarios), 5 distinct GPS/proxy/driver UI tests passed, TypeScript check and API/mobile builds passed. Authenticated HTTPS verification confirmed the same driver, ONLINE_AVAILABLE, NO_LOCATION, working polling, and updated customer/driver assets. Production driver coordinates were not injected. Physical GPS permission and acquisition must happen on the phone.

On the phone open the HTTPS driver link, log in, allow precise location, choose Available, and wait for “GPS محفوظ وحديث لدى المكتب”. Then create a new customer request; older NO_DRIVER_AVAILABLE requests remain terminal. Customer HTTPS URL: https://workplace-prize-pond-somewhat.trycloudflare.com/customer-mobile/index.html?office=office-test-ba6da3f686 . The office does not need to send the request.
