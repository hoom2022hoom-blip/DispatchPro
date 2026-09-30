# Driver offer timeout

The driver countdown previously compared server `offerExpiresAt` directly with
`Date.now()` on the phone. A phone clock ahead of the API clock immediately showed
zero and disabled acceptance, even while the server offer was still valid.

Driver updates now include an explicit UTC `serverTime` outside the cursor hash,
generated after the long poll finishes. The client anchors the offer clock to this
timestamp and advances it with `performance.now()`. Both response buttons share
the expiry check. Refreshes keep the original expiration; they do not start a new
30-second window. The server remains authoritative for acceptance and timeout.

Dispatch uses the configured 10–180 second timeout, falling back to 30 seconds for
invalid stored values. Existing UTC DateTimeOffset/database timestamps, acceptance,
rejection, GPS and eligibility logic remain unchanged.

Validation: 13 client tests passed, including clock skew, explicit timezone offsets,
long polling and wall-clock changes. The UI regression also passed after adding a
server-time offer years behind the phone clock. The PostgreSQL independent customer
dispatch scenario passed with assertions for positive remaining time, no early
expiry, reject/timeout advancement, DRIVER_ASSIGNED acceptance, and stopped dispatch.
TypeScript checking, driver web build and API publish passed.

Activated API: `.dispatchpro-local/offer-timeout-api/DispatchPro.Api.dll` on port
9010; health check passed. Driver web bundle rebuilt in `public/driver-mobile`.
Reload the driver page to load the new bundle. Physical-phone acceptance has not
been exercised as part of this change.
