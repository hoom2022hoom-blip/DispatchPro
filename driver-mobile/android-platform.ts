import { connectNative, driverNativeFetch, nativeCall } from '../driver-android/web/native-bridge';
import { configureDriverPlatform, type NotificationPermissionResult } from './runtime';

// An Android host can call this before mounting the shared entry point.
// The existing released APK is retained without rebuilding it.
export async function configureAndroidDriver() {
  await connectNative();
  configureDriverPlatform({
    fetch: driverNativeFetch,
    notifications: {
      requestPermission: () => nativeCall<NotificationPermissionResult>('permission'),
      async show(title, body) { await nativeCall('notification', { title, body }); },
    },
  });
}
