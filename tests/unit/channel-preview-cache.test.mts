import assert from "node:assert/strict";
import test from "node:test";

import { createChannelPreviewCache } from "../../artifacts/kub/src/lib/channelPreviewCache.ts";

/**
 * Tracker item 54, the cost half. Reading every channel's last line each time
 * the list mounted made a reopened server read one page per channel on top of
 * its history, which `chat-list-event-cost.spec` measured three times over on
 * 2026-09-28. The lines are now kept and moved by what the sockets hear.
 */

const ME = "11111111-1111-4111-8111-000000000001";
const ANNA = { id: "11111111-1111-4111-8111-000000000002", full_name: "Анна Смирнова", username: "anna" };
const CHAT = "22222222-2222-4222-8222-000000000001";
const OTHER_CHAT = "22222222-2222-4222-8222-000000000002";
const GENERAL = "44444444-4444-4444-8444-000000000001";
const CHECKS = "44444444-4444-4444-8444-000000000002";
const VOICE = "44444444-4444-4444-8444-000000000003";
const KEY = `${GENERAL}:1,${CHECKS}:0`;
const SCOPE = { selfId: ME, channelsKey: KEY, generalChannelId: GENERAL, general: [GENERAL] };

let serial = 0;
function message(overrides: Record<string, unknown> = {}) {
  serial += 1;
  return {
    id: `55555555-5555-4555-8555-${String(serial).padStart(12, "0")}`,
    chat_id: CHAT,
    topic_id: CHECKS,
    user_id: ANNA.id,
    bot_id: null,
    created_at: `2026-09-28T08:${String(10 + serial).padStart(2, "0")}:00.000Z`,
    deleted_at: null,
    type: "text",
    content: "Смена закрыта",
    media_url: null,
    sender: ANNA,
    ...overrides,
  } as never;
}

function preview(channelId: string, at: string, text = "Смена закрыта", messageId = "m-" + at) {
  return { channelId, sender: "Анна", text, at, messageId };
}

test("a chat never read has nothing to show, and a read answers every reopening after it", () => {
  const cache = createChannelPreviewCache();
  assert.equal(cache.read(CHAT, SCOPE), null);
  const load = cache.begin(CHAT, SCOPE);
  // In flight is not an answer: the list would draw every row as a bare name.
  assert.equal(cache.read(CHAT, SCOPE), null);
  cache.complete(CHAT, load, [preview(CHECKS, "2026-09-28T08:00:00.000Z")]);
  assert.equal(cache.read(CHAT, SCOPE)?.get(CHECKS)?.text, "Смена закрыта");
  // A different reader, or a server whose channels changed, is read again.
  assert.equal(cache.read(CHAT, { ...SCOPE, selfId: ANNA.id }), null);
  assert.equal(cache.read(CHAT, { ...SCOPE, channelsKey: `${GENERAL}:1` }), null);
});

test("a message heard while the server is closed moves its channel's line", () => {
  const cache = createChannelPreviewCache();
  cache.complete(CHAT, cache.begin(CHAT, SCOPE), [preview(CHECKS, "2026-09-28T08:00:00.000Z")]);
  const heard: string[] = [];
  cache.subscribe((chatId) => heard.push(chatId));

  cache.hear(message({ content: "Касса сдана" }));
  assert.equal(cache.read(CHAT, SCOPE)?.get(CHECKS)?.text, "Касса сдана");
  // A message with no topic is the general channel's.
  cache.hear(message({ topic_id: null, content: "Всем привет" }));
  assert.equal(cache.read(CHAT, SCOPE)?.get(GENERAL)?.text, "Всем привет");
  assert.deepEqual(heard, [CHAT, CHAT]);

  // Not a text channel of the entry, another chat, a deleted row: nothing moves.
  cache.hear(message({ topic_id: VOICE, content: "не канал" }));
  cache.hear(message({ chat_id: OTHER_CHAT, content: "чужой чат" }));
  cache.hear(message({ deleted_at: "2026-09-28T09:00:00.000Z", content: "удалено" }));
  assert.deepEqual(heard, [CHAT, CHAT]);
});

