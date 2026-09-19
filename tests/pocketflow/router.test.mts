import assert from "node:assert/strict";
import test from "node:test";

import { createRouter, groupMessageIsForUs } from "../../artifacts/pocketflow/src/app/router.ts";
import type { AppContext } from "../../artifacts/pocketflow/src/app/context.ts";
import type { Feature } from "../../artifacts/pocketflow/src/app/router.ts";
import { classify } from "../../artifacts/pocketflow/src/lib/classify.ts";
import { createLogger } from "../../artifacts/pocketflow/src/lib/logger.ts";
import type { Db } from "../../artifacts/pocketflow/src/store/db.ts";
import type {
  BotTransport,
  IncomingMessage,
  Update,
} from "../../artifacts/pocketflow/src/transport/types.ts";

/**
 * The router's four rules, each of which is a decision rather than plumbing.
 *
 *   - an update is handled once, even when it is delivered twice;
 *   - a handler that throws releases its claim, so the update is not lost;
 *   - an update type nobody understands is dropped **loudly**, not silently;
 *   - in a group the bot answers commands and mentions, and nothing else.
 *
 * The fakes below are deliberately thin. A fake `Db` that pattern-matches SQL
 * is crude, but it is honest about what the router actually asks the database
 * — three statements — and it keeps this test from needing Postgres.
 */

type Recorded = { text: string; values: readonly unknown[] };

function createFakeDb(): Db & { statements: Recorded[]; claimed: Set<number> } {
  const claimed = new Set<number>();
  const statements: Recorded[] = [];
  const db = {
    statements,
    claimed,
    async query(text: string, values: readonly unknown[] = []) {
      statements.push({ text, values });
      if (text.includes("insert into pf_processed_updates")) {
        const id = Number(values[0]);
        if (claimed.has(id)) return { rows: [], rowCount: 0 } as never;
        claimed.add(id);
        return { rows: [], rowCount: 1 } as never;
      }
      if (text.includes("delete from pf_processed_updates")) {
        claimed.delete(Number(values[0]));
        return { rows: [], rowCount: 1 } as never;
      }
      if (text.includes("insert into pf_users")) {
        return {
          rows: [
            {
              user_id: values[0],
              display_name: values[1],
              username: values[2],
              time_zone: values[3],
              developer_mode: false,
            },
          ],
          rowCount: 1,
        } as never;
      }
      return { rows: [], rowCount: 0 } as never;
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return fn(db as unknown as Db);
    },
    async close() {},
  };
  return db as unknown as Db & { statements: Recorded[]; claimed: Set<number> };
}

function createFakeTransport(): BotTransport & { sent: string[]; answered: string[] } {
  const sent: string[] = [];
  const answered: string[] = [];
  const transport = {
    platform: "fake",
    sent,
    answered,
    supports: () => true,
    async getMe() {
      return { id: "bot", username: "pocketflow_bot", displayName: "PocketFlow" };
    },
    async sendText(options: { text: string }) {
      sent.push(options.text);
      return { id: "m1", chatId: "c1", date: null } as never;
    },
    async editText() {},
    async deleteMessage() {},
    async sendChatAction() {},
    async answerCallbackQuery(id: string) {
      answered.push(id);
    },
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
  return transport as unknown as BotTransport & { sent: string[]; answered: string[] };
}

function createContext(overrides: Partial<AppContext> = {}): AppContext {
  const lines: string[] = [];
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
    db: createFakeDb(),
    bot: createFakeTransport(),
    log: createLogger({ minLevel: "error", write: (line) => lines.push(line) }),
    now: () => new Date("2026-09-19T12:00:00Z"),
    ...overrides,
  };
}

function message(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    id: "m-source",
    chat: { id: "c1", kind: "private", title: null },
    from: { id: "u1", isBot: false, displayName: "Аня", username: "anya" },
    date: new Date("2026-09-19T12:00:00Z"),
    text: null,
    replyToMessageId: null,
    topicId: null,
    attachment: null,
    ...overrides,
  };
}

test("an update delivered twice is handled once", async () => {
  let handled = 0;
  const feature: Feature = {
    name: "counter",
    async onMessage() {
      handled += 1;
      return true;
    },
  };
  const ctx = createContext();
  const router = createRouter([feature]);
  const update: Update = { updateId: 7, kind: "message", message: message({ text: "привет" }) };

  await router.handle(ctx, update);
  await router.handle(ctx, update);

  assert.equal(handled, 1);
});

test("a handler that throws releases the claim, so the update can be retried", async () => {
  let attempts = 0;
  const feature: Feature = {
    name: "flaky",
    async onMessage() {
      attempts += 1;
      if (attempts === 1) throw new Error("database blip");
      return true;
    },
  };
  const ctx = createContext();
  const router = createRouter([feature]);
  const update: Update = { updateId: 9, kind: "message", message: message({ text: "привет" }) };

  await assert.rejects(() => router.handle(ctx, update), /database blip/);
  await router.handle(ctx, update);

  assert.equal(attempts, 2, "the second delivery must reach the handler again");
});

