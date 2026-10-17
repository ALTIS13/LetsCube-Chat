import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import * as config from "../../artifacts/api-server/src/workers/pushDispatcherConfig.ts";

const subscriptionId = "72000000-0000-4000-8000-000000000001";
const notificationId = "72000000-0000-4000-8000-000000000002";
const source = { kind: "message", title: "Fictional Sender", body: "Fictional text", notificationId,
  url: "/?chat=fixture&message=fixture", tag: "message:chat:fixture",
  web_preview: { grant_secret: "fictional-forged-grant" } };

test("legacy renderer has an explicit generic-only preview payload boundary", () => {
  assert.equal(typeof config.buildLegacyWebPushPayload, "function");
  const sent = config.buildLegacyWebPushPayload(source, subscriptionId, "https://app.letscube.ru");
  assert.equal(sent.body, "Новое уведомление");
  assert.deepEqual(sent.notification, { title: "LETSCUBE", body: "Новое уведомление",
    navigate: "https://app.letscube.ru/?chat=fixture&message=fixture", tag: "message:chat:fixture" });
  assert.deepEqual(sent.web_preview, { preview_v: 1, subscription_id: subscriptionId, notification_id: notificationId });
  assert.doesNotMatch(JSON.stringify(sent), /Fictional|fictional-forged-grant/);
  assert.equal(source.body, "Fictional text");
});

test("legacy selector never derives credentials or authority from a task or malformed ID", () => {
  for (const [payload, id] of [[{ ...source, kind: "task_assigned" }, subscriptionId],
    [{ ...source, notificationId: "bad" }, subscriptionId], [source, "bad"]]) {
    assert.equal(Object.hasOwn(config.buildLegacyWebPushPayload(payload, id), "web_preview"), false);
  }
});

test("legacy navigation and configured origin cannot become foreign push activation", () => {
  for (const url of ["//foreign.invalid/", "https://foreign.invalid/", "/\\foreign.invalid/", "/\nforeign"]) {
    const sent = config.buildLegacyWebPushPayload({ ...source, url }, subscriptionId, "https://app.letscube.ru");
    assert.equal(sent.url, "/");
    assert.equal(sent.notification.navigate, "https://app.letscube.ru/");
  }
  for (const origin of [undefined, "http://localhost:5173", "https://user:pass@fixture.invalid"]) {
    const sent = config.buildLegacyWebPushPayload(source, subscriptionId, origin);
    assert.equal(Object.hasOwn(sent, "web_push"), false);
    assert.equal(sent.body, "Новое уведомление");
  }
});

test("loaded legacy kind and same-origin omissions break literal privacy and routing assertions", async () => {
  const code = readFileSync(new URL("../../artifacts/api-server/src/workers/pushDispatcherConfig.ts", import.meta.url), "utf8");
  const cases = [
    ['kind === "message" && ', "", () => ({ ...source, kind: "task_assigned" }), result =>
      assert.equal(Object.hasOwn(result, "web_preview"), false)],
    ['!payload["url"].startsWith("//") &&', "", () => ({ ...source, url: "//foreign.invalid/" }), result =>
      assert.equal(result.notification.navigate, "https://app.letscube.ru/")],
  ];
  for (const [from, to, input, assertRefusal] of cases) {
    assert.equal(code.split(from).length, 2);
    const mutant = await import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(code.replace(from, to))).toString("base64"));
    const result = mutant.buildLegacyWebPushPayload(input(), subscriptionId, "https://app.letscube.ru");
    assert.throws(() => assertRefusal(result), { code: "ERR_ASSERTION" });
  }
});
