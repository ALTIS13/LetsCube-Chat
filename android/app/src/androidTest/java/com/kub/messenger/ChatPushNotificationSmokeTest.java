package com.kub.messenger;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.service.notification.StatusBarNotification;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.google.firebase.messaging.RemoteMessage;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class ChatPushNotificationSmokeTest {
    @Test public void dataOnlyChatDisplaysOneRoutableCard() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        assertNotNull(manager);
        Assume.assumeTrue(manager.areNotificationsEnabled());
        Assume.assumeTrue(Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED);
        String expectedChannel = null;
        if (Build.VERSION.SDK_INT >= 26) {
            expectedChannel = ChatPushNotifications.channelIdFor(
                manager.getNotificationChannel("messages") != null,
                manager.getNotificationChannel("messages_v2") != null);
        }

        String chat = "6f9f45a8-1de9-475e-82df-d16e39b9df7b";
        String message = "4e3468a1-61d3-4c70-b67d-3d8f045b87bf";
        String tag = "message:chat:" + chat;
        RemoteMessage push = new RemoteMessage.Builder("qa@letscube.invalid")
            .addData("native_chat_v", "1")
            .addData("type", "message")
            .addData("chat_id", chat)
            .addData("message_id", message)
            .addData("tag", tag)
            .addData("group_tag", tag)
            .addData("title", "LETSCUBE QA")
            .addData("body", "Notification smoke")
            .build();
        try {
            ChatPushNotifications.receive(context, push);
            StatusBarNotification found = null;
            for (StatusBarNotification card : manager.getActiveNotifications()) {
                if (tag.equals(card.getTag())) found = card;
            }
            assertNotNull("A data-only message must display an OS card", found);
            if (Build.VERSION.SDK_INT >= 26) {
                assertEquals(expectedChannel, found.getNotification().getChannelId());
                NotificationChannel selected = manager.getNotificationChannel(expectedChannel);
                assertNotNull(selected);
                if ("messages_v2".equals(expectedChannel)) {
                    assertEquals("android.resource://" + context.getPackageName() + "/raw/letscube_message_v2",
                        selected.getSound().toString());
                }
            }
            assertEquals(R.drawable.ic_stat_message, found.getNotification().getSmallIcon().getResId());
            assertNotNull(found.getNotification().contentIntent);
            assertTrue((found.getNotification().flags & android.app.Notification.FLAG_AUTO_CANCEL) != 0);
        } finally {
            manager.cancel(tag, 0);
        }
    }
}
