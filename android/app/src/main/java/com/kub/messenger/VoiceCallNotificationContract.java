package com.kub.messenger;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;

/** The data-only protocol. Parsing is not recipient authorization. */
final class VoiceCallNotificationContract {
    static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;
    static final String TAG_PREFIX = "letscube.voice:";
    static final String[] KEYS = {"protocol_version", "type", "event", "ring_key", "chat_id",
        "channel_id", "caller_id", "recipient_id", "recipient_session_id", "route", "ring_started_at", "expires_at"};
    private static final Pattern UUID = Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
    private static final Pattern DECIMAL = Pattern.compile("0|[1-9][0-9]{0,15}");

    static boolean isUuid(String value) { return value != null && UUID.matcher(value).matches(); }

    static boolean isRingKey(String value) {
        if (value == null || !value.startsWith("voice:") || value.length() < 44) return false;
        return isUuid(value.substring(6, 42)) && value.charAt(42) == ':' && millis(value.substring(43)) >= 0;
    }

    static boolean isReserved(Map<String, String> data) {
        return data != null && ("voice_call".equals(data.get("type")) || data.containsKey("ring_key")
            || data.containsKey("protocol_version") || data.containsKey("ring_started_at")
            || data.containsKey("recipient_session_id") || "ring".equals(data.get("event"))
            || "cancel".equals(data.get("event")));
    }

    static Event parse(Map<String, String> data, long now) {
        if (data == null || data.size() != KEYS.length || now < 0 || now > MAX_SAFE_INTEGER) return null;
        for (String key : KEYS) if (data.get(key) == null) return null;
        if (!"1".equals(data.get("protocol_version")) || !"voice_call".equals(data.get("type"))) return null;
        if (!"ring".equals(data.get("event")) && !"cancel".equals(data.get("event"))) return null;
        for (String key : new String[] {"chat_id", "channel_id", "caller_id", "recipient_id", "recipient_session_id"}) {
            if (!isUuid(data.get(key))) return null;
        }
        if (data.get("caller_id").equals(data.get("recipient_id"))) return null;
        long start = millis(data.get("ring_started_at")), expiry = millis(data.get("expires_at"));
        if (start < 0 || expiry < 0 || start > now || expiry <= now || expiry <= start || expiry - start > 45_000) return null;
        if (!data.get("ring_key").equals("voice:" + data.get("channel_id") + ":" + start)) return null;
        if (!data.get("route").equals("/chat/" + data.get("chat_id"))) return null;
        return new Event(data, start, expiry);
    }

    private static long millis(String value) {
        if (value == null || !DECIMAL.matcher(value).matches()) return -1;
        try {
            long result = Long.parseLong(value);
            return result <= MAX_SAFE_INTEGER ? result : -1;
        } catch (NumberFormatException ignored) {
            return -1;
        }
    }

    static String notificationTag(String ringKey) { return TAG_PREFIX + ringKey; }

    static final class Event {
        final String event, ringKey, recipientId, recipientSessionId;
        final long startedAt, expiresAt;
        private final Map<String, String> data;

        private Event(Map<String, String> values, long startedAt, long expiresAt) {
            this.data = Collections.unmodifiableMap(new LinkedHashMap<>(values));
            this.event = values.get("event");
            this.ringKey = values.get("ring_key");
            this.recipientId = values.get("recipient_id");
            this.recipientSessionId = values.get("recipient_session_id");
            this.startedAt = startedAt;
            this.expiresAt = expiresAt;
        }

        Map<String, String> toMap() { return data; }
        boolean matches(String user, String session) {
            return recipientId.equals(user) && recipientSessionId.equals(session);
        }
    }
}
