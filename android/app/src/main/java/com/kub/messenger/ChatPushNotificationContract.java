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
        String title = clean(data.get("title"), 80), body = clean(data.get("body"), 180);
        if (title == null || body == null) return null;
        return new Event(chatId, messageId, tag, "/?chat=" + chatId + "&message=" + messageId, title, body);
    }

    private static boolean isUuid(String value) { return value != null && UUID.matcher(value).matches(); }

    private static String clean(String value, int limit) {
        if (value == null || value.isEmpty() || value.length() > limit || value.trim().isEmpty()) return null;
        String lower = value.toLowerCase(java.util.Locale.ROOT);
        if (lower.contains("/storage/v1/") || lower.contains("/object/sign/") || lower.contains("token=")
            || lower.contains("password=") || lower.contains("authorization=") || lower.contains("signedurl")) return null;
        return value.replace('\n', ' ').replace('\r', ' ').trim();
    }

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
