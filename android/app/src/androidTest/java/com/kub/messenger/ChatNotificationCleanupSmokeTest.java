package com.kub.messenger;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import android.Manifest;
import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Process;
import android.service.notification.StatusBarNotification;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.google.firebase.messaging.RemoteMessage;
import java.util.List;
import java.util.Map;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Fictional cards only, explicitly confined to the coordinator's isolated QA user. */
@RunWith(AndroidJUnit4.class)
public class ChatNotificationCleanupSmokeTest {
    private static final String CHAT = "8c7c07ca-f2b2-4a9d-9c8d-e186ba40268d";
    private static final String OLD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    private static final String NEW = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
    private static final String USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
    private static final String INSTANCE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
    private static final String TAG = "message:chat:" + CHAT;

    private Context context() {
        assertTrue("Explicit non-primary QA profile must match this process", QaUserIsolation.matches(
            InstrumentationRegistry.getArguments().getString("qa_user"), Process.myUid()));
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        assertNotNull(manager);
        Assume.assumeTrue(manager.areNotificationsEnabled());
        Assume.assumeTrue(Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED);
        Assume.assumeFalse(VoiceCallRuntime.isResumed());
        return context;
    }
    private RemoteMessage message(String notificationId, String messageId) {
        RemoteMessage.Builder builder = new RemoteMessage.Builder("qa@letscube.invalid")
            .addData("native_chat_v", "1").addData("type", "message").addData("chat_id", CHAT).addData("message_id", messageId)
            .addData("tag", TAG).addData("group_tag", TAG).addData("title", "Fictional private sender").addData("body", "Fictional private body");
        if (notificationId != null) builder.addData("notification_id", notificationId);
        return builder.build();
    }
    private StatusBarNotification card(NotificationManager manager, String tag) {
        for (StatusBarNotification entry : manager.getActiveNotifications()) if (tag.equals(entry.getTag()) && entry.getId() == 0) return entry;
        return null;
    }
    private StatusBarNotification waitFor(NotificationManager manager, String tag, String notificationId) throws InterruptedException {
        for (int attempt = 0; attempt < 60; attempt++) {
            StatusBarNotification entry = card(manager, tag);
            if (entry != null && (notificationId == null
                ? entry.getNotification().extras.getString(ChatNotificationCleanup.EXTRA_NOTIFICATION) == null
                : notificationId.equals(entry.getNotification().extras.getString(ChatNotificationCleanup.EXTRA_NOTIFICATION)))) return entry;
            Thread.sleep(50);
        }
        throw new AssertionError("Fictional card did not become active");
    }
    @Test public void ownReadNewerReplacementMissingIdAndVoiceBoundaries() throws InterruptedException {
        Context context = context();
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        ChatNotificationCleanup.activate(INSTANCE); ChatNotificationCleanup.bind(INSTANCE, 1, USER, 1);
        ChatNotificationCleanup.Owner owner = ChatNotificationCleanup.matches(INSTANCE, 1, USER, 1);
        String voiceTag = "voice:ring:" + CHAT;
        try {
            ChatPushNotifications.receive(context, message(OLD, OLD));
            StatusBarNotification old = waitFor(manager, TAG, OLD);
            assertEquals("LETSCUBE", old.getNotification().extras.getCharSequence(Notification.EXTRA_TITLE).toString());
            assertEquals("\u041d\u043e\u0432\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435", old.getNotification().extras.getCharSequence(Notification.EXTRA_TEXT).toString());
            assertEquals(1, ChatNotificationsPlugin.removeRead(context, manager, owner, CHAT, List.of(new ChatNotificationCleanup.Read(OLD, OLD))));
            for (int attempt = 0; attempt < 60 && card(manager, TAG) != null; attempt++) Thread.sleep(50);
            assertEquals(null, card(manager, TAG));

            ChatPushNotifications.receive(context, message(OLD, OLD)); waitFor(manager, TAG, OLD);
            ChatPushNotifications.receive(context, message(NEW, NEW));
            // Deliberately do not wait for NEW: NotificationManager.notify only enqueues.
            assertEquals(0, ChatNotificationsPlugin.removeRead(context, manager, owner, CHAT, List.of(new ChatNotificationCleanup.Read(OLD, OLD))));
            assertEquals(NEW, waitFor(manager, TAG, NEW).getNotification().extras.getString(ChatNotificationCleanup.EXTRA_NOTIFICATION));
            assertEquals(1, ChatNotificationsPlugin.removeRead(context, manager, owner, CHAT, List.of(new ChatNotificationCleanup.Read(NEW, NEW))));
            manager.cancel(TAG, 0);

            ChatPushNotifications.receive(context, message(null, OLD));
            Notification generic = waitFor(manager, TAG, null).getNotification();
            assertEquals(0, ChatNotificationsPlugin.removeRead(context, manager, owner, CHAT, List.of(new ChatNotificationCleanup.Read(OLD, OLD))));
            manager.notify(voiceTag, 0, generic);
            assertNotNull(waitFor(manager, voiceTag, null));
            assertEquals(0, ChatNotificationsPlugin.removeRead(context, manager, owner, CHAT, List.of(new ChatNotificationCleanup.Read(OLD, OLD))));
            assertNotNull(card(manager, voiceTag));
        } finally {
            manager.cancel(TAG, 0); manager.cancel(voiceTag, 0); ChatNotificationCleanup.deactivate(INSTANCE);
        }
    }

