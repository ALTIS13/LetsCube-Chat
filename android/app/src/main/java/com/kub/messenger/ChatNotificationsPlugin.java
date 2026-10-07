package com.kub.messenger;

import android.app.Notification;
import android.app.NotificationManager;
import android.os.Bundle;
import android.service.notification.StatusBarNotification;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.json.JSONObject;

@CapacitorPlugin(name = "ChatNotifications")
public class ChatNotificationsPlugin extends Plugin {
    private volatile String instanceId = UUID.randomUUID().toString();

    @Override public void load() { ChatNotificationCleanup.activate(instanceId); }
    @Override protected void handleOnDestroy() { ChatNotificationCleanup.deactivate(instanceId); }

    @PluginMethod public void getCapabilities(PluginCall call) {
        // Negotiating a new document retires old queued bridge invocations.
        instanceId = UUID.randomUUID().toString();
        ChatNotificationCleanup.activate(instanceId);
        call.resolve(new JSObject().put("protocol", 1).put("instanceId", instanceId));
    }

    @PluginMethod public void setOwner(PluginCall call) {
        String instance = call.getString("instanceId"), ownerId = call.getString("ownerId");
        Long revision = integer(call, "revision"), epoch = integer(call, "accountEpoch");
        boolean applied = instanceId.equals(instance) && revision != null && epoch != null
            && ChatNotificationCleanup.bind(instance, revision, ownerId, epoch);
        call.resolve(new JSObject().put("applied", applied).put("instanceId", instance)
            .put("revision", revision).put("ownerId", ownerId == null ? JSONObject.NULL : ownerId).put("accountEpoch", epoch));
    }

    @PluginMethod public void removeRead(PluginCall call) {
        String instance = call.getString("instanceId"), ownerId = call.getString("ownerId"), chatId = call.getString("chatId");
        Long revision = integer(call, "revision"), epoch = integer(call, "accountEpoch");
        JSArray input = call.getArray("confirmed");
        if (!instanceId.equals(instance) || revision == null || epoch == null || input == null
            || input.length() < 1 || input.length() > 30) { call.resolve(new JSObject().put("removed", 0)); return; }
        List<ChatNotificationCleanup.Read> reads = new ArrayList<>();
        try {
            for (int index = 0; index < input.length(); index++) {
                JSONObject read = input.getJSONObject(index);
                reads.add(new ChatNotificationCleanup.Read(read.getString("notificationId"), read.getString("messageId")));
            }
        } catch (Exception invalid) { call.resolve(new JSObject().put("removed", 0)); return; }
        ChatNotificationCleanup.Owner expected = ChatNotificationCleanup.matches(instance, revision, ownerId, epoch);
        try {
            call.resolve(new JSObject().put("removed", removeRead(getContext(), getContext().getSystemService(NotificationManager.class), expected, chatId, reads)));
        } catch (RuntimeException failed) { call.reject("Message card cleanup unavailable", "CHAT_CLEANUP"); }
    }

    private static Long integer(PluginCall call, String key) {
        // Capacitor getLong refuses JSON's small Integer values, including epoch 1.
        Object value = call.getData().opt(key);
        if (!(value instanceof Number)) return null;
        double number = ((Number) value).doubleValue();
        return Double.isFinite(number) && number >= 0 && number <= 9007199254740991d && number == Math.rint(number)
            ? ((Number) value).longValue() : null;
    }

    static int removeRead(android.content.Context context, NotificationManager manager, ChatNotificationCleanup.Owner expected, String chatId,
        List<ChatNotificationCleanup.Read> reads) {
        if (manager == null) return 0;
        return ChatNotificationCleanup.removeRead(expected, chatId, reads, new ChatNotificationCleanup.Cards() {
            @Override public ChatNotificationCleanup.IntentStore intents() { return new ChatNotificationIntentStore(context); }
            @Override public List<ChatNotificationCleanup.Card> active() {
                List<ChatNotificationCleanup.Card> result = new ArrayList<>();
                for (StatusBarNotification entry : manager.getActiveNotifications()) {
                    Notification notification = entry.getNotification();
                    Bundle extras = notification.extras;
                    if (extras == null) continue;
                    result.add(new ChatNotificationCleanup.Card(entry.getTag(), entry.getId(),
                        (notification.flags & Notification.FLAG_GROUP_SUMMARY) != 0,
                        extras.getInt(ChatNotificationCleanup.EXTRA_VERSION, 0), extras.getString(ChatNotificationCleanup.EXTRA_CHAT),
                        extras.getString(ChatNotificationCleanup.EXTRA_NOTIFICATION), extras.getString(ChatNotificationCleanup.EXTRA_MESSAGE),
                        extras.getLong(ChatNotificationCleanup.EXTRA_GENERATION, 0)));
                }
                return result;
            }
            @Override public void cancel(String tag, int id) { manager.cancel(tag, id); }
        });
    }
}
