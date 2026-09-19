import assert from "node:assert/strict";
import test from "node:test";

import type { AppContext } from "../../artifacts/pocketflow/src/app/context.ts";
import { runStreamDemo } from "../../artifacts/pocketflow/src/app/devtools.ts";
import { createLogger } from "../../artifacts/pocketflow/src/lib/logger.ts";
import type { Db } from "../../artifacts/pocketflow/src/store/db.ts";
import type { BotTransport, Update } from "../../artifacts/pocketflow/src/transport/types.ts";

/**
 * `/streamdemo` — the progressive report §12 asks for, on a platform with no
 * streaming API (gap G-6).
 *
 * The property worth pinning is that it is **one message edited**, not four
 * messages sent. That is the whole difference between a progress report and a
 * bot spamming a conversation, and it is the thing an innocent-looking
 * refactor would break. The clock is a parameter, so this test never waits.
 */

type Event =
  | { kind: "action"; action: string }
  | { kind: "send"; id: string; text: string }
  | { kind: "edit"; id: string; text: string };

function createFakeTransport(): { bot: BotTransport; events: Event[] } {
  const events: Event[] = [];
  let next = 0;
  const bot = {
    platform: "fake",
    supports: () => true,
    async getMe() {
      return { id: "bot", username: "pf", displayName: "PocketFlow" };
    },
    async sendText(options: { text: string }) {
      next += 1;
      const id = `m${next}`;
      events.push({ kind: "send", id, text: options.text });
      return { id, chatId: "c1", date: null } as never;
    },
    async editText(options: { messageId: string; text: string }) {
      events.push({ kind: "edit", id: options.messageId, text: options.text });
    },
    async deleteMessage() {},
    async sendChatAction(_chatId: string, action: string) {
      events.push({ kind: "action", action });
    },
    async answerCallbackQuery() {},
    async getFile() {
      throw new Error("not used");
    },
    async setMyCommands() {},
    async getMyCommands() {
      return [];
    },
    async getUpdates() {
      return [];
    },
    async setWebhook() {},
    async deleteWebhook() {},
    async getWebhookInfo() {
      return { configured: false, pendingUpdateCount: 0, failureCount: 0, lastErrorCode: null };
    },
    parseWebhookUpdate(body: unknown) {
      return body as Update;
    },
  };
  return { bot: bot as unknown as BotTransport, events };
}

function createContext(bot: BotTransport): AppContext {
  const db = {
    async query() {
      return { rows: [], rowCount: 0 } as never;
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return fn(db as unknown as Db);
    },
    async close() {},
  } as unknown as Db;
  return {
    config: {
      botToken: "x",
      botApiBaseUrl: "https://api.example.com",
      publicBaseUrl: null,
      transport: "polling",
      databaseUrl: "postgres://",
      developerIds: new Set<string>(),
      webhookSecret: null,
      port: 8099,
      defaultTimeZone: "Europe/Moscow",
    },
    db,
    bot,
    log: createLogger({ minLevel: "error", write: () => {} }),
    now: () => new Date("2026-09-19T12:00:00Z"),
  };
}

const noSleep = async (): Promise<void> => {};

test("the progress is one message edited, not a message per step", async () => {
  const { bot, events } = createFakeTransport();
  const ctx = createContext(bot);
  const result = await runStreamDemo(ctx, "c1", { sleep: noSleep });

  const sends = events.filter((event) => event.kind === "send");
  const edits = events.filter((event) => event.kind === "edit");

  assert.equal(sends.length, 2, "one draft and one final message, and nothing else");
  assert.ok(edits.length >= 2, `only ${edits.length} edits — the progress was not shown`);
  for (const edit of edits) {
    assert.equal(edit.id, result.draftMessageId, "every edit must land on the draft");
  }
});

test("the steps arrive in order and the draft ends settled", async () => {
  const { bot, events } = createFakeTransport();
  await runStreamDemo(createContext(bot), "c1", { sleep: noSleep });

  const shown = [
    ...events.filter((event) => event.kind === "send").slice(0, 1),
    ...events.filter((event) => event.kind === "edit"),
  ].map((event) => ("text" in event ? event.text : ""));

  assert.match(shown[0] ?? "", /Анализирую/);
  assert.match(shown[1] ?? "", /Проверяю/);
  assert.match(shown[2] ?? "", /Собираю/);
  assert.match(shown[shown.length - 1] ?? "", /Готово/);
});

test("a typing action goes out before the first word appears", async () => {
  const { bot, events } = createFakeTransport();
  await runStreamDemo(createContext(bot), "c1", { sleep: noSleep });
  assert.equal(events[0]?.kind, "action");
  assert.equal(events[0] && "action" in events[0] ? events[0].action : "", "typing");
});

test("the result is its own persistent message, not only an edit", async () => {
  // §12 asks for a «normal persistent final message». A result that exists
  // only as the last edit of a progress line is one a reader scrolls past.
  const { bot, events } = createFakeTransport();
  const result = await runStreamDemo(createContext(bot), "c1", { sleep: noSleep });
  const sends = events.filter((event) => event.kind === "send");
  assert.equal(sends[1] && "id" in sends[1] ? sends[1].id : "", result.finalMessageId);
  assert.match(sends[1] && "text" in sends[1] ? sends[1].text : "", /Отчёт/);
});

test("the report says plainly that there is no streaming API", async () => {
  const { bot, events } = createFakeTransport();
  await runStreamDemo(createContext(bot), "c1", { sleep: noSleep });
  const final = events.filter((event) => event.kind === "send")[1];
  const text = final && "text" in final ? final.text : "";
  assert.match(text, /G-6/, "the gap must be named rather than implied");
});
