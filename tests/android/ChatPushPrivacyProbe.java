package com.kub.messenger;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;

/** Offline behavioral oracle for the actual v1 parser, without Android runtime. */
public final class ChatPushPrivacyProbe {
    private static Map<String, String> message() {
        Map<String, String> data = new HashMap<>();
        data.put("native_chat_v", "1");
        data.put("type", "message");
        data.put("chat_id", "6f9f45a8-1de9-475e-82df-d16e39b9df7b");
        data.put("message_id", "4e3468a1-61d3-4c70-b67d-3d8f045b87bf");
        data.put("tag", "message:chat:6f9f45a8-1de9-475e-82df-d16e39b9df7b");
        data.put("group_tag", "message:chat:6f9f45a8-1de9-475e-82df-d16e39b9df7b");
        data.put("title", "Synthetic sender");
        data.put("body", "Synthetic private preview");
        return data;
    }

    private static void require(boolean condition, String oracle) {
        if (!condition) throw new AssertionError(oracle);
    }

    private static ChatPushNotificationContract.Event accepted(Map<String, String> data) {
        ChatPushNotificationContract.Event event = ChatPushNotificationContract.parse(data);
        require(event != null, "ROUTING_ACCEPTED");
        require("6f9f45a8-1de9-475e-82df-d16e39b9df7b".equals(event.chatId), "CHAT_ID_EXACT");
        require("4e3468a1-61d3-4c70-b67d-3d8f045b87bf".equals(event.messageId), "MESSAGE_ID_EXACT");
        require("message:chat:6f9f45a8-1de9-475e-82df-d16e39b9df7b".equals(event.tag), "TAG_EXACT");
        require("/?chat=6f9f45a8-1de9-475e-82df-d16e39b9df7b&message=4e3468a1-61d3-4c70-b67d-3d8f045b87bf".equals(event.route), "ROUTE_EXACT");
        return event;
    }

    private static void generic(Map<String, String> data) {
        ChatPushNotificationContract.Event event = accepted(data);
        require("LETSCUBE".equals(event.title), "TITLE_GENERIC");
        require("\u041d\u043e\u0432\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435".equals(event.body), "BODY_GENERIC");
    }

    private static void refused(String field, String oracle, String... invalid) {
        for (String value : invalid) {
            Map<String, String> data = message();
            data.put(field, value);
            // Keep both tags internally consistent so they cannot mask a missing UUID guard.
            if ("chat_id".equals(field) && value != null) {
                data.put("tag", "message:chat:" + value);
                data.put("group_tag", "message:chat:" + value);
            }
            require(ChatPushNotificationContract.parse(data) == null, oracle);
        }
        Map<String, String> absent = message();
        absent.remove(field);
        require(ChatPushNotificationContract.parse(absent) == null, oracle);
    }

    public static void main(String[] args) throws Exception {
        require(args.length == 1, "CASE_REQUIRED");
        switch (args[0]) {
            case "title":
                require("LETSCUBE".equals(accepted(message()).title), "TITLE_GENERIC");
                break;
            case "body":
                require("\u041d\u043e\u0432\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435".equals(accepted(message()).body), "BODY_GENERIC");
                break;
            case "fallback":
                for (String field : new String[] {"title", "body"}) {
                    Map<String, String> absent = message();
                    absent.remove(field);
                    generic(absent);
                    for (String value : new String[] {null, "", " \t\r\n", "x".repeat(181),
                        "https://fixture.invalid/storage/v1/object/sign/item?token=synthetic",
                        "PASSWORD=synthetic", "Authorization=synthetic", "signedUrl=synthetic"}) {
                        Map<String, String> data = message();
                        data.put(field, value);
                        generic(data);
                    }
                }
                Map<String, String> absent = message();
                absent.remove("title");
                absent.remove("body");
                generic(absent);
                break;
            case "private-fields":
                Map<String, String> data = message();
                for (String field : new String[] {"recipient_id", "recipient_session_id", "account_id",
                    "sender_id", "sender_name", "sender_avatar_url", "preview", "token", "authorization"}) {
                    data.put(field, "synthetic-private-" + field);
                }
                generic(data);
                HashSet<String> fields = new HashSet<>();
                for (Field field : accepted(data).getClass().getDeclaredFields()) {
                    if (!Modifier.isStatic(field.getModifiers())) fields.add(field.getName());
                }
                require(fields.equals(new HashSet<>(Arrays.asList("chatId", "messageId", "tag", "route", "title", "body"))), "EVENT_NO_PRIVATE_FIELDS");
                break;
            case "route":
                Map<String, String> routing = message();
                routing.put("route", "https://fixture.invalid/?account=synthetic");
                routing.put("url", "/?chat=other&message=other");
                routing.put("group", "provider-group");
                accepted(routing);
                break;
            case "version":
                refused("native_chat_v", "VERSION_REFUSED", "2", "0", "01", "1 ", "", null);
                break;
            case "tag":
                refused("tag", "TAG_REFUSED", "message:chat:other", "message:chat:6f9f45a8-1de9-475e-82df-d16e39b9df7b ", "", null);
                break;
            case "group":
                refused("group_tag", "GROUP_REFUSED", "message:chat:other", "message:chat:6f9f45a8-1de9-475e-82df-d16e39b9df7b ", "", null);
                break;
            case "type":
                refused("type", "TYPE_REFUSED", "voice", "MESSAGE", "message ", "", null);
                break;
            case "chat-id":
                refused("chat_id", "CHAT_UUID_REFUSED", "not-a-uuid", "6F9F45A8-1DE9-475E-82DF-D16E39B9DF7B", "6f9f45a8-1de9-475e-82df-d16e39b9df7b&account=synthetic", "", null);
                break;
            case "message-id":
                refused("message_id", "MESSAGE_UUID_REFUSED", "not-a-uuid", "4E3468A1-61D3-4C70-B67D-3D8F045B87BF", "4e3468a1-61d3-4c70-b67d-3d8f045b87bf ", "", null);
                break;
            case "reserved":
                require(!ChatPushNotificationContract.isReserved(null), "NULL_NOT_RESERVED");
                require(!ChatPushNotificationContract.isReserved(new HashMap<>()), "ABSENT_NOT_RESERVED");
                Map<String, String> future = message();
                future.put("native_chat_v", "2");
                require(ChatPushNotificationContract.isReserved(future), "FUTURE_STILL_RESERVED");
                break;
            case "null":
                require(ChatPushNotificationContract.parse(null) == null, "NULL_REFUSED");
                break;
            default:
                throw new AssertionError("UNKNOWN_CASE");
        }
        System.out.println("PASS " + args[0]);
    }
}
