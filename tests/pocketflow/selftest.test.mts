import assert from "node:assert/strict";
import test from "node:test";

import type { AppContext } from "../../artifacts/pocketflow/src/app/context.ts";
import { runSelftest } from "../../artifacts/pocketflow/src/app/selftest.ts";
import { createLogger } from "../../artifacts/pocketflow/src/lib/logger.ts";
import type { Db } from "../../artifacts/pocketflow/src/store/db.ts";
import type {
  BotTransport,
  TransportCapability,
  Update,
} from "../../artifacts/pocketflow/src/transport/types.ts";

/**
 * §22.13: «Unsupported capabilities не маскируются под PASS».
 *
 * That is the whole reason `/selftest` is worth building rather than
 * describing, and it is the one property a report can lose silently — a check
 * that calls an absent method gets an error, an error looks like a failure, and
 * a platform gap is filed as a regression. So these tests come at it from both
 * sides: an unsupported capability must never read PASS, **and** a supported
 * one that breaks must never read UNSUPPORTED.
 *
 * The second half matters as much as the first. A selftest that answers
 * UNSUPPORTED to everything would pass the first assertion and be worthless.
 */

const RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function createFakeDb(): Db & { saved: unknown[] } {
  const saved: unknown[] = [];
  const db = {
    saved,
    async query(text: string, values: readonly unknown[] = []) {
      if (text.includes("insert into pf_selftest_runs")) {
        return { rows: [{ id: RUN_ID }], rowCount: 1 } as never;
      }
      if (text.includes("update pf_selftest_runs")) {
        saved.push(JSON.parse(String(values[1])));
        return { rows: [], rowCount: 1 } as never;
      }
      return { rows: [], rowCount: 0 } as never;
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return fn(db as unknown as Db);
    },
    async close() {},
  };
  return db as unknown as Db & { saved: unknown[] };
}

type TransportOptions = {
  supports?: (capability: TransportCapability) => boolean;
  failEverySend?: boolean;
};

function createFakeTransport(options: TransportOptions = {}): BotTransport {
  const transport = {
    platform: "fake",
    supports: options.supports ?? (() => true),
    async getMe() {
      return { id: "bot", username: "pocketflow_bot", displayName: "PocketFlow" };
    },
    async sendText() {
      if (options.failEverySend) throw new Error("sendMessage exploded");
      return { id: "m1", chatId: "c1", date: null } as never;
    },
    async editText() {
      if (options.failEverySend) throw new Error("editMessageText exploded");
    },
    async deleteMessage() {
      if (options.failEverySend) throw new Error("deleteMessage exploded");
    },
    async sendChatAction() {
      if (options.failEverySend) throw new Error("sendChatAction exploded");
    },
    async answerCallbackQuery() {},
    async getFile() {
      throw new Error("not used");
    },
    async setMyCommands() {},
    async getMyCommands() {
      return [{ command: "start", description: "Начать" }];
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
  return transport as unknown as BotTransport;
}

function createContext(bot: BotTransport): AppContext {
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
    bot,
    log: createLogger({ minLevel: "error", write: () => {} }),
    now: () => new Date("2026-09-19T12:00:00Z"),
  };
}

async function run(bot: BotTransport) {
  const ctx = createContext(bot);
  const { report } = await runSelftest(ctx, { requestedBy: "u1", chatId: "c1" });
  return { ctx, report };
}

test("a capability the platform lacks is UNSUPPORTED, never PASS and never FAIL", async () => {
  const absent = new Set<TransportCapability>(["sendPhoto", "inlineMode", "poll", "uploadFile"]);
  const { report } = await run(
    createFakeTransport({ supports: (capability) => !absent.has(capability) }),
  );

  for (const id of ["media.send_photo", "interaction.inline_mode", "interaction.poll", "media.upload"]) {
    const check = report.checks.find((entry) => entry.id === id);
    assert.ok(check, `${id} is missing from the report`);
    assert.equal(check.status, "UNSUPPORTED", `${id} reported ${check.status}`);
    assert.notEqual(check.detail, "", `${id} gives no reason`);
  }
});

test("a supported capability that breaks is FAIL, not UNSUPPORTED", async () => {
  // The other half of the rule. A report that answered UNSUPPORTED to
  // everything would satisfy the test above and be worth nothing.
  const { report } = await run(createFakeTransport({ failEverySend: true }));
  const send = report.checks.find((entry) => entry.id === "messages.send");
  assert.ok(send);
  assert.equal(send.status, "FAIL");
  assert.match(send.detail, /exploded/);
});

test("a working platform reports PASS for what it actually did", async () => {
  const { report } = await run(createFakeTransport());
  const send = report.checks.find((entry) => entry.id === "messages.send");
  assert.equal(send?.status, "PASS");
  const identity = report.checks.find((entry) => entry.id === "transport.get_me");
  assert.equal(identity?.status, "PASS");
  assert.match(identity?.detail ?? "", /pocketflow_bot/);
});

test("callback_query is USER_ACTION_REQUIRED until somebody presses the button", async () => {
  // Sending a keyboard proves nothing about whether a press comes back, and
  // this is the check most likely to be quietly upgraded to PASS by a future
  // edit. The assertion is that it is not.
  const { report } = await run(createFakeTransport());
  const callback = report.checks.find((entry) => entry.id === "buttons.callback_query");
  assert.equal(callback?.status, "USER_ACTION_REQUIRED");

  const keyboardCheck = report.checks.find((entry) => entry.id === "buttons.inline_keyboard");
  assert.equal(keyboardCheck?.status, "PASS", "the keyboard itself did go out");
});

test("getFile is not claimed as PASS from the method merely existing", async () => {
  const { report } = await run(createFakeTransport());
  const getFile = report.checks.find((entry) => entry.id === "media.get_file");
  assert.equal(getFile?.status, "USER_ACTION_REQUIRED");
});

test("every check in the report carries an id, a section and a status", async () => {
  const { report } = await run(createFakeTransport());
  assert.ok(report.checks.length >= 20, `only ${report.checks.length} checks`);
  for (const check of report.checks) {
    assert.match(check.id, /^[a-z_]+\.[a-z_]+$/, `bad id ${check.id}`);
    assert.ok(check.section.length > 0, `${check.id} has no section`);
    assert.ok(
      ["PASS", "FAIL", "UNSUPPORTED", "USER_ACTION_REQUIRED", "SKIPPED"].includes(check.status),
      `${check.id} has status ${check.status}`,
    );
  }
});

test("the run is stored, so two runs can be compared after a platform change", async () => {
  const { ctx } = await run(createFakeTransport());
  const saved = (ctx.db as unknown as { saved: unknown[] }).saved;
  assert.equal(saved.length, 1, "the report was not written back");
  const stored = saved[0] as { checks: unknown[]; platform: string };
  assert.equal(stored.platform, "fake");
  assert.ok(Array.isArray(stored.checks) && stored.checks.length > 0);
});

test("a check whose prerequisite is missing is SKIPPED, not FAIL", async () => {
  // `messages.reply` needs a message to reply to. When `messages.send` was
  // itself unsupported there is none, and reporting that as a failure of the
  // reply would blame the wrong thing.
  const { report } = await run(
    createFakeTransport({ supports: (capability) => capability !== "sendText" }),
  );
  const reply = report.checks.find((entry) => entry.id === "messages.reply");
  assert.equal(reply?.status, "SKIPPED");
});
