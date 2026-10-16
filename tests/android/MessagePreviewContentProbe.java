package com.kub.messenger;

import java.lang.reflect.Method;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class MessagePreviewContentProbe {
    static final String USER = "11111111-1111-4111-8111-111111111111";
    static final String SESSION = "22222222-2222-4222-8222-222222222222";
    static final String DEVICE = "33333333-3333-4333-8333-333333333333";
    static final String NOTIFICATION = "44444444-4444-4444-8444-444444444444";
    static final String CHAT = "55555555-5555-4555-8555-555555555555";
    static final String MESSAGE = "66666666-6666-4666-8666-666666666666";
    static final long NOW = 1_792_108_800_000L;

    static void check(boolean value, String code) { if (!value) throw new AssertionError(code); }
    static Map<String,Object> row() {
        Map<String,Object> row = new HashMap<>();
        row.put("preview_v", 1); row.put("recipient_id", USER); row.put("session_id", SESSION);
        row.put("device_id", DEVICE); row.put("notification_id", NOTIFICATION);
        row.put("chat_id", CHAT); row.put("message_id", MESSAGE); row.put("preview_level", "message");
        row.put("sender_name", "Fictional Sender"); row.put("title", "Fictional Sender");
        row.put("body", "Fictional message"); row.put("expires_at", "2026-10-16T00:00:15+00:00");
        return row;
    }
    static Object parse(Object response, String level, long now) throws Exception {
        Class<?> type;
        try { type = Class.forName("com.kub.messenger.MessagePreviewContent"); }
        catch (ClassNotFoundException missing) { return null; }
        Method method = type.getDeclaredMethod("parse", Object.class, String.class, String.class,
            String.class, String.class, String.class, String.class, String.class, long.class);
        method.setAccessible(true);
        return method.invoke(null, response, USER, SESSION, DEVICE, NOTIFICATION, CHAT, MESSAGE, level, now);
    }
    static Object field(Object value, String name) throws Exception {
        var field = value.getClass().getDeclaredField(name); field.setAccessible(true); return field.get(value);
    }
    static void current() throws Exception {
        Object value = parse(List.of(row()), "message", NOW);
        check(value != null, "CURRENT_RECIPIENT_CONTENT_AVAILABLE");
        check("Fictional Sender".equals(field(value, "title")), "SENDER_TITLE");
        check("Fictional message".equals(field(value, "body")), "MESSAGE_BODY");
        check(Long.valueOf(1_792_108_815_000L).equals(field(value, "expiresAt")), "SERVER_EXPIRY");
    }
    static void refusal(String scenario) throws Exception {
        Map<String,Object> row = row();
        Object data = List.of(row); String maximum = "message"; long now = NOW;
        switch (scenario) {
            case "empty": data = List.of(); break;
            case "multiple": data = List.of(row, row); break;
            case "object": data = row; break;
            case "null": data = null; break;
            case "extra": row.put("unexpected", "Fictional"); break;
            case "missing": row.remove("body"); break;
            case "string-version": row.put("preview_v", "1"); break;
            case "version": row.put("preview_v", 2); break;
            case "owner": row.put("recipient_id", MESSAGE); break;
            case "session": row.put("session_id", MESSAGE); break;
            case "device": row.put("device_id", MESSAGE); break;
            case "notification": row.put("notification_id", MESSAGE); break;
            case "chat": row.put("chat_id", MESSAGE); break;
            case "message": row.put("message_id", CHAT); break;
            case "none": maximum = "none"; break;
            case "unknown-level": row.put("preview_level", "everything"); break;
            case "sender-escalation": maximum = "sender"; break;
            case "sender-leak": row.put("preview_level", "sender"); break;
            case "title-mismatch": row.put("title", "Different fictional sender"); break;
            case "title-long": row.put("sender_name", "A".repeat(97)); row.put("title", "A".repeat(97)); break;
            case "body-long": row.put("body", "A".repeat(241)); break;
            case "body-empty": row.put("body", ""); break;
            case "body-type": row.put("body", 123); break;
            case "body-leading": row.put("body", " Fictional"); break;
            case "body-control": row.put("body", "Fictional\nmessage"); break;
            case "body-bidi": row.put("body", "Fictional\u202emessage"); break;
            case "body-surrogate": row.put("body", "Fictional\ud800"); break;
            case "body-line": row.put("body", "Fictional\u2028message"); break;
            case "expired": now += 15_000; break;
            case "long-expiry": row.put("expires_at", "2026-10-16T00:00:15.001+00:00"); break;
            case "bad-expiry": row.put("expires_at", "tomorrow"); break;
            case "no-offset": row.put("expires_at", "2026-10-16T00:00:15"); break;
            case "bad-date": row.put("expires_at", "2026-02-30T00:00:15Z"); break;
            case "bad-hour": row.put("expires_at", "2026-10-16T24:00:15Z"); break;
            case "bad-offset": row.put("expires_at", "2026-10-16T00:00:15+24:00"); break;
            case "unsafe-clock": now = Long.MAX_VALUE; break;
            default: throw new AssertionError("UNKNOWN_SCENARIO");
        }
        check(parse(data, maximum, now) == null, "REFUSED_" + scenario);
    }
    public static void main(String[] args) throws Exception {
        String scenario = args[0];
        if (scenario.equals("current")) current();
        else if (scenario.equals("sender")) {
            Map<String,Object> row = row(); row.put("preview_level", "sender");
            row.put("body", "\u041d\u043e\u0432\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435");
            check(parse(List.of(row), "sender", NOW) != null, "SENDER_ONLY_ACCEPTED");
            check(parse(List.of(row), "message", NOW) != null, "SERVER_DOWNGRADE_ACCEPTED");
        } else if (scenario.equals("unicode")) {
            Map<String,Object> row = row(); row.put("body", "\ud83d\ude42".repeat(240));
            check(parse(List.of(row), "message", NOW) != null, "CODE_POINT_BOUND_MATCHES_DATABASE");
            row.put("sender_name", "A\u200dB"); row.put("title", "A\u200dB");
            check(parse(List.of(row), "message", NOW) != null, "JOINERS_ARE_NOT_BIDI_OVERRIDES");
        } else if (scenario.equals("offset-fraction")) {
            Map<String,Object> row = row(); row.put("expires_at", "2026-10-16T03:00:14.987654+03:00");
            Object value = parse(List.of(row), "message", NOW);
            check(value != null && Long.valueOf(1_792_108_814_987L).equals(field(value, "expiresAt")), "POSTGREST_OFFSET_MICROSECONDS");
            row.put("expires_at", "2026-10-16T00:00:15Z");
            check(parse(List.of(row), "message", NOW) != null, "UTC_Z_ACCEPTED");
        } else refusal(scenario);
        System.out.println("PASS " + args[0]);
    }
}
