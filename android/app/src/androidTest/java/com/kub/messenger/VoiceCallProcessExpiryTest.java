package com.kub.messenger;

import static org.junit.Assert.*;

import android.app.NotificationManager;
import android.content.Context;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.HashMap;
import java.util.Map;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Host orchestrates two separate processes; ordinary instrumentation runs skip it. */
@RunWith(AndroidJUnit4.class)
public class VoiceCallProcessExpiryTest {
    @Test public void processDeathProbe() {
        String phase = InstrumentationRegistry.getArguments().getString("voiceExpiryPhase");
        Assume.assumeTrue("Use the bounded two-process host runner", phase != null);
        assertTrue("Only the dedicated empty emulator is permitted",
            android.os.Build.FINGERPRINT.startsWith("google/sdk_gphone"));
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if ("verify".equals(phase)) {
            // Do not construct the runtime until after observing the OS: it prunes cards.
            assertEquals("OS timeout must remove the card without an app process", 0, count(manager));
            VoiceCallRuntime.get(context).clearBinding();
            return;
        }
        assertEquals("publish", phase);
        assertTrue(manager.areNotificationsEnabled());
        VoiceCallRuntime runtime = VoiceCallRuntime.get(context);
        runtime.clearBinding();
        runtime.setResumed(false);
        String user = "11111111-1111-4111-8111-111111111111";
        String session = "22222222-2222-4222-8222-222222222222";
        String chat = "33333333-3333-4333-8333-333333333333";
        String channel = "44444444-4444-4444-8444-444444444444";
        assertTrue(runtime.commitBinding(runtime.beginBinding(user, session), user, session));
        long start = System.currentTimeMillis();
        Map<String, String> data = new HashMap<>();
        data.put("protocol_version", "1"); data.put("type", "voice_call"); data.put("event", "ring");
        data.put("ring_key", "voice:" + channel + ":" + start);
        data.put("chat_id", chat); data.put("channel_id", channel);
        data.put("caller_id", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
        data.put("recipient_id", user); data.put("recipient_session_id", session);
        data.put("route", "/chat/" + chat);
        data.put("ring_started_at", String.valueOf(start));
        data.put("expires_at", String.valueOf(start + 8000));
        runtime.receive(data);
        long deadline = SystemClock.elapsedRealtime() + 2000;
        while (count(manager) != 1 && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(25);
        assertEquals("Positive control: the real OS card was posted", 1, count(manager));
        // Deliberately leave this synthetic card for the host to observe after process death.
    }

    private int count(NotificationManager manager) {
        int count = 0;
        for (StatusBarNotification card : manager.getActiveNotifications()) {
            if (card.getTag() != null && card.getTag().startsWith("letscube.voice:")) count++;
        }
        return count;
    }
}
