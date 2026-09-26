import assert from "node:assert/strict";
import test from "node:test";

import { parseBotViewerInterfaces } from "../../artifacts/kub/src/lib/botViewerInterface.ts";

const PANEL_ID = "77777777-7777-4777-8777-00000000b001";
const CALLBACK_ID = "66666666-6666-4666-8666-00000000b001";
const MESSAGE_ID = "55555555-5555-4555-8555-00000000b001";
const BOT_ID = "33333333-3333-4333-8333-00000000b001";
const NOW = Date.parse("2026-09-26T12:00:00Z");

function panel(overrides: Record<string, unknown> = {}) {
  return {
    id: PANEL_ID,
    bot_id: BOT_ID,
    callback_query_id: CALLBACK_ID,
    source_message_id: MESSAGE_ID,
    version: 2,
    expires_at: "2026-09-26T12:15:00Z",
    state: {
      title: "Готовим смену",
      body: "Проверяем расписание",
      progress: 40,
      buttons: [[{ key: "cancel", text: "Отменить" }]],
    },
    ...overrides,
  };
}

test("actor panel parser keeps bounded private display data and callback identity", () => {
  assert.deepEqual(parseBotViewerInterfaces([panel()], NOW), [{
    id: PANEL_ID,
    botId: BOT_ID,
    callbackQueryId: CALLBACK_ID,
    sourceMessageId: MESSAGE_ID,
    version: 2,
    expiresAt: NOW + 15 * 60_000,
    title: "Готовим смену",
    body: "Проверяем расписание",
    progress: 40,
    buttons: [[{ key: "cancel", text: "Отменить" }]],
  }]);
});

test("actor panel parser rejects callback data, extra state and duplicate button keys", () => {
  const state = panel().state;
  assert.deepEqual(parseBotViewerInterfaces([panel({ state: {
    ...state,
    buttons: [[{ key: "cancel", text: "Отменить", callback_data: "secret" }]],
  } })], NOW), []);
  assert.deepEqual(parseBotViewerInterfaces([panel({ state: { ...state, url: "https://example.invalid" } })], NOW), []);
  assert.deepEqual(parseBotViewerInterfaces([panel({ state: {
    ...state,
    buttons: [[{ key: "same", text: "A" }, { key: "same", text: "B" }]],
  } })], NOW), []);
});

test("actor panel parser refuses expired, malformed and over-capacity responses", () => {
  assert.deepEqual(parseBotViewerInterfaces([panel({ expires_at: "2026-09-26T12:00:00Z" })], NOW), []);
  assert.deepEqual(parseBotViewerInterfaces([panel({ version: 0 })], NOW), []);
  assert.deepEqual(parseBotViewerInterfaces([panel({ callback_query_id: "not-a-uuid" })], NOW), []);
  assert.deepEqual(parseBotViewerInterfaces({ id: PANEL_ID }, NOW), []);
  assert.deepEqual(parseBotViewerInterfaces(Array.from({ length: 9 }, () => panel()), NOW), []);
});

test("actor panel parser retains only valid rows and enforces button and text bounds", () => {
  const tooMany = Array.from({ length: 7 }, (_, index) => ({ key: `k${index}`, text: "A" }));
  const parsed = parseBotViewerInterfaces([
    panel({ state: { title: " ", buttons: [] } }),
    panel({ state: { title: "A", buttons: [tooMany] } }),
    panel({ state: { title: "A".repeat(65) } }),
    panel({ state: { title: "Valid" } }),
  ], NOW);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.title, "Valid");
  assert.deepEqual(parsed[0]?.buttons, []);
});
