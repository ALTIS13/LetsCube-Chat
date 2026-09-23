import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFcmMessage,
  isPermanentFcmTokenError,
} from "../../supabase/functions/send-push-notifications/fcm.ts";

test("legacy Android message payload retains the messages channel and OS chat tag", () => {
  const result = buildFcmMessage(
    {
      title: "CodexTest",
      body: "Привет",
      kind: "message",
      tag: "message:chat:chat-1",
      chatId: "chat-1",
      messageId: "message-1",
      notificationId: "notification-1",
      url: "/?chat=chat-1&message=message-1",
    },
    "device-token",
  );

  assert.equal(result.message.token, "device-token");
  assert.equal(result.message.android.notification.channel_id, "messages");
  assert.equal(result.message.android.priority, "HIGH");
  // FCM ignores collapse_key for notification messages; this only documents
  // the legacy payload. The Android tag groups cards after delivery.
  assert.equal(result.message.android.collapse_key, "message:chat:chat-1");
  assert.equal(result.message.notification.title, "CodexTest");
  assert.equal(result.message.notification.body, "Привет");
  assert.deepEqual(result.message.data, {
    type: "message",
    route: "/?chat=chat-1&message=message-1",
    chat_id: "chat-1",
    message_id: "message-1",
    notification_id: "notification-1",
    tag: "message:chat:chat-1",
    group_tag: "message:chat:chat-1",
  });
});

test("new Android clients receive non-collapsible chat data with native display fields", () => {
  const payload = {
    title: "CodexTest",
    body: "Привет",
    kind: "message",
    chatId: "chat-1",
    messageId: "message-1",
    tag: "message:chat:chat-1",
    url: "/?chat=chat-1&message=message-1",
  };
  const current = buildFcmMessage(payload, "device-token", "0.1.8").message;
  assert.equal("notification" in current, false);
  assert.equal("collapse_key" in current.android, false);
  assert.equal("notification" in current.android, false);
  assert.equal(current.android.priority, "HIGH");
  assert.equal(current.data.title, "CodexTest");
  assert.equal(current.data.body, "Привет");
  assert.equal(current.data.native_chat_v, "1");
  assert.equal(current.data.chat_id, "chat-1");
  assert.equal(current.data.message_id, "message-1");

  const old = buildFcmMessage(payload, "device-token", "0.1.7").message;
  assert.equal(old.notification.title, "CodexTest");
  assert.equal(old.android.notification.tag, "message:chat:chat-1");
  assert.equal(old.android.collapse_key, "message:chat:chat-1");
  assert.equal(buildFcmMessage(payload, "device-token", "invalid").message.notification.title, "CodexTest");
  const task = buildFcmMessage({ kind: "task_assigned", title: "Задача" }, "device-token", "0.1.8").message;
  assert.equal(task.notification.title, "Задача");
});

test("task FCM delivery stays separate from message grouping", () => {
  const result = buildFcmMessage(
    {
      title: "LETSCUBE",
      body: "Назначена задача",
      kind: "task_assigned",
      tag: "task:task-1",
      taskId: "task-1",
      url: "/tasks?task=task-1",
    },
    "device-token",
  );

  assert.equal(result.message.android.notification.channel_id, "tasks");
  assert.equal(result.message.android.priority, "HIGH");
  assert.equal(result.message.android.collapse_key, "task:task-1");
  assert.equal(result.message.data.type, "task");
  assert.equal(result.message.data.task_id, "task-1");
});

test("routine system FCM delivery keeps normal priority", () => {
  const result = buildFcmMessage({ kind: "system_update", title: "LETSCUBE" }, "device-token");
  assert.equal(result.message.android.priority, "NORMAL");
});

