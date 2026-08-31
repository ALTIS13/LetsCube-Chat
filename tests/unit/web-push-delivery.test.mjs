import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDeclarativeWebPushPayload,
  createWebPushTopic,
  getWebPushUrgency,
  isPermanentWebPushSubscriptionError,
  readWebPushErrorReason,
} from "../../supabase/functions/send-push-notifications/webpush.ts";

const messagePayload = {
  title: "CodexTest",
  body: "Привет",
  url: "/?chat=chat-1&message=message-1",
  tag: "message:chat:chat-1",
  kind: "message",
  chatId: "chat-1",
  messageId: "message-1",
  senderKind: "bot",
  senderId: "",
  botId: "bot-1",
  senderName: "Помощник",
  senderAvatarUrl: "https://api.letscube.ru/media/bots/helper.webp",
  messageType: "text",
  preview: "Привет",
  groupTag: "message:chat:chat-1",
  renotify: false,
};

test("additive bot fields do not change the existing declarative PWA presentation", () => {
  const result = buildDeclarativeWebPushPayload(
    messagePayload,
    "https://app.letscube.ru",
  );

  assert.equal(result.title, "CodexTest");
  assert.equal(result.chatId, "chat-1");
  assert.equal(result.web_push, 8030);
  assert.deepEqual(result.notification, {
    title: "CodexTest",
    body: "Привет",
    navigate: "https://app.letscube.ru/?chat=chat-1&message=message-1",
    tag: "message:chat:chat-1",
  });
  assert.equal(result.senderKind, "bot");
  assert.equal(result.botId, "bot-1");
});

test("declarative web push is omitted when the configured app origin is unsafe", () => {
  const result = buildDeclarativeWebPushPayload(
    messagePayload,
    "http://localhost:5173",
  );

  assert.equal("web_push" in result, false);
  assert.equal("notification" in result, false);
  assert.equal(result.title, "CodexTest");
});

test("web push topics collapse only the same semantic tag", async () => {
  const first = await createWebPushTopic("message:chat:chat-1");
  const same = await createWebPushTopic("message:chat:chat-1");
  const otherChat = await createWebPushTopic("message:chat:chat-2");
  const task = await createWebPushTopic("task:task-1");

  assert.match(first ?? "", /^[A-Za-z0-9_-]{32}$/);
  assert.equal(first, same);
  assert.notEqual(first, otherChat);
  assert.notEqual(first, task);
  assert.equal(await createWebPushTopic("kub-notification"), null);
});

test("operational notifications request immediate delivery without merging categories", () => {
  assert.equal(getWebPushUrgency("message"), "high");
  assert.equal(getWebPushUrgency("task_assigned"), "high");
  assert.equal(getWebPushUrgency("group_invite"), "high");
  assert.equal(getWebPushUrgency("system"), "normal");
});

test("Apple VAPID key mismatch prunes only the unusable subscription", () => {
  const error = {
    statusCode: 403,
    body: JSON.stringify({ reason: "VapidPkHashMismatch" }),
  };

  assert.equal(readWebPushErrorReason(error), "VapidPkHashMismatch");
  assert.equal(
    isPermanentWebPushSubscriptionError(403, "VapidPkHashMismatch"),
    true,
  );
  assert.equal(isPermanentWebPushSubscriptionError(403, "BadJwtToken"), false);
  assert.equal(isPermanentWebPushSubscriptionError(410, null), true);
  assert.equal(
    isPermanentWebPushSubscriptionError(429, "TooManyRequests"),
    false,
  );
});
