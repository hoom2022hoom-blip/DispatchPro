# Unified Android / iPhone field test

Current temporary HTTPS URL:
https://analog-cdna-automobiles-aluminium.trycloudflare.com/driver-mobile/index.html

Both phones load the identical existing app.js. No app or backend build was run.

Android: open in Chrome, choose Install app / Add to Home screen.
iPhone: open in Safari, Share > Add to Home Screen, then open the added icon.
Use a current browser/OS. An internet connection is required; this is an online PWA.

Run the same sequence on each phone with an existing driver account:
1. Log in with office ID, username and password.
2. Switch Available, receive an office-assigned request, Reject; receive again and Accept.
3. Confirm customer/contact details appear only after acceptance; check pickup and destination.
4. Arrived > Start > Complete; verify History.
5. Switch Offline, test reconnect and return from background, then log out.
6. Check the in-app notification feed. System notification permission/support varies by platform; receiving while closed is not enabled.

Test readiness is not device certification: physical Android/iPhone installation and the authenticated ride sequence remain to be performed. No connected browser was available for visual verification in this session. HTTPS asset checks passed (HTML, JS, CSS, manifest, service worker and both PNG icons all 200). Protected profile returned 401 without credentials; invalid login with the actual HTTPS Origin returned 401 from the API; office route returned 404 on this driver-only host.

The existing Next.js dev API proxy currently returns 500 due to missing .next runtime manifests. To avoid a full build or changing office services, `serve.mjs` serves only the current public/driver-mobile assets and allowlisted driver routes on loopback port 9012, reusing the existing proxyReception and backend at port 9010. It keeps authenticated responses network-only and makes no backend changes.

The temporary link needs this computer, driver host, existing API/database and cloudflared tunnel to remain running. Host PID at setup: 4636; driver tunnel PID: 19708. Logs: `.dispatchpro-local/logs/driver-mobile-host.*.log` and `driver-mobile-test-tunnel.*.log`. Restarting the quick tunnel changes its public URL. For later reuse, start `node --experimental-strip-types driver-mobile/serve.mjs` and tunnel `http://127.0.0.1:9012` (no build). A stable deployment/domain is still needed for long-term use.

Native deliverables: the prior Android APK 0.1.1 remains available and unmodified, with device acceptance and production signing/distribution still pending. Native iOS requires a host for the shared code, macOS/Xcode, signing/provisioning and device/TestFlight validation; this PWA does not create an IPA.
