package com.kub.messenger;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import java.util.HashMap;
import java.util.Map;
import org.junit.Test;

public class ChatPushNotificationContractTest {
    private Map<String, String> message() {
        Map<String, String> data = new HashMap<>();
        data.put("native_chat_v", "1");
        data.put("type", "message");
        data.put("chat_id", "6f9f45a8-1de9-475e-82df-d16e39b9df7b");
        data.put("message_id", "4e3468a1-61d3-4c70-b67d-3d8f045b87bf");
        data.put("tag", "message:chat:6f9f45a8-1de9-475e-82df-d16e39b9df7b");
        data.put("group_tag", "message:chat:6f9f45a8-1de9-475e-82df-d16e39b9df7b");
        data.put("title", "Sender");
        data.put("body", "Message");
        return data;
    }

    @Test public void derivesExactRouteAndStableChatTag() {
        ChatPushNotificationContract.Event event = ChatPushNotificationContract.parse(message());
        assertNotNull(event);
        assertEquals("/?chat=6f9f45a8-1de9-475e-82df-d16e39b9df7b&message=4e3468a1-61d3-4c70-b67d-3d8f045b87bf", event.route);
        assertEquals("message:chat:6f9f45a8-1de9-475e-82df-d16e39b9df7b", event.tag);
        assertEquals("LETSCUBE", event.title);
        assertEquals("\u041d\u043e\u0432\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435", event.body);
    }

    @Test public void rejectsMismatchedTagAndMissingMessage() {
        Map<String, String> data = message();
        data.put("tag", "message:chat:other");
        assertNull(ChatPushNotificationContract.parse(data));
        data = message();
        data.remove("message_id");
        assertNull(ChatPushNotificationContract.parse(data));
    }

    @Test public void sensitiveDisplayTextFallsBackWithoutLosingRoute() {
        Map<String, String> data = message();
        data.put("title", "Synthetic private sender");
        data.put("body", "https://fixture.invalid/storage/v1/object/sign/item?token=synthetic");
        ChatPushNotificationContract.Event event = ChatPushNotificationContract.parse(data);
        assertNotNull(event);
        assertEquals("LETSCUBE", event.title);
        assertEquals("\u041d\u043e\u0432\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435", event.body);
        assertEquals("/?chat=6f9f45a8-1de9-475e-82df-d16e39b9df7b&message=4e3468a1-61d3-4c70-b67d-3d8f045b87bf", event.route);
    }

    @Test public void absentBlankAndOverlongDisplayTextStillProduceGenericEvents() {
        for (String field : new String[] {"title", "body"}) {
            Map<String, String> absent = message();
            absent.remove(field);
            assertNotNull(ChatPushNotificationContract.parse(absent));
            for (String value : new String[] {null, "", " \r\n", new String(new char[181]).replace('\0', 'x')}) {
                Map<String, String> data = message();
                data.put(field, value);
                ChatPushNotificationContract.Event event = ChatPushNotificationContract.parse(data);
                assertNotNull(event);
                assertEquals("LETSCUBE", event.title);
                assertEquals("\u041d\u043e\u0432\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435", event.body);
            }
        }
    }
}
