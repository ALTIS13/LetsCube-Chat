package com.kub.messenger;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

final class ChatPushNotifications {
    private static final String CHANNEL_ID = "messages";

    static void receive(Context context, RemoteMessage message) {
        Map<String, String> data = message.getData();
        ChatPushNotificationContract.Event event = ChatPushNotificationContract.parse(data);
        if (event == null || VoiceCallRuntime.isResumed()) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || !manager.areNotificationsEnabled()) return;
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED) return;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Сообщения", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            manager.createNotificationChannel(channel);
            if (manager.getNotificationChannel(CHANNEL_ID).getImportance() == NotificationManager.IMPORTANCE_NONE) return;
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
            ? new Notification.Builder(context, CHANNEL_ID) : new Notification.Builder(context);
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
