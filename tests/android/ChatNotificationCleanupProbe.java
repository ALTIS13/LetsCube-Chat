package com.kub.messenger;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.service.notification.StatusBarNotification;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.google.firebase.messaging.RemoteMessage;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public final class ChatNotificationCleanupProbe {
    static final String CHAT = "8c7c07ca-f2b2-4a9d-9c8d-e186ba40268d";
    static final String OLD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    static final String NEW = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
    static final String USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
    static final String INSTANCE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
    static final String TAG = "message:chat:" + CHAT;
    static final ChatNotificationCleanup.IntentStore intents = new ChatNotificationIntentStore(new Context());
    static void check(boolean ok, String oracle) { if (!ok) throw new AssertionError(oracle); }
    static void await(CountDownLatch latch) {
        try { check(latch.await(3, TimeUnit.SECONDS), "FIXTURE_LATCH"); } catch (InterruptedException error) { throw new AssertionError(error); }
    }
    static void joined(Thread thread) {
        try { thread.join(3000); check(!thread.isAlive(), "FIXTURE_JOIN"); } catch (InterruptedException error) { throw new AssertionError(error); }
    }
    static void contending(Thread thread) {
        long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
        while (thread.isAlive() && thread.getState() != Thread.State.BLOCKED && System.nanoTime() < end) Thread.yield();
    }
    static ChatNotificationCleanup.Owner owner() {
        ChatNotificationCleanup.activate(INSTANCE);
        check(ChatNotificationCleanup.bind(INSTANCE, 1, USER, 1), "OWNER_BOUND");
        return ChatNotificationCleanup.matches(INSTANCE, 1, USER, 1);
    }
    static List<ChatNotificationCleanup.Read> reads() { return List.of(new ChatNotificationCleanup.Read(OLD, OLD)); }
    static ChatNotificationCleanup.Card card(String notification, String message, int protocol, boolean summary, String chat, String tag, int id) {
        return new ChatNotificationCleanup.Card(tag, id, summary, protocol, chat, notification, message, 0);
    }
    static final class Store implements ChatNotificationCleanup.Cards {
        volatile ChatNotificationCleanup.Card card;
        Store() { setCard(card(OLD, OLD, 1, false, CHAT, TAG, 0)); }
        void setCard(ChatNotificationCleanup.Card next) {
            ChatNotificationCleanup.post(intents, next.tag, next.notificationId, next.messageId, generation -> card =
                new ChatNotificationCleanup.Card(next.tag, next.id, next.summary, next.protocol, next.chatId, next.notificationId, next.messageId, generation));
        }
        int takes, cancels;
        CountDownLatch taken, release;
        CountDownLatch cancelling, allowCancel;
        boolean fail;
        @Override public List<ChatNotificationCleanup.Card> active() {
            takes++;
            ChatNotificationCleanup.Card snapshot = card;
            if (taken != null) { taken.countDown(); await(release); }
            return snapshot == null ? List.of() : List.of(snapshot);
        }
        @Override public ChatNotificationCleanup.IntentStore intents() { return intents; }
        @Override public void cancel(String tag, int id) {
            if (fail) throw new IllegalStateException("fictional failure");
            if (cancelling != null) { cancelling.countDown(); await(allowCancel); }
            cancels++;
            if (card != null && card.tag.equals(tag) && card.id == id) card = null;
        }
    }
    static Map<String, String> payload(String notificationId, String messageId) {
        Map<String, String> data = new HashMap<>();
        data.put("native_chat_v", "1"); data.put("type", "message"); data.put("chat_id", CHAT); data.put("message_id", messageId);
        data.put("tag", TAG); data.put("group_tag", TAG); data.put("title", "Fictional private sender"); data.put("body", "Fictional private body");
        if (notificationId != null) data.put("notification_id", notificationId);
        return data;
    }
    static void producer(String scenario) {
        Context.manager = new NotificationManager();
        Context context = new Context();
        ChatPushNotifications.receive(context, new RemoteMessage(payload(scenario.equals("producer-missing") ? null
            : scenario.equals("producer-malformed") ? "Fictional non-ID provider value" : OLD, OLD)));
        if (scenario.equals("producer-malformed")) check(Context.preferences.getString(TAG + ":notification", null) == null, "NON_UUID_NOT_PERSISTED");
        Notification display = Context.manager.getActiveNotifications()[0].getNotification();
        check("LETSCUBE".equals(display.title) && "\u041d\u043e\u0432\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435".equals(display.body), "GENERIC_DISPLAY");
        if (scenario.equals("producer-rotation-read-failed")) Context.preferences.failReads = true;
        ChatNotificationCleanup.Owner expected = owner();
        if (scenario.equals("producer-write-failed") || scenario.equals("producer-write-failed-same-message")) {
            Context.preferences.failNextCommit = true;
            String nextMessage = scenario.equals("producer-write-failed-same-message") ? OLD : NEW;
            ChatPushNotifications.receive(context, new RemoteMessage(payload(NEW, nextMessage)));
            check(OLD.equals(Context.manager.cards.get(TAG + ":0").getNotification().extras.getString(ChatNotificationCleanup.EXTRA_NOTIFICATION)), "UNPERSISTED_CARD_NOT_POSTED");
            check(OLD.equals(display.contentIntent.data.get("notification_id")), "OLD_TAP_RETAINED");
            check(Context.manager.cards.size() == 2, "UNTRACKED_GENERIC_DELIVERED");
            StatusBarNotification fallback = Context.manager.cards.values().stream().filter(card -> !TAG.equals(card.getTag())).findFirst().orElseThrow();
            check(fallback.getTag().startsWith(TAG + ":untracked:") && fallback.getNotification().extras.getInt(ChatNotificationCleanup.EXTRA_VERSION, 0) == 0,
                "UNTRACKED_WITHOUT_AUTHORITY");
            check("LETSCUBE".equals(fallback.getNotification().title)
                && "\u041d\u043e\u0432\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435".equals(fallback.getNotification().body), "UNTRACKED_GENERIC_ONLY");
            check(NEW.equals(fallback.getNotification().contentIntent.data.get("notification_id"))
                && nextMessage.equals(fallback.getNotification().contentIntent.data.get("message_id"))
                && fallback.getNotification().contentIntent.target.contains(nextMessage)
                && !fallback.getNotification().contentIntent.target.equals(display.contentIntent.target)
                && fallback.getNotification().contentIntent.target.equals("letscube://push/chat/" + CHAT + "/message/" + nextMessage
                    + "/untracked/" + fallback.getTag().substring((TAG + ":untracked:").length())), "UNTRACKED_EXACT_DISTINCT_TAP");
            check(ChatNotificationsPlugin.removeRead(context, Context.manager, expected, CHAT, reads()) == 0, "WRITE_FAILURE_NOT_AUTHORITY");
            return;
        }
        if (scenario.equals("producer-os-queued") || scenario.equals("producer-os-missing")) {
            List<Runnable> queue = new ArrayList<>();
            NotificationManager manager = new NotificationManager() {
                @Override public synchronized void notify(String tag, int id, Notification value) {
                    queue.add(() -> super.notify(tag, id, value));
                }
                @Override public synchronized void cancel(String tag, int id) { queue.add(() -> super.cancel(tag, id)); }
            };
            manager.cards.put(TAG + ":0", Context.manager.cards.get(TAG + ":0")); Context.manager = manager;
            boolean missing = scenario.equals("producer-os-missing");
            ChatPushNotifications.receive(context, new RemoteMessage(payload(missing ? null : NEW, NEW)));
            ChatNotificationsPlugin.removeRead(context, manager, expected, CHAT, reads());
            for (Runnable task : queue) task.run();
            String notification = manager.cards.size() == 1 ? manager.cards.get(TAG + ":0").getNotification().extras.getString(ChatNotificationCleanup.EXTRA_NOTIFICATION) : "absent";
            check(manager.cards.size() == 1 && (missing ? notification == null : NEW.equals(notification)),
                missing ? "OS_MISSING_INTENT_RETAINED" : "OS_QUEUED_REPLACEMENT_RETAINED");
            return;
        }
        if (scenario.equals("producer-serialized")) {
            CountDownLatch taken = new CountDownLatch(1), release = new CountDownLatch(1);
            NotificationManager manager = new NotificationManager() {
                @Override public StatusBarNotification[] getActiveNotifications() {
                    StatusBarNotification[] snapshot = super.getActiveNotifications();
                    taken.countDown(); await(release); return snapshot;
                }
            };
            manager.notify(TAG, 0, display); Context.manager = manager;
            AtomicReference<Throwable> error = new AtomicReference<>();
            Thread cleanup = new Thread(() -> { try { ChatNotificationsPlugin.removeRead(context, manager, expected, CHAT, reads()); } catch (Throwable fail) { error.set(fail); } });
            cleanup.start(); await(taken);
            Thread posting = new Thread(() -> ChatPushNotifications.receive(context, new RemoteMessage(payload(NEW, NEW))));
            posting.start(); contending(posting); release.countDown(); joined(cleanup); joined(posting);
            if (error.get() != null) throw new AssertionError(error.get());
            check(manager.cards.size() == 1 && NEW.equals(manager.cards.get(TAG + ":0").getNotification().extras.getString(ChatNotificationCleanup.EXTRA_NOTIFICATION)),
                "PRODUCER_REPLACEMENT_RETAINED");
            return;
        }
        if (scenario.equals("producer-newer")) ChatPushNotifications.receive(context, new RemoteMessage(payload(NEW, NEW)));
        if (scenario.equals("producer-process-restart")) {
            try {
                java.lang.reflect.Field posts = ChatNotificationCleanup.class.getDeclaredField("latestPosts"); posts.setAccessible(true);
                ((Map<?, ?>) posts.get(null)).clear();
                java.lang.reflect.Field generation = ChatNotificationCleanup.class.getDeclaredField("postGeneration"); generation.setAccessible(true); generation.setLong(null, 0);
            } catch (ReflectiveOperationException error) { throw new AssertionError(error); }
            Context.preferences.restore();
        }
        int count = ChatNotificationsPlugin.removeRead(context, Context.manager, expected, CHAT, reads());
        if (scenario.equals("producer-process-restart")) check(count == 1 && Context.manager.cards.isEmpty(), "COLD_OWN_CARD_REMOVED");
        else if (scenario.equals("producer-read") || scenario.equals("producer-rotation-read-failed")) check(count == 1 && Context.manager.cards.isEmpty(), "CONFIRMED_PRODUCER_CARD_REMOVED");
        else check(count == 0 && Context.manager.cards.size() == 1, "UNCONFIRMED_PRODUCER_CARD_RETAINED");
    }
    static JSObject binding(String instance, Number revision, Number epoch) {
        return new JSObject().put("instanceId", instance).put("revision", revision).put("ownerId", USER).put("accountEpoch", epoch);
    }
    static void plugin(String scenario) {
        ChatNotificationsPlugin plugin = new ChatNotificationsPlugin(); plugin.load();
        PluginCall cap = new PluginCall(new JSObject()); plugin.getCapabilities(cap);
        String instance = cap.result.getString("instanceId");
        PluginCall bind = new PluginCall(binding(instance, 1, scenario.equals("wire-fractional") ? 1.5 : 1)); plugin.setOwner(bind);
        if (scenario.equals("wire-fractional")) { check(Boolean.FALSE.equals(bind.result.opt("applied")), "FRACTIONAL_REFUSED"); return; }
        check(Boolean.TRUE.equals(bind.result.opt("applied")), "SMALL_JSON_INTEGER_BOUND");
        Context.manager = new NotificationManager();
        ChatPushNotifications.receive(new Context(), new RemoteMessage(payload(OLD, OLD)));
        JSArray pairs = new JSArray(); pairs.add(new JSObject().put("notificationId", OLD).put("messageId", OLD));
        JSObject request = binding(instance, 1, 1).put("chatId", CHAT).put("confirmed", pairs);
        if (scenario.equals("wire-reload")) plugin.getCapabilities(new PluginCall(new JSObject()));
        PluginCall remove = new PluginCall(request); plugin.removeRead(remove);
        if (scenario.equals("wire-reload")) check(Context.manager.cards.size() == 1, "DOCUMENT_LEASE_RETIRED");
        else check(Context.manager.cards.isEmpty() && Integer.valueOf(1).equals(remove.result.opt("removed")), "WIRE_READ_REMOVED");
    }
    public static void main(String[] args) {
        String scenario = args[0];
        if (scenario.startsWith("producer-")) producer(scenario);
        else if (scenario.startsWith("wire-")) plugin(scenario);
        else {
            ChatNotificationCleanup.Owner expected = owner();
            Store store = new Store();
            switch (scenario) {
                case "read": check(ChatNotificationCleanup.removeRead(expected, CHAT, reads(), store) == 1 && store.card == null, "READ_REMOVED"); break;
                case "newer":
                    store.setCard(card(NEW, OLD, 1, false, CHAT, TAG, 0));
                    check(ChatNotificationCleanup.removeRead(expected, CHAT, reads(), store) == 0 && store.card != null, "NEWER_RETAINED"); break;
                case "wrong-message": store.setCard(card(OLD, NEW, 1, false, CHAT, TAG, 0)); refusal(expected, store, "WRONG_MESSAGE_RETAINED"); break;
                case "missing-id": store.setCard(card(null, OLD, 1, false, CHAT, TAG, 0)); refusal(expected, store, "MISSING_ID_RETAINED"); break;
                case "legacy": store.setCard(card(OLD, OLD, 0, false, CHAT, TAG, 0)); refusal(expected, store, "LEGACY_RETAINED"); break;
                case "summary": store.setCard(card(OLD, OLD, 1, true, CHAT, TAG, 0)); refusal(expected, store, "SUMMARY_RETAINED"); break;
                case "voice": store.setCard(card(OLD, OLD, 1, false, CHAT, "voice:ring:" + CHAT, 0)); refusal(expected, store, "VOICE_RETAINED"); break;
                case "wrong-chat": store.setCard(card(OLD, OLD, 1, false, USER, TAG, 0)); refusal(expected, store, "WRONG_CHAT_RETAINED"); break;
                case "wrong-id": store.setCard(card(OLD, OLD, 1, false, CHAT, TAG, 9)); refusal(expected, store, "WRONG_ID_RETAINED"); break;
                case "invalid-read":
                    check(ChatNotificationCleanup.removeRead(expected, CHAT, List.of(new ChatNotificationCleanup.Read("broken", OLD)), store) == 0
                        && store.takes == 0, "INVALID_READ_REFUSED"); break;
                case "retry":
                    store.fail = true;
                    try { ChatNotificationCleanup.removeRead(expected, CHAT, reads(), store); throw new AssertionError("FAILURE_NOT_PROPAGATED"); }
                    catch (IllegalStateException expectedFailure) { }
                    store.fail = false;
                    check(ChatNotificationCleanup.removeRead(expected, CHAT, reads(), store) == 1, "RETRY_REMOVED"); break;
                case "retired":
                    ChatNotificationCleanup.bind(INSTANCE, 2, USER, 2);
                    check(ChatNotificationCleanup.removeRead(expected, CHAT, reads(), store) == 0 && store.takes == 0, "RETIRED_BEFORE_SNAPSHOT"); break;
                case "stale-binding":
                    ChatNotificationCleanup.bind(INSTANCE, 3, USER, 3);
                    check(!ChatNotificationCleanup.bind(INSTANCE, 2, USER, 2), "STALE_BINDING_REFUSED");
                    check(ChatNotificationCleanup.matches(INSTANCE, 3, USER, 3) != null, "LATEST_BINDING_RETAINED"); break;
                case "logout":
                    ChatNotificationCleanup.bind(INSTANCE, 2, null, 2);
                    check(ChatNotificationCleanup.removeRead(expected, CHAT, reads(), store) == 0, "LOGOUT_RETIRED"); break;
                case "replace-serialized":
                case "retire-during-take": {
                    boolean replacement = scenario.equals("replace-serialized");
                    if (replacement) { store.cancelling = new CountDownLatch(1); store.allowCancel = new CountDownLatch(1); }
                    else { store.taken = new CountDownLatch(1); store.release = new CountDownLatch(1); }
                    AtomicReference<Throwable> error = new AtomicReference<>();
                    Thread cleanup = new Thread(() -> { try { ChatNotificationCleanup.removeRead(expected, CHAT, reads(), store); } catch (Throwable fail) { error.set(fail); } });
                    cleanup.start(); await(replacement ? store.cancelling : store.taken);
                    Thread posting = null;
                    if (replacement) {
                        posting = new Thread(() -> store.setCard(card(NEW, NEW, 1, false, CHAT, TAG, 0)));
                        posting.start(); contending(posting);
                    } else ChatNotificationCleanup.bind(INSTANCE, 2, USER, 2);
                    (replacement ? store.allowCancel : store.release).countDown(); joined(cleanup); if (posting != null) joined(posting);
                    if (error.get() != null) throw new AssertionError(error.get());
                    if (scenario.equals("replace-serialized")) check(store.card != null && NEW.equals(store.card.notificationId), "REPLACEMENT_RETAINED");
                    else check(store.card != null && store.cancels == 0, "RETIRED_DURING_SNAPSHOT");
                    break;
                }
                default: throw new AssertionError("UNKNOWN_SCENARIO");
            }
        }
        System.out.println("PASS " + scenario);
    }
    static void refusal(ChatNotificationCleanup.Owner expected, Store store, String oracle) {
        check(ChatNotificationCleanup.removeRead(expected, CHAT, reads(), store) == 0 && store.card != null, oracle);
    }
}
