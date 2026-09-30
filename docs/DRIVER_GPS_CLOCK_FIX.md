# GPS HTTP 400: clock skew

On 2026-10-01 the phone used ADB reverse and Chrome at `http://127.0.0.1:9005/driver-mobile/index.html` (a secure loopback context). API logs identified `FUTURE_LOCATION`, with actual GPS accuracy around 14–37m. This was a separate issue from insecure LAN HTTP: the phone's capture clock exceeded the server's 10-second future tolerance.

The GPS rejection now includes serverTime. The existing driver API client uses that time and the request midpoint to translate the original capture timestamp into server time, retrying once only for a locally fresh fix and a round trip under 10 seconds. It preserves fix age and coordinates. Stale fixes and poor accuracy are not retried or re-stamped as new. Subsequent GPS updates reuse the measured offset. Driver and office identity still come only from the authenticated session.

Changed: DispatchEndpoints.cs, driver-api.ts, driver-location.ts, and the generated driver web bundle. No dispatch or database schema changes. Eight client tests and two PostgreSQL GPS eligibility/recovery scenarios passed; TypeScript and builds passed.

Active API: `.dispatchpro-local/gps-clock-api/DispatchPro.Api.dll`; logs: `.dispatchpro-local/logs/gps-clock.stdout.log`.

Real-phone verification through the existing ADB Chrome session confirmed isSecureContext=true and Driver Test online/available after loading the updated bundle. GPS acquisition timed out before sending a fix while the device reported Dozing. Android denied the attempt to wake it (INJECT_EVENTS permission); no permissions were changed or bypassed. Therefore real-phone HTTP 200 / READY is not yet verified, despite passing automated endpoint recovery tests. Keep the phone awake on the driver page and retry GPS.