test("FCM payload never exposes raw media or signed URLs", () => {
  const result = buildFcmMessage(
    {
      title: "LETSCUBE",
      body: "https://core.letscube.ru/storage/v1/object/sign/private/photo.jpg?token=secret",
      kind: "message",
      chatId: "chat-1",
      url: "/?chat=chat-1",
    },
    "device-token",
  );

  assert.equal(result.message.notification.body, "Новое уведомление");
  assert.equal(result.message.data.route, "/?chat=chat-1");
  const native = buildFcmMessage({
    title: "LETSCUBE",
    body: "https://core.letscube.ru/storage/v1/object/sign/private/photo.jpg?token=secret",
    kind: "message",
    chatId: "chat-1",
    messageId: "message-1",
  }, "device-token", "0.1.8");
  assert.equal(native.message.data.body, "Новое уведомление");
});

test("FCM bot message preserves actor identity, grouping, route, and trusted avatar", () => {
  const result = buildFcmMessage(
    {
      title: "Помощник",
      body: "Готово",
      kind: "message",
      chatId: "chat-1",
      messageId: "message-1",
      senderKind: "bot",
      senderId: "must-not-leak",
      botId: "bot-1",
      senderName: "Помощник",
      senderAvatarUrl: "/media/bots/helper.webp",
      messageType: "text",
      preview: "Готово",
      url: "/?chat=chat-1&message=message-1",
    },
    "device-token",
  );

  assert.equal(result.message.android.collapse_key, "message:chat:chat-1");
  assert.equal(result.message.notification.image, "https://app.letscube.ru/media/bots/helper.webp");
  assert.equal(result.message.android.notification.image, "https://app.letscube.ru/media/bots/helper.webp");
  assert.deepEqual(result.message.data, {
    type: "message",
    route: "/?chat=chat-1&message=message-1",
    chat_id: "chat-1",
    message_id: "message-1",
    tag: "message:chat:chat-1",
    sender_kind: "bot",
    bot_id: "bot-1",
    sender_name: "Помощник",
    sender_avatar_url: "https://app.letscube.ru/media/bots/helper.webp",
    kub_message_type: "text",
    preview: "Готово",
    group_tag: "message:chat:chat-1",
  });
});

test("FCM bot avatar rejects external and signed media URLs", () => {
  for (const senderAvatarUrl of [
    "https://evil.example/bot.webp",
    "https://api.letscube.ru/storage/v1/object/sign/bots/helper.webp?token=secret",
  ]) {
    const result = buildFcmMessage(
      {
        kind: "message",
        chatId: "chat-1",
        botId: "bot-1",
        senderKind: "bot",
        senderAvatarUrl,
      },
      "device-token",
    );
    assert.equal("image" in result.message.notification, false);
    assert.equal("image" in result.message.android.notification, false);
    assert.equal("sender_avatar_url" in result.message.data, false);
  }
});

test("only permanent FCM token errors prune a device", () => {
  assert.equal(isPermanentFcmTokenError(404, { error: { status: "NOT_FOUND" } }), false);
  assert.equal(
    isPermanentFcmTokenError(404, {
      error: {
        details: [
          {
            "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
            errorCode: "UNREGISTERED",
          },
        ],
      },
    }),
    true,
  );
  assert.equal(
    isPermanentFcmTokenError(400, {
      error: {
        details: [
          {
            "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
            errorCode: "INVALID_ARGUMENT",
          },
        ],
      },
    }),
    true,
  );
  assert.equal(
    isPermanentFcmTokenError(400, {
      error: {
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.BadRequest",
            errorCode: "INVALID_ARGUMENT",
          },
        ],
      },
    }),
    false,
  );
  assert.equal(
    isPermanentFcmTokenError(400, {
      error: {
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.BadRequest",
            fieldViolations: [{ field: "message.data" }],
          },
          {
            "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
            errorCode: "INVALID_ARGUMENT",
          },
        ],
      },
    }),
    false,
  );
  assert.equal(isPermanentFcmTokenError(401, { error: { status: "UNAUTHENTICATED" } }), false);
  assert.equal(isPermanentFcmTokenError(500, { error: { status: "INTERNAL" } }), false);
});
