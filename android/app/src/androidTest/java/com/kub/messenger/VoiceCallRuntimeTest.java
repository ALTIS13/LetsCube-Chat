package com.kub.messenger;

import static org.junit.Assert.*;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import android.provider.Settings;
import android.service.notification.StatusBarNotification;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.google.firebase.messaging.RemoteMessage;
import java.io.File;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Offline synthetic events only. Run solely on the dedicated empty QA emulator. */
@RunWith(AndroidJUnit4.class)
public class VoiceCallRuntimeTest {
    private static final String USER = "11111111-1111-4111-8111-111111111111";
    private static final String SESSION = "22222222-2222-4222-8222-222222222222";
    private static final String CHAT = "33333333-3333-4333-8333-333333333333";
    private static final String CHANNEL = "44444444-4444-4444-8444-444444444444";
    private static final String CALLER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    private Context context;
    private NotificationManager notifications;
    private VoiceCallRuntime runtime;

    @Before public void prepare() {
        assertTrue("Only the owned emulator may run destructive test-state cleanup",
            android.os.Build.FINGERPRINT.startsWith("google/sdk_gphone"));
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        notifications = context.getSystemService(NotificationManager.class);
        assertTrue("Grant permission on the empty emulator before running this suite", notifications.areNotificationsEnabled());
        runtime = VoiceCallRuntime.get(context);
        runtime.setResumed(false);
        runtime.clearBinding();
        String epoch = runtime.beginBinding(USER, SESSION);
        assertTrue(runtime.commitBinding(epoch, USER, SESSION));
    }

    @After public void cleanup() {
        if (runtime != null) {
            runtime.setResumed(false);
            runtime.clearBinding();
        }
        if (notifications != null) notifications.cancel("voice-qa-ordinary", 73401);
    }

    private Map<String, String> wire(String event, long start, long lifetime) {
        Map<String, String> data = new HashMap<>();
        data.put("protocol_version", "1"); data.put("type", "voice_call"); data.put("event", event);
        data.put("ring_key", "voice:" + CHANNEL + ":" + start);
        data.put("chat_id", CHAT); data.put("channel_id", CHANNEL); data.put("caller_id", CALLER);
        data.put("recipient_id", USER); data.put("recipient_session_id", SESSION);
        data.put("route", "/chat/" + CHAT);
        data.put("ring_started_at", String.valueOf(start)); data.put("expires_at", String.valueOf(start + lifetime));
        return data;
    }

    private List<StatusBarNotification> cards() {
        List<StatusBarNotification> result = new ArrayList<>();
        for (StatusBarNotification item : notifications.getActiveNotifications()) {
            if (item.getTag() != null && item.getTag().startsWith("letscube.voice:")) result.add(item);
        }
        return result;
    }

    private List<StatusBarNotification> awaitCards(int count) {
        long deadline = SystemClock.elapsedRealtime() + 5000;
        List<StatusBarNotification> result;
        do {
            result = cards();
            if (result.size() == count) return result;
            SystemClock.sleep(25);
        } while (SystemClock.elapsedRealtime() < deadline);
        assertEquals("Unexpected number of native call cards", count, result.size());
        return result;
    }

    private VoiceCallState readPersisted() throws Exception {
        File file = new File(context.getNoBackupFilesDir(), "voice-calls-v1.bin");
        return VoiceCallState.decode(Files.readAllBytes(file.toPath()), new VoiceCallState.Clock() {
            public long wallTime() { return System.currentTimeMillis(); }
            public long elapsedTime() { return SystemClock.elapsedRealtime(); }
            public long bootCount() { return Settings.Global.getInt(context.getContentResolver(), Settings.Global.BOOT_COUNT, -1); }
        });
    }

    @Test public void servicePostsRealCardWithoutWebViewOrNetwork() {
        long start = System.currentTimeMillis();
        Map<String, String> data = wire("ring", start, 45000);
        class AttachedService extends VoiceCallMessagingService {
            void attach(Context value) { attachBaseContext(value); }
        }
        AttachedService service = new AttachedService();
        service.attach(context);
        service.onMessageReceived(new RemoteMessage.Builder("fixture").setData(data).build());
        StatusBarNotification card = awaitCards(1).get(0);
        assertEquals("letscube.voice:voice:" + CHANNEL + ":" + start, card.getTag());
        assertEquals("calls", card.getNotification().getChannelId());
        assertEquals(Notification.CATEGORY_CALL, card.getNotification().category);
        assertEquals(NotificationManager.IMPORTANCE_HIGH, notifications.getNotificationChannel("calls").getImportance());
        assertTrue(card.getNotification().getTimeoutAfter() > 0);
        assertTrue(card.getNotification().getTimeoutAfter() <= 45000);
        assertNotNull(card.getNotification().contentIntent);
        assertNull(card.getNotification().fullScreenIntent);
    }

    @Test public void duplicateAcrossRuntimeReconstructionDoesNotRepost() {
        Map<String, String> data = wire("ring", System.currentTimeMillis(), 45000);
        runtime.receive(data);
        long postedAt = awaitCards(1).get(0).getPostTime();
        SystemClock.sleep(50);
        new VoiceCallRuntime(context).receive(data);
        assertEquals(postedAt, awaitCards(1).get(0).getPostTime());
    }

    @Test public void cancellationPersistsBeforeRingAndAcrossRuntimeReconstruction() {
        long start = System.currentTimeMillis();
        runtime.receive(wire("cancel", start, 45000));
        new VoiceCallRuntime(context).receive(wire("ring", start, 45000));
        assertEquals(0, cards().size());
    }

