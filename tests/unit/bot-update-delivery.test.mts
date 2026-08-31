import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { BotApiError } from "../../artifacts/api-server/src/bot/errors.ts";
import { deliverWebhook } from "../../artifacts/api-server/src/bot/webhookSecurity.ts";
import {
  createUpdateDeliveryHandlers,
  type BotDeliveryRepository,
} from "../../artifacts/api-server/src/bot/updateDelivery.ts";
import {
  runWebhookDeliveryBatch,
  type WebhookWorkerRepository,
} from "../../artifacts/api-server/src/bot/webhookWorker.ts";

const BOT_ID = "11111111-1111-4111-8111-111111111111";
const LEASE_ID = "22222222-2222-4222-8222-222222222222";
const KEY = randomBytes(32);
const TEST_WEBHOOK_SECRET = randomBytes(24).toString("base64url");

function repository(
  overrides: Partial<BotDeliveryRepository> = {},
): BotDeliveryRepository {
  return {
    async pollUpdates() {
      return [];
    },
    async releasePollingLease() {},
    async setWebhook() {
      return { result: true, duplicate: false };
    },
    async deleteWebhook() {
      return { result: true, duplicate: false };
    },
    async getWebhookInfo() {
      return {
        configured: false,
        pending_update_count: 0,
        failure_count: 0,
        last_error_code: null,
      };
    },
    ...overrides,
  };
}

test("getUpdates forwards offset acknowledgement and eligible filters to SQL before limit", async () => {
  const calls: unknown[] = [];
  const handlers = createUpdateDeliveryHandlers({
    repository: repository({
      async pollUpdates(input) {
        calls.push(input);
        return [
          {
            update_id: 41,
            payload: { message: { id: "m41" } },
          },
          {
            update_id: 43,
            payload: { callback_query: { id: "c43" } },
          },
        ];
      },
      async releasePollingLease(input) {
        calls.push({ release: input });
      },
    }),
    fingerprint: () => "a".repeat(64),
    encryptionKey: KEY,
    validateTarget: async (url) => ({
      url: new URL(url),
      hostname: "hooks.example.test",
      addresses: [{ address: "93.184.216.34", family: 4 }],
    }),
    randomId: () => LEASE_ID,
  });
  const result = await handlers.getUpdates?.(
    { bot: { botId: BOT_ID, tokenId: LEASE_ID }, requestId: "request-1" },
    {
      offset: 41,
      limit: 100,
      timeout: 0,
      allowed_updates: ["message", "callback_query"],
    },
  );
  assert.deepEqual(result, [
    { update_id: 41, message: { id: "m41" } },
    { update_id: 43, callback_query: { id: "c43" } },
  ]);
  assert.deepEqual(calls, [
    {
      botId: BOT_ID,
      offset: 41,
      limit: 100,
      allowedUpdates: ["message", "callback_query"],
      leaseToken: LEASE_ID,
    },
    { release: { botId: BOT_ID, leaseToken: LEASE_ID } },
  ]);
});

test("getUpdates uses abortable 250 ms backoff and never exceeds the bounded deadline", async () => {
  let clock = 1_000;
  let polls = 0;
  const waits: number[] = [];
  const handlers = createUpdateDeliveryHandlers({
    repository: repository({
      async pollUpdates() {
        polls += 1;
        return [];
      },
    }),
    fingerprint: () => "a".repeat(64),
    encryptionKey: KEY,
    validateTarget: async () => {
      throw new Error("unused");
    },
    now: () => clock,
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
      clock += milliseconds;
    },
    randomId: () => LEASE_ID,
  });
  const result = await handlers.getUpdates?.(
    { bot: { botId: BOT_ID, tokenId: LEASE_ID }, requestId: "request-2" },
    { timeout: 1 },
  );
  assert.deepEqual(result, []);
  assert.equal(polls, 5);
  assert.deepEqual(waits, [250, 250, 250, 250]);
  assert.equal(clock, 2_000);
});

