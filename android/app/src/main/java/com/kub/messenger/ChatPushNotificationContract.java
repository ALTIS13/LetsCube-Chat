package com.kub.messenger;

import java.util.Map;
import java.util.regex.Pattern;

/** Display projection for the versioned Android chat data-only payload. */
final class ChatPushNotificationContract {
    private static final Pattern UUID = Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");

    static boolean isReserved(Map<String, String> data) {
        return data != null && data.containsKey("native_chat_v");
    }

    static Event parse(Map<String, String> data) {
        if (data == null || !"1".equals(data.get("native_chat_v")) || !"message".equals(data.get("type"))) return null;
        String chatId = data.get("chat_id"), messageId = data.get("message_id");
        if (!isUuid(chatId) || !isUuid(messageId)) return null;
        String tag = "message:chat:" + chatId;
        if (!tag.equals(data.get("tag")) || !tag.equals(data.get("group_tag"))) return null;
        // v1 is a generic wake signal, not a recipient-authenticated preview.
        return new Event(chatId, messageId, tag, "/?chat=" + chatId + "&message=" + messageId,
            "LETSCUBE", "\u041d\u043e\u0432\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435");
    }

    private static boolean isUuid(String value) { return value != null && UUID.matcher(value).matches(); }

    static final class Event {
        final String chatId, messageId, tag, route, title, body;
        Event(String chatId, String messageId, String tag, String route, String title, String body) {
            this.chatId = chatId;
            this.messageId = messageId;
            this.tag = tag;
            this.route = route;
            this.title = title;
            this.body = body;
        }
    }
}
