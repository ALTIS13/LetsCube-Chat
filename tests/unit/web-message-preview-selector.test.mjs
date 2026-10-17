import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { buildDeclarativeWebPushPayload } from "../../supabase/functions/send-push-notifications/webpush.ts";

const subscriptionId = "71000000-0000-4000-8000-000000000001";
const notificationId = "71000000-0000-4000-8000-000000000002";
const payload = {
  title: "Fictional Sender", body: "Fictional private message", preview: "Fictional caption",
  url: "/?chat=fixture-chat&message=fixture-message", tag: "message:chat:fixture-chat",
  kind: "message", chatId: "fixture-chat", messageId: "fixture-message",
  senderKind: "user", senderId: "fixture-sender", botId: "", senderName: "Fictional Sender",
  senderAvatarUrl: "https://fixture.invalid/private-avatar", messageType: "text",
  groupTag: "message:chat:fixture-chat", renotify: true,
};

test("Web preview selector carries only exact identifiers while both display paths remain generic", () => {
  for (const origin of ["https://app.letscube.ru", undefined]) {
    const result = buildDeclarativeWebPushPayload(payload, origin, { subscriptionId, notificationId });
    assert.deepEqual(result.web_preview, {
      preview_v: 1, subscription_id: subscriptionId, notification_id: notificationId,
    });
    assert.equal(result.title, "LETSCUBE");
    assert.equal(result.body, "Новое уведомление");
    if (result.notification) {
      assert.equal(result.notification.title, "LETSCUBE");
      assert.equal(result.notification.body, "Новое уведомление");
    }
    assert.doesNotMatch(JSON.stringify(result), /Fictional|private-avatar/);
  }
});

test("missing or malformed selectors and non-message pushes cannot enroll preview authority", () => {
  const origin = "https://app.letscube.ru";
  for (const selector of [undefined, null, {}, { subscriptionId, notificationId: "not-a-uuid" },
    { subscriptionId: "https://fixture.invalid", notificationId }, { subscriptionId: [], notificationId }]) {
    const result = buildDeclarativeWebPushPayload(payload, origin, selector);
    assert.equal(Object.hasOwn(result, "web_preview"), false);
  }
  const other = buildDeclarativeWebPushPayload({ ...payload, kind: "task_assigned" }, origin,
    { subscriptionId, notificationId });
  assert.equal(Object.hasOwn(other, "web_preview"), false);
});

test("payload-supplied preview credentials are discarded rather than becoming a selector", () => {
  const result = buildDeclarativeWebPushPayload({ ...payload,
    web_preview: { preview_v: 1, subscription_id: subscriptionId, notification_id: notificationId,
      grant_secret: "fictional-forged-grant" },
  }, "https://app.letscube.ru");
  assert.equal(Object.hasOwn(result, "web_preview"), false);
  assert.doesNotMatch(JSON.stringify(result), /fictional-forged-grant/);
});

test("loaded selector omissions fail literal message-kind, identifier and credential assertions", async () => {
  const source = readFileSync(new URL("../../supabase/functions/send-push-notifications/webpush.ts", import.meta.url), "utf8");
  const cases = [
    ["payload.kind === \"message\" && ", "", { ...payload, kind: "task_assigned" },
      { subscriptionId, notificationId }],
    ["uuid.test(selector.notificationId)", "true", payload,
      { subscriptionId, notificationId: "not-a-uuid" }],
    ["delete neutral.web_preview;", "", { ...payload,
      web_preview: { grant_secret: "fictional-forged-grant" } }, undefined],
  ];
  for (const [from, to, input, selector] of cases) {
    assert.equal(source.split(from).length, 2, "exact loaded mutation anchor");
    const code = stripTypeScriptTypes(source.replace(from, to));
    const mutated = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
    const result = mutated.buildDeclarativeWebPushPayload(input, "https://app.letscube.ru", selector);
    assert.throws(() => assert.equal(Object.hasOwn(result, "web_preview"), false),
      { code: "ERR_ASSERTION" }, "unchanged literal refusal must reject each loaded omission");
  }
});
