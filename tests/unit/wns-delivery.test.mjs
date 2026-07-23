import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildWnsToast,
  isAllowedWnsChannelUrl,
  isPermanentWnsChannelError,
  readWnsResponseStatus,
} from "../../supabase/functions/send-push-notifications/wns.ts";

test("WNS message toast preserves exact in-app route and escapes preview text", () => {
  const xml = buildWnsToast({
    title: "Codex & Test",
    body: "<Первое сообщение>",
    url: "/?chat=chat-1&message=message-1",
    tag: "message:chat:chat-1",
    kind: "message",
    chatId: "chat-1",
    messageId: "message-1",
    renotify: false,
  });

  assert.match(xml, /activationType="protocol"/);
  assert.match(
    xml,
    /launch="letscube-notification:\/\/open\?route=%2F%3Fchat%3Dchat-1%26message%3Dmessage-1"/,
  );
  assert.match(xml, /<header[^>]+title="Codex &amp; Test"/);
  assert.match(xml, /<text>&lt;Первое сообщение&gt;<\/text>/);
  assert.doesNotMatch(xml, /<text>Codex &amp; Test<\/text>/);
});

test("WNS operational toast keeps task semantics separate from message headers", () => {
  const xml = buildWnsToast({
    title: "Новая задача",
    body: "Проверить зал",
    url: "/tasks?task=task-1",
    tag: "task:task-1",
    kind: "task_assigned",
    chatId: "",
    messageId: "",
    renotify: true,
  });

  assert.doesNotMatch(xml, /<header/);
  assert.match(xml, /<text>Новая задача<\/text><text>Проверить зал<\/text>/);
  assert.match(xml, /route=%2Ftasks%3Ftask%3Dtask-1/);
});

test("WNS delivery accepts only Microsoft HTTPS channel hosts", () => {
  assert.equal(
    isAllowedWnsChannelUrl("https://db5p.notify.windows.com/?token=opaque"),
    true,
  );
  assert.equal(
    isAllowedWnsChannelUrl("https://notify.windows.com/?token=opaque"),
    true,
  );
  assert.equal(
    isAllowedWnsChannelUrl("http://db5p.notify.windows.com/?token=opaque"),
    false,
  );
  assert.equal(
    isAllowedWnsChannelUrl(
      "https://notify.windows.com.evil.example/?token=opaque",
    ),
    false,
  );
  assert.equal(
    isAllowedWnsChannelUrl(
      "https://user:pass@db5p.notify.windows.com/?token=opaque",
    ),
    false,
  );
  assert.equal(
    isAllowedWnsChannelUrl("https://127.0.0.1/?token=opaque"),
    false,
  );
});

test("WNS permanent channel failures revoke only expired or gone channels", () => {
  assert.equal(isPermanentWnsChannelError(404, "channel_not_found"), true);
  assert.equal(isPermanentWnsChannelError(410, "channel_expired"), true);
  assert.equal(isPermanentWnsChannelError(401, "token_expired"), false);
  assert.equal(isPermanentWnsChannelError(429, "throttled"), false);

  const response = new Response(null, {
    status: 410,
    headers: {
      "x-wns-status": "dropped",
      "x-wns-error-description": "Channel expired",
    },
  });
  assert.equal(readWnsResponseStatus(response), "dropped:channel_expired");
});

test("native push dispatcher isolates FCM and WNS providers", () => {
  const source = readFileSync(
    "supabase/functions/send-push-notifications/index.ts",
    "utf8",
  );

  assert.match(source, /provider:\s*"fcm"\s*\|\s*"apns"\s*\|\s*"wns"/);
  assert.match(source, /select",\s*"id,token,provider,enabled,revoked_at"/);
  assert.match(source, /device\.provider\s*===\s*"wns"/);
  assert.match(source, /getWnsAccessToken/);
  assert.match(source, /deliverWns/);
  assert.match(source, /WNS_CLIENT_SECRET/);
  assert.doesNotMatch(
    source,
    /console\.(?:log|debug)\([^)]*(?:device\.token|accessToken)/,
  );
});