test("an update type nobody understands is claimed and logged, not thrown", async () => {
  const lines: string[] = [];
  const ctx = createContext({
    log: createLogger({ minLevel: "debug", write: (line) => lines.push(line) }),
  });
  const router = createRouter([]);
  await router.handle(ctx, {
    updateId: 11,
    kind: "unsupported",
    rawType: "poll_answer",
    raw: {},
  });
  assert.ok(
    lines.some((line) => line.includes("update.unsupported") && line.includes("poll_answer")),
    "the drop must be visible in the log",
  );
});

test("two features cannot claim the same command", () => {
  const one: Feature = { name: "one", commands: { help: async () => {} } };
  const two: Feature = { name: "two", commands: { help: async () => {} } };
  assert.throws(() => createRouter([one, two]), /claimed twice/);
});

test("the first feature to claim a message wins", async () => {
  const order: string[] = [];
  const waiting: Feature = {
    name: "waiting",
    async onMessage() {
      order.push("waiting");
      return true;
    },
  };
  const inbox: Feature = {
    name: "inbox",
    async onMessage() {
      order.push("inbox");
      return true;
    },
  };
  const ctx = createContext();
  await createRouter([waiting, inbox]).handle(ctx, {
    updateId: 21,
    kind: "message",
    message: message({ text: "18:00" }),
  });
  assert.deepEqual(order, ["waiting"]);
});

test("a message from another bot is not input", async () => {
  let handled = 0;
  const feature: Feature = {
    name: "counter",
    async onMessage() {
      handled += 1;
      return true;
    },
  };
  const ctx = createContext();
  await createRouter([feature]).handle(ctx, {
    updateId: 31,
    kind: "message",
    message: message({ text: "привет", from: { id: "b1", isBot: true, displayName: null, username: null } }),
  });
  assert.equal(handled, 0, "two bots answering each other is a loop");
});

test("an unknown command is answered in private and ignored in a group", async () => {
  const privateCtx = createContext();
  await createRouter([]).handle(privateCtx, {
    updateId: 41,
    kind: "message",
    message: message({ text: "/nosuch" }),
  });
  assert.equal((privateCtx.bot as unknown as { sent: string[] }).sent.length, 1);

  const groupCtx = createContext();
  await createRouter([]).handle(groupCtx, {
    updateId: 42,
    kind: "message",
    message: message({ text: "/nosuch", chat: { id: "g1", kind: "group", title: "Команда" } }),
  });
  assert.equal(
    (groupCtx.bot as unknown as { sent: string[] }).sent.length,
    0,
    "an unknown command in a group is somebody else's bot being addressed",
  );
});

test("in a group, an ordinary message is not for us", async () => {
  let handled = 0;
  const feature: Feature = {
    name: "counter",
    async onMessage() {
      handled += 1;
      return true;
    },
  };
  const ctx = createContext({ botUsername: "pocketflow_bot" });
  await createRouter([feature]).handle(ctx, {
    updateId: 51,
    kind: "message",
    message: message({ text: "обед в час", chat: { id: "g1", kind: "group", title: "Команда" } }),
  });
  assert.equal(handled, 0);
});

test("in a group, a mention is for us", async () => {
  let handled = 0;
  const feature: Feature = {
    name: "counter",
    async onMessage() {
      handled += 1;
      return true;
    },
  };
  const ctx = createContext({ botUsername: "pocketflow_bot" });
  await createRouter([feature]).handle(ctx, {
    updateId: 61,
    kind: "message",
    message: message({
      text: "@pocketflow_bot напомни про обед",
      chat: { id: "g1", kind: "group", title: "Команда" },
    }),
  });
  assert.equal(handled, 1);
});

test("the group rule does not fire on a lookalike", () => {
  const text = "напишите на support@pocketflow_bot.example.com";
  const msg = message({ text, chat: { id: "g1", kind: "group", title: "Команда" } });
  assert.equal(
    groupMessageIsForUs(msg, classify(msg), "pocketflow_bot"),
    false,
    "an address is not a mention",
  );
});

test("a press on a button nobody owns still stops the spinner", async () => {
  const ctx = createContext();
  await createRouter([]).handle(ctx, {
    updateId: 71,
    kind: "callback_query",
    callbackQuery: {
      id: "cb1",
      from: { id: "u1", isBot: false, displayName: "Аня", username: "anya" },
      data: "gone.action:1",
      message: { id: "m1", chatId: "c1" },
    },
  });
  assert.deepEqual((ctx.bot as unknown as { answered: string[] }).answered, ["cb1"]);
});
