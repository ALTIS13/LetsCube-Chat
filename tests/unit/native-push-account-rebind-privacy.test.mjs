import assert from "node:assert/strict";
import test from "node:test";

import { buildFcmMessage } from "../../supabase/functions/send-push-notifications/fcm.ts";
import { buildWnsToast } from "../../supabase/functions/send-push-notifications/wns.ts";

const oldAccountPayload = {
  kind: "message",
  title: "Previous account sender",
  body: "Previous account secret message",
  preview: "Previous account secret preview",
  senderName: "Previous account sender",
  senderAvatarUrl: "https://app.letscube.ru/media/previous-account.webp",
  senderKind: "user",
  senderId: "previous-account-id",
  chatId: "chat-1",
  messageId: "message-1",
  notificationId: "notification-1",
  tag: "message:chat:chat-1",
  url: "/?chat=chat-1&message=message-1",
};

const forbidden = /Previous account|secret|previous-account\.webp|previous-account-id/;

test("FCM legacy and data-only payloads do not disclose a previous account after token rebind", () => {
  for (const version of ["0.1.7", "0.1.11"]) {
    const envelope = buildFcmMessage(oldAccountPayload, "synthetic-reused-token", version);
    assert.doesNotMatch(JSON.stringify(envelope), forbidden);
    assert.equal(envelope.message.data.chat_id, "chat-1");
    assert.equal(envelope.message.data.message_id, "message-1");
    assert.equal(envelope.message.data.route, "/?chat=chat-1&message=message-1");
  }
});

test("WNS toast does not disclose a previous account after channel rebind", () => {
  const xml = buildWnsToast({
    ...oldAccountPayload,
    senderId: oldAccountPayload.senderId,
    botId: "",
    messageType: "text",
    groupTag: oldAccountPayload.tag,
    renotify: true,
  });
  assert.doesNotMatch(xml, forbidden);
  assert.match(xml, /route=%2F%3Fchat%3Dchat-1%26message%3Dmessage-1/);
});

test("native task and system cards carry no account-specific text", () => {
  for (const [kind, expectedBody] of [
    ["task_assigned", "Новая задача"],
    ["system_update", "Новое уведомление"],
  ]) {
    const payload = { ...oldAccountPayload, kind };
    const fcm = buildFcmMessage(payload, "synthetic-reused-token", "0.1.11");
    const wns = buildWnsToast({ ...payload, botId: "", messageType: "text", groupTag: "", renotify: true });
    assert.equal(fcm.message.notification.title, "LETSCUBE");
    assert.equal(fcm.message.notification.body, expectedBody);
    assert.match(wns, new RegExp(`<text>LETSCUBE</text><text>${expectedBody}</text>`));
    assert.doesNotMatch(JSON.stringify(fcm) + wns, forbidden);
  }
});

test("current Android chat contract still has a valid exact-message target", () => {
  const chatId = "11111111-1111-4111-8111-111111111111";
  const messageId = "22222222-2222-4222-8222-222222222222";
  const envelope = buildFcmMessage({
    ...oldAccountPayload,
    chatId,
    messageId,
    tag: `message:chat:${chatId}`,
    url: `/?chat=${chatId}&message=${messageId}`,
  }, "synthetic-reused-token", "0.1.11");
  assert.equal(envelope.message.data.native_chat_v, "1");
  assert.equal(envelope.message.data.chat_id, chatId);
  assert.equal(envelope.message.data.message_id, messageId);
  assert.equal(envelope.message.data.tag, `message:chat:${chatId}`);
  assert.equal(envelope.message.data.group_tag, `message:chat:${chatId}`);
  assert.equal(envelope.message.data.route, `/?chat=${chatId}&message=${messageId}`);
  assert.doesNotMatch(JSON.stringify(envelope), forbidden);
});
