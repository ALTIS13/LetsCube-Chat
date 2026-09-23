package com.kub.messenger;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;

import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

final class ChatPushNotifications {
    private static final String LEGACY_CHANNEL_ID = "messages";
    private static final String FRESH_CHANNEL_ID = "messages_v2";

    static String channelIdFor(boolean legacyExists, boolean freshExists) {
        // Once a fresh install chose v2, a later legacy FCM channel must not
        // change the native message sound. Legacy-only upgrades retain their
        // existing channel's sound and mute choices by design.
        return freshExists || !legacyExists ? FRESH_CHANNEL_ID : LEGACY_CHANNEL_ID;
    }

    private static Uri soundUri(Context context) {
        // A name-based URI survives resource ID changes across app updates.
        return Uri.parse("android.resource://" + context.getPackageName() + "/raw/letscube_message_v2");
    }

    static void receive(Context context, RemoteMessage message) {
        Map<String, String> data = message.getData();
        ChatPushNotificationContract.Event event = ChatPushNotificationContract.parse(data);
        if (event == null || VoiceCallRuntime.isResumed()) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || !manager.areNotificationsEnabled()) return;
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED) return;
        String channelId = LEGACY_CHANNEL_ID;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel legacy = manager.getNotificationChannel(LEGACY_CHANNEL_ID);
            NotificationChannel fresh = manager.getNotificationChannel(FRESH_CHANNEL_ID);
            channelId = channelIdFor(legacy != null, fresh != null);
            if (FRESH_CHANNEL_ID.equals(channelId) && fresh == null) {
                NotificationChannel channel = new NotificationChannel(FRESH_CHANNEL_ID, "Сообщения", NotificationManager.IMPORTANCE_DEFAULT);
                channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
                channel.setSound(soundUri(context), new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
                manager.createNotificationChannel(channel);
            }
            NotificationChannel selected = manager.getNotificationChannel(channelId);
            if (selected == null || selected.getImportance() == NotificationManager.IMPORTANCE_NONE) return;
        }

        Intent intent = new Intent(context, MainActivity.class)
            .setAction("com.kub.messenger.CHAT_PUSH_OPEN")
            .setData(Uri.parse("letscube://push/chat/" + event.chatId))
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        String fcmId = message.getMessageId();
        intent.putExtra("google.message_id", fcmId == null ? event.messageId : fcmId);
        intent.putExtra("type", "message");
        intent.putExtra("route", event.route);
        intent.putExtra("chat_id", event.chatId);
        intent.putExtra("message_id", event.messageId);
        intent.putExtra("tag", event.tag);
        for (String key : new String[] {"notification_id", "sender_kind", "sender_id", "bot_id", "sender_name",
            "sender_avatar_url", "kub_message_type", "preview", "group_tag"}) {
            String value = data.get(key);
            if (value != null) intent.putExtra(key, value);
        }
        PendingIntent tap = PendingIntent.getActivity(context, event.chatId.hashCode(), intent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(context, channelId) : new Notification.Builder(context);
        Notification notification = builder
            .setSmallIcon(R.drawable.ic_stat_message)
            .setContentTitle(event.title)
            .setContentText(event.body)
            .setStyle(new Notification.BigTextStyle().bigText(event.body))
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .build();
        manager.notify(event.tag, 0, notification);
    }
}
