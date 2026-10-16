package com.kub.messenger;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.service.notification.StatusBarNotification;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.function.LongSupplier;

/**
 * Presentation only. The caller MUST hold accepted native credential/choice authority
 * throughout this synchronous call; Cleanup.Owner is not that authority.
 * Active-query/notify is not an atomic OS compare-and-set against an external swipe.
 */
final class ChatMessagePreviewPublisher {
    private static final String GENERIC = "\u041d\u043e\u0432\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435";

    static boolean publish(Context context, NotificationManager manager, ChatNotificationCleanup.Owner owner,
            ChatNotificationCleanup.Card expected, MessagePreviewContent content) {
        return publish(context, manager, owner, expected, content, System::currentTimeMillis);
    }

    // Posting exceptions propagate: the effect is unknown, never a reason to retry/repost.
    static boolean publish(Context context, NotificationManager manager, ChatNotificationCleanup.Owner owner,
            ChatNotificationCleanup.Card expected, MessagePreviewContent content, LongSupplier clock) {
        if (Build.VERSION.SDK_INT < 24 || context == null || manager == null || owner == null || expected == null
            || content == null || clock == null || content.recipient == null || content.notification == null
            || content.chat == null || content.message == null || content.title == null || content.body == null
            || !("sender".equals(content.level) || "message".equals(content.level))
            || !content.recipient.equals(owner.ownerId) || !content.notification.equals(expected.notificationId)
            || !content.chat.equals(expected.chatId) || !content.message.equals(expected.messageId)) return false;
        long first = wallTime(clock);
        if (!fresh(content, first)) return false;
        CurrentCards cards = new CurrentCards(context, manager, expected);
        boolean[] published = {false};
        ChatNotificationCleanup.updateCurrent(owner, expected, cards, () -> {
            Notification original = cards.current;
            if (original == null || original.contentIntent == null || original.getSmallIcon() == null) return;
            Notification readable;
            try {
                String channel = Build.VERSION.SDK_INT >= 26 ? original.getChannelId() : null;
                if (Build.VERSION.SDK_INT >= 26 && (channel == null || channel.isEmpty())) return;
                Notification.Builder generic = Build.VERSION.SDK_INT >= 26
                    ? new Notification.Builder(context, channel) : new Notification.Builder(context);
                Notification publicVersion = generic.setSmallIcon(original.getSmallIcon())
                    .setContentTitle("LETSCUBE").setContentText(GENERIC)
                    .setStyle(new Notification.BigTextStyle().setBigContentTitle("LETSCUBE").bigText(GENERIC))
                    .setVisibility(Notification.VISIBILITY_PUBLIC).setWhen(original.when)
                    .setContentIntent(original.contentIntent).build();
                readable = Notification.Builder.recoverBuilder(context, original.clone())
                    .setContentTitle(content.title).setContentText(content.body)
                    .setStyle(new Notification.BigTextStyle().setBigContentTitle(content.title).bigText(content.body))
                    .setVisibility(Notification.VISIBILITY_PRIVATE).setOnlyAlertOnce(true)
                    .setPublicVersion(publicVersion).build();
            } catch (RuntimeException unavailable) { return; }
            // Recheck after builder work, without allocating a new cleanup generation.
            ChatNotificationCleanup.updateCurrent(owner, expected, cards, () -> {
                if (!samePresentation(readable, cards.current)) return;
                long now = wallTime(clock);
                if (now < first || !fresh(content, now)) return;
                manager.notify(expected.tag, expected.id, readable);
                published[0] = true;
            });
        });
        return published[0];
    }

    private static boolean fresh(MessagePreviewContent content, long now) {
        return now >= 0 && now <= 9007199254740991L && content.expiresAt > now
            && content.expiresAt <= 9007199254740991L && content.expiresAt - now <= 15_000;
    }

    private static long wallTime(LongSupplier clock) {
        try { return clock.getAsLong(); }
        catch (RuntimeException unavailable) { return -1; }
    }

    private static boolean samePresentation(Notification built, Notification active) {
        return active != null && built.when == active.when && Objects.equals(built.contentIntent, active.contentIntent)
            && (Build.VERSION.SDK_INT < 26 || Objects.equals(built.getChannelId(), active.getChannelId()));
    }

    private static final class CurrentCards implements ChatNotificationCleanup.Cards {
        private final Context context;
        private final NotificationManager manager;
        private final ChatNotificationCleanup.Card expected;
        private final ChatNotificationCleanup.IntentStore intents;
        Notification current;

        CurrentCards(Context context, NotificationManager manager, ChatNotificationCleanup.Card expected) {
            this.context = context; this.manager = manager; this.expected = expected;
            intents = new ChatNotificationIntentStore(context);
        }
        @Override public ChatNotificationCleanup.IntentStore intents() { return intents; }
        @Override public void cancel(String tag, int id) { manager.cancel(tag, id); }
        @Override public List<ChatNotificationCleanup.Card> active() {
            current = null;
            try {
                StatusBarNotification[] entries = manager.getActiveNotifications();
                if (entries == null) return null;
                List<ChatNotificationCleanup.Card> cards = new ArrayList<>();
                for (StatusBarNotification entry : entries) {
                    if (entry == null) return null;
                    if (!context.getPackageName().equals(entry.getPackageName())) continue;
                    Notification notification = entry.getNotification();
                    if (notification == null || notification.extras == null) continue;
                    Bundle extras = notification.extras;
                    cards.add(new ChatNotificationCleanup.Card(entry.getTag(), entry.getId(),
                        (notification.flags & Notification.FLAG_GROUP_SUMMARY) != 0,
                        extras.getInt(ChatNotificationCleanup.EXTRA_VERSION, 0), extras.getString(ChatNotificationCleanup.EXTRA_CHAT),
                        extras.getString(ChatNotificationCleanup.EXTRA_NOTIFICATION), extras.getString(ChatNotificationCleanup.EXTRA_MESSAGE),
                        extras.getLong(ChatNotificationCleanup.EXTRA_GENERATION, 0)));
                    if (entry.getId() == expected.id && expected.tag.equals(entry.getTag())) current = notification;
                }
                return cards;
            } catch (RuntimeException unavailable) { current = null; return null; }
        }
    }
    private ChatMessagePreviewPublisher() { }
}