test("getUpdates preserves database webhook conflicts and always releases its polling lease", async () => {
  let releases = 0;
  const handlers = createUpdateDeliveryHandlers({
    repository: repository({
      async pollUpdates() {
        throw new BotApiError("conflict");
      },
      async releasePollingLease() {
        releases += 1;
      },
    }),
    fingerprint: () => "a".repeat(64),
    encryptionKey: KEY,
    validateTarget: async () => {
      throw new Error("unused");
    },
    randomId: () => LEASE_ID,
  });
  await assert.rejects(
    handlers.getUpdates?.(
      { bot: { botId: BOT_ID, tokenId: LEASE_ID }, requestId: "request-3" },
      {},
    ) ?? Promise.resolve(),
    (error: unknown) => error instanceof BotApiError && error.code === "conflict",
  );
  assert.equal(releases, 1);
});

test("setWebhook validates before encrypting/persisting and never returns secret material", async () => {
  const events: string[] = [];
  let persisted: Record<string, unknown> | undefined;
  const handlers = createUpdateDeliveryHandlers({
    repository: repository({
      async setWebhook(input) {
        events.push("persist");
        persisted = input;
        return { result: true, duplicate: false };
      },
    }),
    fingerprint: () => "b".repeat(64),
    encryptionKey: KEY,
    validateTarget: async (url) => {
      events.push("validate");
      return {
        url: new URL(url),
        hostname: "hooks.example.test",
        addresses: [{ address: "93.184.216.34", family: 4 }],
      };
    },
  });
  const result = await handlers.setWebhook?.(
    { bot: { botId: BOT_ID, tokenId: LEASE_ID }, requestId: "request-4" },
    {
      url: "https://hooks.example.test/hook",
      secret_token: TEST_WEBHOOK_SECRET,
      drop_pending_updates: true,
      idempotency_key: "webhook:20260831:1",
    },
  );
  assert.equal(result, true);
  assert.deepEqual(events, ["validate", "persist"]);
  assert.equal(persisted?.botId, BOT_ID);
  assert.equal(persisted?.url, "https://hooks.example.test/hook");
  assert.equal(persisted?.dropPendingUpdates, true);
  assert.match(String(persisted?.secretCiphertext), /^enc:v1:/);
  assert.match(String(persisted?.secretFingerprint), /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(persisted).includes(TEST_WEBHOOK_SECRET), false);
});

test("deleteWebhook forwards transactional drop and webhook info remains bounded", async () => {
  let deletion: unknown;
  const handlers = createUpdateDeliveryHandlers({
    repository: repository({
      async deleteWebhook(input) {
        deletion = input;
        return { result: true, duplicate: false };
      },
      async getWebhookInfo() {
        return {
          configured: true,
          pending_update_count: 12,
          failure_count: 3,
          last_error_code: "http_server_error",
        };
      },
    }),
    fingerprint: () => "c".repeat(64),
    encryptionKey: KEY,
    validateTarget: async () => {
      throw new Error("unused");
    },
  });
  const deleted = await handlers.deleteWebhook?.(
    { bot: { botId: BOT_ID, tokenId: LEASE_ID }, requestId: "request-5" },
    {
      drop_pending_updates: true,
      idempotency_key: "webhook:20260831:2",
    },
  );
  assert.equal(deleted, true);
  assert.deepEqual(deletion, {
    botId: BOT_ID,
    dropPendingUpdates: true,
    idempotencyKey: "webhook:20260831:2",
    requestFingerprint: "c".repeat(64),
  });
  assert.deepEqual(
    await handlers.getWebhookInfo?.(
      { bot: { botId: BOT_ID, tokenId: LEASE_ID }, requestId: "request-6" },
      {},
    ),
    {
      configured: true,
      pending_update_count: 12,
      failure_count: 3,
      last_error_code: "http_server_error",
    },
  );
});

