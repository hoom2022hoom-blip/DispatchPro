# DispatchPro Driver Android — 0.1.1 (versionCode 2)

Installable field APK: `releases/DispatchPro-Driver-0.1.1.apk` (711,861 bytes). SHA-256 is in the adjacent `.sha256` file. Android 7.0/API 24 or newer, with an up-to-date Android System WebView, is required. Package: `com.dispatchpro.driver`.

## Implementation

The existing `src/components/driver-api-dashboard.tsx` and `src/lib/driver-api.ts` are bundled with React and Tailwind directly into the APK. No Flutter project existed. The app uses Android's built-in WebView and platform APIs without additional runtime libraries, Firebase, analytics, a background service, or a new server. Login, availability, assignment, accept/reject, post-acceptance customer details, ride lifecycle and history retain their existing implementation and backend endpoints.

Local assets load from a fixed HTTPS app origin. A main-frame MessagePort transports only allowlisted driver requests to `/api/v1`. HTTPS certificates are validated; redirects, arbitrary destinations, unrelated API routes, cleartext traffic, cookies and untrusted WebView resources are blocked. Login credentials and bearer tokens remain in the existing JavaScript memory session; they are not stored in native preferences or the APK. Android backup is disabled. External navigation is limited to telephone dialing and Google Maps links.

The default API origin is the already-existing external tunnel:

`https://mall-pressing-sept-developmental.trycloudflare.com`

No new tunnel or service was created. The native **الاتصال** button can update the HTTPS API origin if the existing temporary tunnel changes, without rebuilding the app; saving a new origin clears the local session by reloading the bundled UI. Supply an API origin, not `/driver` and not `/api/v1`.

## Notifications and battery

Per the user's revised request, **external Push/FCM is not enabled**. The existing request card/in-app feed is live while the app is open. The notification button requests Android notification permission and enables local system notifications for foreground events. Native notifications never add customer details beyond the existing safe event text.

Going into the background disconnects native HTTP requests and pauses WebView timers. Returning to the app announces connectivity and refreshes authoritative state. There is no background polling, wake lock, foreground service or automatic replay of ride mutations. Receiving while fully closed is intentionally outside this build.

Future Firebase integration has two isolated entry points: `web/notifications.ts` (notification provider) and `DriverNotifications.java` (Android notification channel/display). A future FCM service still needs Android Firebase configuration, authenticated device registration, a server sender and recipient checks; none is claimed to be active here. The driver UI and ride API do not need replacement.

## Verification

- Android `assembleRelease`: PASS. The first compilation exposed an ambiguous Java import; it was fixed and the next assembly passed.
- `apksigner verify`: PASS, APK signature v2. Release variant has debugging disabled and uses the existing local Android development signing certificate for field installation, not Play Store production signing.
- APK metadata: `com.dispatchpro.driver`, 0.1.1 / 2, minSdk 24, targetSdk 36.
- New native bridge test: PASS (bearer/body/version forwarding, response status, cancellation, lifecycle/connectivity events).
- New JVM API-policy test: PASS (HTTPS origin validation, scoped ride requests, forbidden destinations/routes).
- Typecheck: PASS.
- External API smoke: `/health/live` 200; authenticated driver profile/history endpoints 401 without credentials; invalid login 401. No test account, ride or customer was created.
- No connected Android device/emulator was present; installation and a real authenticated field ride on a phone remain unverified.

The running API initially returned 404 for `/api/v1/driver/me`. The already-built/tested `backend/DispatchPro.Api/bin/DriverStage/DispatchPro.Api.dll` was loaded in place of the older API process on the same loopback address and port. No backend build, migrations, network settings, Reception/iCall/WhatsApp/Site Bridge source changes, or Customer App work were performed. Current API logs: `.dispatchpro-local/logs/api-driver-current.{stdout,stderr}.log`.

## Rebuild when needed

From the repository root, run `node driver-android/scripts/bundle.mjs`. With Android Studio's JBR as JAVA_HOME and SDK location in ignored `driver-android/local.properties`, run `gradlew.bat --offline --no-daemon :app:assembleRelease` in this directory. The included Gradle wrapper uses the already-installed version. This builds only the APK; it does not run Next.js or compile the backend. Keep the existing signing key for in-place upgrades.

## Field check

Install APK → open → login with an existing active driver account → Available → send a request from the office → Accept → verify customer/phone → Arrived → Start → Complete → History. Also check Reject, reconnect after airplane mode, and resume after backgrounding. Keep the app open while receiving work in this no-push build.