test("the same message from both sockets moves the line once, and an older one never", () => {
  const cache = createChannelPreviewCache();
  cache.complete(CHAT, cache.begin(CHAT, SCOPE), []);
  const heard: string[] = [];
  cache.subscribe((chatId) => heard.push(chatId));
  const row = message({ content: "Один раз" });
  cache.hear(row);
  cache.hear(row);
  assert.equal(heard.length, 1);
  cache.hear(message({ created_at: "2026-09-27T08:00:00.000Z", content: "Вчерашнее" }));
  assert.equal(cache.read(CHAT, SCOPE)?.get(CHECKS)?.text, "Один раз");
  assert.equal(heard.length, 1);
});

test("what is written while the first read is in flight survives the read's answer", () => {
  const cache = createChannelPreviewCache();
  const load = cache.begin(CHAT, SCOPE);
  const written = message({ content: "Написано во время чтения", created_at: "2026-09-28T10:00:00.000Z" });
  cache.hear(written);
  // The read's snapshot predates the message.
  cache.complete(CHAT, load, [preview(CHECKS, "2026-09-28T08:00:00.000Z", "Старое")]);
  assert.equal(cache.read(CHAT, SCOPE)?.get(CHECKS)?.text, "Написано во время чтения");
});

test("a read that answers after its entry was dropped is thrown away", () => {
  const cache = createChannelPreviewCache();
  const load = cache.begin(CHAT, SCOPE);
  cache.evict(CHAT);
  assert.equal(cache.complete(CHAT, load, [preview(CHECKS, "2026-09-28T08:00:00.000Z")]), null);
  assert.equal(cache.read(CHAT, SCOPE), null);
  // And one superseded by a newer read does not overwrite it.
  const first = cache.begin(CHAT, SCOPE);
  const second = cache.begin(CHAT, SCOPE);
  cache.complete(CHAT, second, [preview(CHECKS, "2026-09-28T09:00:00.000Z", "Новое")]);
  assert.equal(cache.complete(CHAT, first, [preview(CHECKS, "2026-09-28T08:00:00.000Z", "Старое")]), null);
  assert.equal(cache.read(CHAT, SCOPE)?.get(CHECKS)?.text, "Новое");
});

test("deleting the quoted message drops the entry; editing it rewrites the line", () => {
  const cache = createChannelPreviewCache();
  cache.complete(CHAT, cache.begin(CHAT, SCOPE), []);
  const row = message({ content: "Смена закрыта" }) as unknown as { id: string; chat_id: string };
  cache.hear(row as never);
  const heard: string[] = [];
  cache.subscribe((chatId) => heard.push(chatId));

  cache.hearUpdate({ ...(row as object), content: "Смена закрыта, касса сдана", deleted_at: null } as never);
  assert.equal(cache.read(CHAT, SCOPE)?.get(CHECKS)?.text, "Смена закрыта, касса сдана");
  assert.equal(cache.read(CHAT, SCOPE)?.get(CHECKS)?.sender, "Анна");

  // An update to a message no line quotes costs nothing.
  cache.hearUpdate({ ...(message() as object), content: "другое", deleted_at: null } as never);
  assert.deepEqual(heard, [CHAT]);

  // Deleted: the line under it is the one before, which only a read can find.
  cache.hearUpdate({ ...(row as object), deleted_at: "2026-09-28T09:00:00.000Z" } as never);
  assert.equal(cache.read(CHAT, SCOPE), null);
  assert.deepEqual(heard, [CHAT, CHAT]);
});

test("a reconnection drops every entry, and a clearing drops the chat's", () => {
  const cache = createChannelPreviewCache();
  cache.complete(CHAT, cache.begin(CHAT, SCOPE), []);
  cache.complete(OTHER_CHAT, cache.begin(OTHER_CHAT, SCOPE), []);
  const heard: string[] = [];
  cache.subscribe((chatId) => heard.push(chatId));

  cache.evict(OTHER_CHAT);
  assert.equal(cache.read(OTHER_CHAT, SCOPE), null);
  assert.notEqual(cache.read(CHAT, SCOPE), null);
  cache.clear();
  assert.equal(cache.read(CHAT, SCOPE), null);
  assert.deepEqual(heard, [OTHER_CHAT, "*"]);
});