    @Test public void oldCancelLeavesNewGenerationCard() {
        long start = System.currentTimeMillis() - 100;
        runtime.receive(wire("ring", start, 45000));
        runtime.receive(wire("ring", start + 1, 45000));
        awaitCards(2);
        runtime.receive(wire("cancel", start, 45000));
        assertEquals("letscube.voice:voice:" + CHANNEL + ":" + (start + 1), awaitCards(1).get(0).getTag());
    }

    @Test public void expiryRemovesRealCardWithoutCancelDelivery() {
        runtime.receive(wire("ring", System.currentTimeMillis(), 2000));
        awaitCards(1);
        SystemClock.sleep(2050);
        awaitCards(0);
    }

    @Test public void wrongSessionAndUnverifiedCandidateShowNothing() {
        Map<String, String> data = wire("ring", System.currentTimeMillis(), 45000);
        data.put("recipient_session_id", CALLER);
        runtime.receive(data);
        assertEquals(0, cards().size());
        runtime.beginBinding(USER, SESSION);
        runtime.receive(wire("ring", System.currentTimeMillis(), 45000));
        assertEquals(0, cards().size());
    }

    @Test public void foregroundOwnerSuppressesOnlyItsExactGeneration() {
        long start = System.currentTimeMillis() - 50;
        runtime.setResumed(true);
        runtime.setForegroundRing("voice:" + CHANNEL + ":" + start);
        runtime.receive(wire("ring", start, 45000));
        assertEquals(0, cards().size());
        runtime.receive(wire("ring", start + 1, 45000));
        assertEquals("letscube.voice:voice:" + CHANNEL + ":" + (start + 1), awaitCards(1).get(0).getTag());
    }

    @Test public void disablingCallsAndLogoutDoNotRemoveOrdinaryNotification() {
        notifications.createNotificationChannel(new NotificationChannel("voice-qa-ordinary", "Fixture", NotificationManager.IMPORTANCE_LOW));
        notifications.notify("voice-qa-ordinary", 73401,
            new Notification.Builder(context, "voice-qa-ordinary").setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("Fixture").build());
        runtime.receive(wire("ring", System.currentTimeMillis(), 45000));
        awaitCards(1);
        runtime.setCallsAllowed(false);
        awaitCards(0);
        runtime.receive(wire("ring", System.currentTimeMillis(), 45000));
        assertEquals(0, cards().size());
        runtime.clearBinding();
        boolean ordinaryPresent = false;
        for (StatusBarNotification item : notifications.getActiveNotifications()) {
            if (item.getId() == 73401 && "voice-qa-ordinary".equals(item.getTag())) ordinaryPresent = true;
        }
        assertTrue(ordinaryPresent);
    }

    @Test public void tapSurvivesSameSessionReverificationButNotRebinding() throws Exception {
        long start = System.currentTimeMillis();
        String key = "voice:" + CHANNEL + ":" + start;
        runtime.receive(wire("ring", start, 45000));
        awaitCards(1);
        String tap = readPersisted().tapToken(key);
        assertNotNull(tap);
        assertTrue(runtime.captureIntent(new Intent().setAction(VoiceCallRuntime.ACTION_PREFIX + tap)));
        String epoch = runtime.beginBinding(USER, SESSION);
        assertNull(runtime.consumePendingAction());
        assertTrue(runtime.commitBinding(epoch, USER, SESSION));
        assertEquals("/chat/" + CHAT, runtime.consumePendingAction().toMap().get("route"));
        assertNull(runtime.consumePendingAction());
        assertFalse(runtime.captureIntent(new Intent().setAction(VoiceCallRuntime.ACTION_PREFIX + tap)));

        start = System.currentTimeMillis() + 1;
        SystemClock.sleep(2);
        runtime.receive(wire("ring", start, 45000));
        awaitCards(1);
        tap = readPersisted().tapToken("voice:" + CHANNEL + ":" + start);
        assertTrue(runtime.captureIntent(new Intent().setAction(VoiceCallRuntime.ACTION_PREFIX + tap)));
        epoch = runtime.beginBinding(CALLER, CHAT);
        assertTrue(runtime.commitBinding(epoch, CALLER, CHAT));
        assertNull(runtime.consumePendingAction());
        awaitCards(0);
    }

    @Test public void consumedTapRevalidatesFromDiskAndLaterCancellationWins() throws Exception {
        long start = System.currentTimeMillis();
        String key = "voice:" + CHANNEL + ":" + start;
        runtime.receive(wire("ring", start, 45000));
        awaitCards(1);
        String tap = readPersisted().tapToken(key);
        assertTrue(runtime.captureIntent(new Intent().setAction(VoiceCallRuntime.ACTION_PREFIX + tap)));
        assertNotNull(runtime.consumePendingAction());
        String epoch = runtime.beginBinding(USER, SESSION);
        assertNull(runtime.revalidateConsumedAction(key));
        assertTrue(runtime.commitBinding(epoch, USER, SESSION));
        VoiceCallRuntime rebuilt = new VoiceCallRuntime(context);
        assertEquals("/chat/" + CHAT, rebuilt.revalidateConsumedAction(key).toMap().get("route"));
        rebuilt.receive(wire("cancel", start, 45000));
        assertNull(runtime.revalidateConsumedAction(key));
        awaitCards(0);
    }
}
