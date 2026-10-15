package com.dispatchpro.driver;

import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import java.util.List;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Robolectric;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.Implementation;
import org.robolectric.annotation.Implements;
import org.robolectric.shadows.AudioDeviceInfoBuilder;
import org.robolectric.shadows.ShadowAudioManager;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk=33, shadows=CommunicationRouteTest.RouteShadow.class)
public class CommunicationRouteTest {
    AudioManager manager;
    RouteShadow route;
    @Before public void before() {
        manager=RuntimeEnvironment.getApplication().getSystemService(AudioManager.class);
        route=(RouteShadow)Shadows.shadowOf(manager);
    }
    static AudioDeviceInfo device(int type) { return AudioDeviceInfoBuilder.newBuilder().setType(type).build(); }

    @Test public void a2dpSnapshotIsNeverSubmittedAsACommunicationRoute() {
        route.setAvailableCommunicationDevices(List.of(device(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)));
        CommunicationRoute.restore(manager,device(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP));
        assertEquals(0,route.attempts);assertTrue(route.cleared);
    }
    @Test public void availableHeadsetIsRestoredUsingItsCurrentDeviceObject() {
        AudioDeviceInfo current=device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO);
        route.setAvailableCommunicationDevices(List.of(current));
        CommunicationRoute.restore(manager,device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO));
        assertSame(current,route.selected);assertFalse(route.cleared);
    }
    @Test public void disconnectBetweenEnumerationAndSelectionFallsBackWithoutCrashing() {
        AudioDeviceInfo current=device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO);
        route.setAvailableCommunicationDevices(List.of(current));route.disconnect=true;
        CommunicationRoute.restore(manager,current);
        assertEquals(1,route.attempts);assertTrue(route.cleared);
    }
    @Test public void vendorReturningUnsupportedA2dpStillCannotCrashRestoration() {
        AudioDeviceInfo a2dp=device(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP);
        route.setAvailableCommunicationDevices(List.of(a2dp));
        CommunicationRoute.restore(manager,a2dp);
        assertEquals(1,route.attempts);assertTrue(route.cleared);
    }
    @Test public void rejectedOrAbsentRouteClearsSelection() {
        AudioDeviceInfo current=device(AudioDeviceInfo.TYPE_USB_HEADSET);
        route.setAvailableCommunicationDevices(List.of(current));route.reject=true;
        CommunicationRoute.restore(manager,current);assertTrue(route.cleared);
        route.cleared=false;CommunicationRoute.restore(manager,null);assertTrue(route.cleared);
        assertEquals(1,route.attempts);
    }
    @Test public void reconnectRestoresTheFreshHeadsetAfterAnAbsentRoute() {
        AudioDeviceInfo disconnected=device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO);
        route.setAvailableCommunicationDevices(List.of());
        CommunicationRoute.restore(manager,disconnected);assertTrue(route.cleared);
        route.cleared=false;
        AudioDeviceInfo reconnected=device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO);
        route.setAvailableCommunicationDevices(List.of(reconnected));
        CommunicationRoute.restore(manager,disconnected);assertSame(reconnected,route.selected);assertFalse(route.cleared);
    }
    @Test public void activityReturnsToNormalAfterRepeatedAudioAndCallHandoffs() throws Exception {
        MainActivity activity=Robolectric.buildActivity(MainActivity.class).get();
        field(activity,"audioManager",manager);field(activity,"pttPrepared",true);
        AudioDeviceInfo a2dp=device(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP),speaker=device(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER);
        route.setAvailableCommunicationDevices(List.of(speaker));
        for(int i=0;i<3;i++) {
            route.selected=a2dp;manager.setMode(AudioManager.MODE_NORMAL);
            audio(activity,true);assertEquals(AudioManager.MODE_IN_COMMUNICATION,manager.getMode());
            audio(activity,false);assertEquals(AudioManager.MODE_NORMAL,manager.getMode());
            assertFalse((Boolean)field(activity,"audioRouteActive"));assertNull(field(activity,"previousCommunicationDevice"));
        }
    }
    @Test public void idleLoginAndStatusCleanupDoNotSelectAnyAudioDevice() throws Exception {
        MainActivity activity=Robolectric.buildActivity(MainActivity.class).get();
        field(activity,"audioManager",manager);field(activity,"pttPrepared",true);
        audio(activity,false);audio(activity,false);
        assertEquals(0,route.attempts);assertFalse(route.cleared);
    }
    @Test public void activitySurvivesHeadsetDisconnectAndUsesReconnectedHeadsetNextTime() throws Exception {
        MainActivity activity=Robolectric.buildActivity(MainActivity.class).get();
        field(activity,"audioManager",manager);field(activity,"pttPrepared",true);
        AudioDeviceInfo first=device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO);
        route.selected=first;route.setAvailableCommunicationDevices(List.of(first));
        audio(activity,true);
        route.setAvailableCommunicationDevices(List.of());route.selected=null;
        audio(activity,false);assertTrue(route.cleared);assertEquals(AudioManager.MODE_NORMAL,manager.getMode());
        AudioDeviceInfo next=device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO);
        route.cleared=false;route.selected=next;route.setAvailableCommunicationDevices(List.of(next));
        audio(activity,true);audio(activity,false);
        assertSame(next,route.selected);assertFalse(route.cleared);assertFalse((Boolean)field(activity,"audioRouteActive"));
    }
    static Object field(MainActivity activity,String name) throws Exception {var f=MainActivity.class.getDeclaredField(name);f.setAccessible(true);return f.get(activity);}
    @Test public void callServiceRestoresUnsupportedA2dpWithoutCrashing() {
        manager.setMode(AudioManager.MODE_NORMAL);route.selected=device(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP);
        var service=Robolectric.buildService(CallAudioService.class).create();
        manager.setMode(AudioManager.MODE_IN_COMMUNICATION);route.setAvailableCommunicationDevices(List.of(device(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)));
        service.destroy();assertTrue(route.cleared);assertEquals(AudioManager.MODE_NORMAL,manager.getMode());assertFalse(CallAudioService.running);
    }
    @Test public void callServiceRestoresCurrentBluetoothDeviceAndToleratesItsDisconnection() {
        manager.setMode(AudioManager.MODE_NORMAL);AudioDeviceInfo saved=device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO);route.selected=saved;route.setAvailableCommunicationDevices(List.of(saved));
        var service=Robolectric.buildService(CallAudioService.class).create();route.disconnect=true;
        service.destroy();assertTrue(route.cleared);assertEquals(AudioManager.MODE_NORMAL,manager.getMode());assertFalse(CallAudioService.requested);
    }
    static void field(MainActivity activity,String name,Object value) throws Exception {var f=MainActivity.class.getDeclaredField(name);f.setAccessible(true);f.set(activity,value);}
    static void audio(MainActivity activity,boolean active) throws Exception {var method=MainActivity.class.getDeclaredMethod("audio",boolean.class);method.setAccessible(true);method.invoke(activity,active);}
    @Implements(AudioManager.class)
    public static class RouteShadow extends ShadowAudioManager {
        int attempts;boolean cleared,disconnect,reject;AudioDeviceInfo selected;
        @Implementation protected boolean setCommunicationDevice(AudioDeviceInfo device) {
            attempts++;
            if(disconnect||device.getType()==AudioDeviceInfo.TYPE_BLUETOOTH_A2DP)throw new IllegalArgumentException("invalid device type "+device.getType());
            if(reject)return false;
            selected=device;return true;
        }
        @Implementation protected void clearCommunicationDevice() { cleared=true;selected=null; }
        @Implementation protected AudioDeviceInfo getCommunicationDevice() { return selected; }
    }
}
