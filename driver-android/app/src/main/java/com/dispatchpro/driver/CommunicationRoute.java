package com.dispatchpro.driver;

import android.media.AudioDeviceInfo;
import android.media.AudioManager;

/** Android 12+: a saved output is not necessarily a selectable communication route. */
final class CommunicationRoute {
    private CommunicationRoute() {}

    static boolean select(AudioManager manager, AudioDeviceInfo saved) {
        if (saved == null) return false;
        for (AudioDeviceInfo available : manager.getAvailableCommunicationDevices()) {
            if (available.getId() == saved.getId() && available.getType() == saved.getType()) {
                try {
                    return manager.setCommunicationDevice(available);
                } catch (IllegalArgumentException disconnected) {
                    // A headset can disappear between enumeration and selection.
                    android.util.Log.w("DriverAudio", "Communication route became unavailable");
                    return false;
                }
            }
        }
        return false;
    }

    static void restore(AudioManager manager, AudioDeviceInfo previous) {
        if (!select(manager, previous)) manager.clearCommunicationDevice();
    }
}
