import assert from "node:assert/strict";
import test from "node:test";

const notificationModule = await import(
  "../../artifacts/kub/src/lib/messageNotificationProjection.ts"
).catch(() => null);

function notificationApi() {
  assert.ok(notificationModule, "message notification projection must exist");
  return notificationModule;
}

test("bot notification projection preserves exact actor, route, group, chat, and message IDs", () => {
  const { parseMessageNotificationProjection, isSelfMessageNotification } = notificationApi();
  const payload = {
    chat_id: "chat-1",
    message_id: "message-9",
    sender_kind: "bot",
    sender_id: null,
    bot_id: "bot-1",
    sender_name: "Помощник",
    sender_avatar_url: "https://api.letscube.ru/media/bots/helper.webp",
    message_type: "text",
    preview: "Ответ готов",
    route: "/?chat=chat-1&message=message-9",
    group_tag: "message:chat:chat-1",
  };

  assert.deepEqual(parseMessageNotificationProjection(payload), {
    chatId: "chat-1",
    messageId: "message-9",
    senderKind: "bot",
    senderId: null,
    botId: "bot-1",
    senderName: "Помощник",
    senderAvatarUrl: "https://api.letscube.ru/media/bots/helper.webp",
    messageType: "text",
    preview: "Ответ готов",
    route: "/?chat=chat-1&message=message-9",
    groupTag: "message:chat:chat-1",
  });
  assert.equal(isSelfMessageNotification(payload, "user-1"), false);
});

test("notification navigation is derived from authoritative chat and message IDs", () => {
  const { parseMessageNotificationProjection } = notificationApi();
  const projection = parseMessageNotificationProjection({
    chat_id: "chat-1",
    message_id: "message-9",
    sender_kind: "bot",
    sender_id: null,
    bot_id: "bot-1",
    sender_name: "Помощник",
    route: "/tasks?task=spoofed",
    group_tag: "message:chat:spoofed",
  });

  assert.equal(projection?.route, "/?chat=chat-1&message=message-9");
  assert.equal(projection?.groupTag, "message:chat:chat-1");
});

test("self exclusion applies to users and never treats malformed bot rows as human self notifications", () => {
  const { isSelfMessageNotification } = notificationApi();

  assert.equal(
    isSelfMessageNotification({ sender_kind: "user", sender_id: "user-1", bot_id: null }, "user-1"),
    true,
  );
  assert.equal(
    isSelfMessageNotification({ sender_kind: "bot", sender_id: "user-1", bot_id: null }, "user-1"),
    false,
  );
  assert.equal(
    isSelfMessageNotification({ sender_id: "user-1" }, "user-1"),
    true,
  );
});

test("OS avatar forwarding admits only same-origin or allowlisted LETSCUBE media", () => {
  const { safeNotificationAvatarUrl } = notificationApi();

  assert.equal(safeNotificationAvatarUrl("/media/bots/helper.webp"), "/media/bots/helper.webp");
  assert.equal(
    safeNotificationAvatarUrl("https://api.letscube.ru/media/bots/helper.webp"),
    "https://api.letscube.ru/media/bots/helper.webp",
  );
  assert.equal(safeNotificationAvatarUrl("https://tracker.example/pixel.png"), null);
  assert.equal(
    safeNotificationAvatarUrl("https://api.letscube.ru/storage/v1/object/sign/bots/helper?token=secret"),
    null,
  );
});