test("worker prepares each claim before dispatch and persists only bounded outcome metadata", async () => {
  const calls: unknown[] = [];
  const workerRepository: WebhookWorkerRepository = {
    async claim() {
      return [
        {
          attemptId: 17,
          botId: BOT_ID,
          updateId: 51,
          attemptCount: 2,
          webhookEpoch: 4,
        },
      ];
    },
    async prepare(input) {
      calls.push({ prepare: input });
      return {
        targetUrl: "https://hooks.example.test/hook",
        secretCiphertext: "enc:v1:placeholder",
        payload: { message: { id: "m51" } },
      };
    },
    async finish(input) {
      calls.push({ finish: input });
      return true;
    },
    async cleanup() {
      return {};
    },
  };
  const result = await runWebhookDeliveryBatch({
    repository: workerRepository,
    encryptionKey: KEY,
    claimToken: LEASE_ID,
    batchSize: 10,
    decryptSecret: () => TEST_WEBHOOK_SECRET,
    deliver: async ({ payload }) => {
      assert.deepEqual(payload, {
        update_id: 51,
        message: { id: "m51" },
      });
      return {
        kind: "retry",
        errorCode: "http_server_error",
        httpStatus: 503,
      };
    },
  });
  assert.deepEqual(result, { claimed: 1, delivered: 0, retried: 1, deadLettered: 0 });
  assert.deepEqual(calls, [
    {
      prepare: {
        attemptId: 17,
        claimToken: LEASE_ID,
        webhookEpoch: 4,
      },
    },
    {
      finish: {
        attemptId: 17,
        claimToken: LEASE_ID,
        status: "retry",
        errorCode: "http_server_error",
        httpStatus: 503,
      },
    },
  ]);
});

test("worker skips claims invalidated by webhook replacement before dispatch", async () => {
  let delivered = 0;
  const workerRepository: WebhookWorkerRepository = {
    async claim() {
      return [
        {
          attemptId: 18,
          botId: BOT_ID,
          updateId: 52,
          attemptCount: 1,
          webhookEpoch: 5,
        },
      ];
    },
    async prepare() {
      return null;
    },
    async finish() {
      throw new Error("invalidated claims are already finalized by SQL");
    },
    async cleanup() {
      return {};
    },
  };
  const result = await runWebhookDeliveryBatch({
    repository: workerRepository,
    encryptionKey: KEY,
    claimToken: LEASE_ID,
    batchSize: 10,
    decryptSecret: () => "unused",
    deliver: async () => {
      delivered += 1;
      return { kind: "delivered", errorCode: null, httpStatus: 204 };
    },
  });
  assert.equal(delivered, 0);
  assert.deepEqual(result, { claimed: 1, delivered: 0, retried: 0, deadLettered: 0 });
});

test("a never-settling resolver cannot block later claims in the sequential worker batch", async () => {
  const finished: Array<{ attemptId: number; status: string; errorCode: string | null }> = [];
  const workerRepository: WebhookWorkerRepository = {
    async claim() {
      return [
        {
          attemptId: 19,
          botId: BOT_ID,
          updateId: 53,
          attemptCount: 1,
          webhookEpoch: 6,
        },
        {
          attemptId: 20,
          botId: "33333333-3333-4333-8333-333333333333",
          updateId: 54,
          attemptCount: 1,
          webhookEpoch: 1,
        },
      ];
    },
    async prepare({ attemptId }) {
      return {
        targetUrl:
          attemptId === 19
            ? "https://hooks.example.test/stuck"
            : "https://hooks.example.test/ready",
        secretCiphertext: "enc:v1:placeholder",
        payload: { message: { attemptId } },
      };
    },
    async finish(input) {
      finished.push({
        attemptId: input.attemptId,
        status: input.status,
        errorCode: input.errorCode,
      });
      return true;
    },
    async cleanup() {
      return {};
    },
  };

  const startedAt = Date.now();
  const result = await runWebhookDeliveryBatch({
    repository: workerRepository,
    encryptionKey: KEY,
    claimToken: LEASE_ID,
    batchSize: 10,
    decryptSecret: () => TEST_WEBHOOK_SECRET,
    deliver: async (request) =>
      deliverWebhook({
        ...request,
        perHopTimeoutMs: 30,
        resolver: request.url.endsWith("/stuck")
          ? async () => await new Promise<never>(() => undefined)
          : async () => [{ address: "93.184.216.34", family: 4 }],
        transport: async () => ({ statusCode: 204 }),
      }),
  });

  assert.ok(Date.now() - startedAt < 500);
  assert.deepEqual(result, {
    claimed: 2,
    delivered: 1,
    retried: 1,
    deadLettered: 0,
  });
  assert.deepEqual(finished, [
    { attemptId: 19, status: "retry", errorCode: "webhook_timeout" },
    { attemptId: 20, status: "delivered", errorCode: null },
  ]);
});
