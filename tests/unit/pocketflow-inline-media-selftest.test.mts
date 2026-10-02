import assert from "node:assert/strict";
import test from "node:test";
import { runSelftest } from "../../artifacts/pocketflow/src/app/selftest.ts";
import type { AppContext } from "../../artifacts/pocketflow/src/app/context.ts";
import { createLogger } from "../../artifacts/pocketflow/src/lib/logger.ts";
import type { BotTransport, SendBytesOptions } from "../../artifacts/pocketflow/src/transport/types.ts";

function context(options: { supported?: boolean; absentMethod?: boolean; failSend?: boolean; wrongSize?: boolean; failCleanup?: boolean } = {}) {
  const sent: SendBytesOptions[] = [];
  const fetched: [string, string][] = [];
  const deleted: [string, string][] = [];
  const bot = {
    platform: "local-fixture",
    supports: (capability: string) => options.supported !== false && ["sendBytes", "deleteMessage", "getFile"].includes(capability),
    getMe: async () => ({ id: "fixture-bot", username: "fixture_bot" }),
    getWebhookInfo: async () => ({ configured: false, failureCount: 0, pendingUpdateCount: 0, lastErrorCode: null }),
    ...(!options.absentMethod ? { sendBytes: async (input: SendBytesOptions) => {
      sent.push(input);
      if (options.failSend) throw new Error("synthetic byte upload failed");
      return { id: "fixture-message", chatId: "fixture-chat", date: null };
    } } : {}),
    getFile: async (chatId: string, fileId: string) => {
      fetched.push([chatId, fileId]);
      return { fileId, mimeType: "image/png", fileName: null, byteSize: options.wrongSize ? 1 : 68,
        url: "https://example.invalid/short-lived-fixture", expiresInSeconds: 60 };
    },
    deleteMessage: async (chatId: string, messageId: string) => {
      deleted.push([chatId, messageId]);
      if (options.failCleanup) throw new Error("synthetic probe cleanup failed");
    },
  } as unknown as BotTransport;
  const ctx = {
    config: { transport: "polling" }, bot,
    db: { query: async (sql: string) => ({ rows: sql.includes("insert into pf_selftest_runs") ? [{ id: "fixture-run" }] : [] }) },
    log: createLogger({ write: () => {} }), now: () => new Date("2026-10-02T12:00:00.000Z"),
  } as unknown as AppContext;
  return { ctx, sent, fetched, deleted };
}

async function check(options?: Parameters<typeof context>[0]) {
  const fixture = context(options);
  const { report } = await runSelftest(fixture.ctx, { chatId: "fixture-chat", requestedBy: "fixture-user" });
  const result = report.checks.find((entry) => entry.id === "media.send_bytes");
  assert.ok(result, "selftest never exercises bounded byte sends");
  return { ...fixture, result, report };
}

test("selftest exercises a 68-byte PNG send, checks getFile metadata and deletes its known probe", async () => {
  const { result, sent, fetched, deleted, report } = await check();
  assert.equal(result.status, "PASS");
  assert.match(result.detail, /PNG/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, "photo");
  assert.equal(sent[0].mimeType, "image/png");
  assert.equal(sent[0].bytes.byteLength, 68);
  assert.equal(Buffer.from(sent[0].bytes).toString("hex").slice(0, 16), "89504e470d0a1a0a");
  assert.deepEqual(fetched, [["fixture-chat", "fixture-message"]]);
  assert.deepEqual(deleted, [["fixture-chat", "fixture-message"]]);
  assert.equal(report.checks.find((entry) => entry.id === "media.upload")?.status, "UNSUPPORTED");
});

test("selftest distinguishes an unsupported byte sender without calling it", async () => {
  const { result, sent } = await check({ supported: false });
  assert.equal(result.status, "UNSUPPORTED");
  assert.equal(sent.length, 0);
});

test("declared sendBytes without a method is FAIL, not a silent PASS", async () => {
  const { result } = await check({ absentMethod: true });
  assert.equal(result.status, "FAIL");
});

test("failed byte upload is FAIL, not declaration-only SKIPPED", async () => {
  const { result, fetched, deleted } = await check({ failSend: true });
  assert.equal(result.status, "FAIL");
  assert.match(result.detail, /synthetic byte upload failed/);
  assert.equal(fetched.length, 0);
  assert.equal(deleted.length, 0);
});

test("incorrect getFile byte size fails the probe instead of claiming an upload round trip", async () => {
  const { result, deleted } = await check({ wrongSize: true });
  assert.equal(result.status, "FAIL");
  assert.deepEqual(deleted, [["fixture-chat", "fixture-message"]]);
});

test("probe cleanup failure is recorded without aborting the persisted selftest report", async () => {
  const { result } = await check({ failCleanup: true });
  assert.equal(result.status, "FAIL");
  assert.match(result.detail, /synthetic probe cleanup failed/);
});