    @Test public void pendingNewReadBeforeOsVisibilityReconciles() throws InterruptedException {
        Context context = context();
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        ChatNotificationCleanup.activate(INSTANCE); ChatNotificationCleanup.bind(INSTANCE, 1, USER, 1);
        ChatNotificationCleanup.Owner owner = ChatNotificationCleanup.matches(INSTANCE, 1, USER, 1);
        List<ChatNotificationCleanup.Read> read = List.of(new ChatNotificationCleanup.Read(NEW, NEW));
        try {
            ChatPushNotifications.receive(context, message(OLD, OLD)); waitFor(manager, TAG, OLD);
            ChatPushNotifications.receive(context, message(NEW, NEW));
            ChatNotificationCleanup.Result result = ChatNotificationsPlugin.reconcileRead(context, manager, owner, CHAT, read);
            Assume.assumeTrue("No pending window observed; this run is not pending-queue proof", result.pending);
            assertEquals(0, result.removed);
            for (int attempt = 1; attempt < 4 && result.pending; attempt++) {
                Thread.sleep(250);
                result = ChatNotificationsPlugin.reconcileRead(context, manager, owner, CHAT, read);
            }
            assertFalse("Pending cleanup did not settle inside the four-call budget", result.pending);
            assertEquals(1, result.removed);
            for (int attempt = 0; attempt < 60 && card(manager, TAG) != null; attempt++) Thread.sleep(50);
            assertEquals(null, card(manager, TAG));
        } finally { manager.cancel(TAG, 0); ChatNotificationCleanup.deactivate(INSTANCE); }
    }

    /** Coordinator runs post, kills only the isolated app process, then runs read. */
    @Test public void persistedOwnCardAfterColdProcess() throws Exception {
        String stage = InstrumentationRegistry.getArguments().getString("qa_cleanup_cold_stage");
        Assume.assumeTrue("post".equals(stage) || "read".equals(stage));
        Context context = context();
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if ("post".equals(stage)) {
            ChatPushNotifications.receive(context, message(OLD, OLD));
            assertEquals(OLD, waitFor(manager, TAG, OLD).getNotification().extras.getString(ChatNotificationCleanup.EXTRA_NOTIFICATION));
            return;
        }
        java.lang.reflect.Field posts = ChatNotificationCleanup.class.getDeclaredField("latestPosts"); posts.setAccessible(true);
        assertEquals("Cold acceptance requires a fresh process, not an in-memory cache", 0, ((Map<?, ?>) posts.get(null)).size());
        ChatNotificationCleanup.activate(INSTANCE); ChatNotificationCleanup.bind(INSTANCE, 1, USER, 1);
        ChatNotificationCleanup.Owner owner = ChatNotificationCleanup.matches(INSTANCE, 1, USER, 1);
        try {
            assertNotNull(waitFor(manager, TAG, OLD));
            assertEquals(1, ChatNotificationsPlugin.removeRead(context, manager, owner, CHAT, List.of(new ChatNotificationCleanup.Read(OLD, OLD))));
            for (int attempt = 0; attempt < 60 && card(manager, TAG) != null; attempt++) Thread.sleep(50);
            assertEquals(null, card(manager, TAG));
        } finally { manager.cancel(TAG, 0); ChatNotificationCleanup.deactivate(INSTANCE); }
    }
}
