package com.kub.messenger;

import java.text.ParsePosition;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Recipient RPC projection only. This value is not persistent display authority. */
final class MessagePreviewContent {
    private static final Set<String> KEYS = Collections.unmodifiableSet(new HashSet<>(Arrays.asList("preview_v", "recipient_id", "session_id", "device_id",
        "notification_id", "chat_id", "message_id", "preview_level", "sender_name", "title", "body", "expires_at")));
    private static final Pattern TIMESTAMP = Pattern.compile("([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(?:\\.([0-9]{1,9}))?(Z|[+-](?:0[0-9]|1[0-8]):[0-5][0-9])");
    private static final String GENERIC = "\u041d\u043e\u0432\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435";
    final String title, body, level;
    final String recipient, notification, chat, message;
    final long expiresAt;

    private MessagePreviewContent(String title, String body, String level, long expiresAt,
            String recipient, String notification, String chat, String message) {
        this.title = title; this.body = body; this.level = level; this.expiresAt = expiresAt;
        this.recipient = recipient; this.notification = notification; this.chat = chat; this.message = message;
    }

    static MessagePreviewContent parse(Object data, String recipient, String session, String device,
            String notification, String chat, String message, String maximumLevel, long now) {
        if (now < 0 || now > 9007199254725991L || !("sender".equals(maximumLevel) || "message".equals(maximumLevel))
            || !uuid(recipient) || !uuid(session) || !uuid(device) || !uuid(notification) || !uuid(chat) || !uuid(message)
            || !(data instanceof List) || ((List<?>) data).size() != 1 || !(((List<?>) data).get(0) instanceof Map)) return null;
        Map<?,?> row = (Map<?,?>) ((List<?>) data).get(0);
        if (!row.keySet().equals(KEYS) || !(row.get("preview_v") instanceof Number)
            || ((Number) row.get("preview_v")).doubleValue() != 1d
            || !recipient.equals(row.get("recipient_id")) || !session.equals(row.get("session_id"))
            || !device.equals(row.get("device_id")) || !notification.equals(row.get("notification_id"))
            || !chat.equals(row.get("chat_id")) || !message.equals(row.get("message_id"))) return null;
        Object level = row.get("preview_level"), title = row.get("title"), sender = row.get("sender_name"), body = row.get("body");
        if (!("sender".equals(level) || "message".equals(level)) || ("sender".equals(maximumLevel) && !"sender".equals(level))
            || !displayText(title, 96) || !title.equals(sender) || !displayText(body, 240)
            || ("sender".equals(level) && !GENERIC.equals(body)) || !(row.get("expires_at") instanceof String)) return null;
        try {
            String expiryText = (String) row.get("expires_at");
            if (expiryText.length() > 40) return null;
            Long parsed = expiry(expiryText);
            if (parsed == null) return null;
            long expiry = parsed;
            if (expiry <= now || expiry > now + 15_000) return null;
            return new MessagePreviewContent((String) title, (String) body, (String) level, expiry,
                recipient, notification, chat, message);
        } catch (RuntimeException refused) { return null; }
    }

    static boolean uuid(String value) { return value != null && value.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"); }

    private static Long expiry(String value) {
        Matcher match = TIMESTAMP.matcher(value);
        if (!match.matches()) return null;
        String fraction = match.group(2);
        String normalized = match.group(1) + "." + ((fraction == null ? "" : fraction) + "000").substring(0, 3) + match.group(3);
        // java.time requires API26; this parser must also run on the supported API24.
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.ROOT);
        format.setLenient(false); format.setTimeZone(TimeZone.getTimeZone("UTC"));
        ParsePosition position = new ParsePosition(0);
        Date parsed = format.parse(normalized, position);
        return parsed != null && position.getIndex() == normalized.length() ? parsed.getTime() : null;
    }

    private static boolean displayText(Object value, int maximum) {
        if (!(value instanceof String)) return false;
        String text = (String) value;
        if (text.isEmpty() || text.codePointCount(0, text.length()) > maximum
            || text.codePointAt(0) <= 32 || text.codePointBefore(text.length()) <= 32) return false;
        for (int offset = 0; offset < text.length();) {
            int point = text.codePointAt(offset);
            if (Character.isISOControl(point) || (point >= 0xd800 && point <= 0xdfff)
                || point == 0x2028 || point == 0x2029 || (point >= 0x202a && point <= 0x202e)
                || (point >= 0x2066 && point <= 0x2069)) return false;
            offset += Character.charCount(point);
        }
        return true;
    }
}
