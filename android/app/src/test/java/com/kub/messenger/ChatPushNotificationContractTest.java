package com.kub.messenger;

import static org.junit.Assert.assertEquals;
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
        assertEquals("/?chat=6f9f45a8-1de9-475e-82df-d16e39b9df7b&message=4e3468a1-61d3-4c70-b67d-3d8f045b87bf", event.route);
        assertEquals("message:chat:6f9f45a8-1de9-475e-82df-d16e39b9df7b", event.tag);
    }

    @Test public void rejectsMismatchedTagAndMissingMessage() {
        Map<String, String> data = message();
        data.put("tag", "message:chat:other");
        assertNull(ChatPushNotificationContract.parse(data));
        data = message();
        data.remove("message_id");
        assertNull(ChatPushNotificationContract.parse(data));
    }

    @Test public void rejectsSensitiveDisplayText() {
        Map<String, String> data = message();
        data.put("body", "https://core.letscube.ru/storage/v1/object/sign/photo?token=secret");
        assertNull(ChatPushNotificationContract.parse(data));
    }
}
