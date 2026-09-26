import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import {
  createWebhookWorkerRepository,
  createWebhookWorkerRuntime,
  type WebhookWorkerRepository,
} from "../../artifacts/api-server/src/bot/webhookWorker.ts";

async function waitForTicks(done: Promise<void>): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      done,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("worker ticks timed out")), 2_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

test("viewer cleanup calls the bounded SQL function with the worker clock", async () => {
  const calls: unknown[] = [];
  const repository = createWebhookWorkerRepository({
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: { removed: 2 }, error: null };
    },
  });
  await repository.cleanupViewer({ now: "2026-09-26T12:00:00.000Z", limit: 1000 });
  assert.deepEqual(calls, [{ name: "bot_viewer_interface_cleanup_internal", args: { p_now: "2026-09-26T12:00:00.000Z", p_limit: 1000 } }]);
});

test("hourly worker attempts viewer cleanup even when webhook retention fails", async () => {
  const calls: string[] = [];
  let claimStarted!: () => void;
  const started = new Promise<void>((resolve) => { claimStarted = resolve; });
  const repository: WebhookWorkerRepository = {
    async cleanup() { calls.push("webhook-cleanup"); throw new Error("retention unavailable"); },
    async cleanupViewer() { calls.push("viewer-cleanup"); return { removed: 1 }; },
    async claim() { calls.push("claim"); claimStarted(); return []; },
    async prepare() { return null; },
    async recheckViewer() { return "stale"; },
    async finish() { return false; },
  };
  const runtime = createWebhookWorkerRuntime({
    repository,
    encryptionKey: randomBytes(32),
    intervalMs: 60_000,
    now: () => new Date("2026-09-26T12:00:00Z"),
  });
  runtime.start();
  try {
    await started;
    assert.deepEqual(calls, ["webhook-cleanup", "viewer-cleanup", "claim"]);
  } finally {
    runtime.stop();
  }
});

test("full viewer batches catch up one per tick while webhook claims continue", async () => {
  const calls: string[] = [];
  const viewerLimits: number[] = [];
  const results = [
    { grants_deleted: 1_000, panels_deleted: 0 },
    { grants_deleted: 0, panels_deleted: 1_000 },
    { grants_deleted: 999, panels_deleted: 999 },
  ];
  let claims = 0;
  let resolveTicks!: () => void;
  const ticks = new Promise<void>((resolve) => { resolveTicks = resolve; });
  const repository: WebhookWorkerRepository = {
    async cleanup() { calls.push("retention"); return {}; },
    async cleanupViewer(input) {
      calls.push("viewer");
      viewerLimits.push(input.limit);
      return results.shift();
    },
    async claim() {
      calls.push("claim");
      if (++claims === 4) resolveTicks();
      return [];
    },
    async prepare() { return null; },
    async recheckViewer() { return "stale"; },
    async finish() { return false; },
  };
  const runtime = createWebhookWorkerRuntime({
    repository,
    encryptionKey: randomBytes(32),
    intervalMs: 1,
    now: () => new Date("2026-09-26T12:00:00Z"),
  });
  runtime.start();
  try {
    await waitForTicks(ticks);
  } finally {
    runtime.stop();
  }

  assert.deepEqual(viewerLimits, [1_000, 1_000, 1_000]);
  assert.deepEqual(calls, [
    "retention", "viewer", "claim",
    "viewer", "claim",
    "viewer", "claim",
    "claim",
  ]);
});

test("viewer cleanup errors stop catch-up until the next hourly cleanup", async () => {
  const calls: string[] = [];
  let viewerCalls = 0;
  let claims = 0;
  let clock = Date.parse("2026-09-26T12:00:00Z");
  let resolveTicks!: () => void;
  const ticks = new Promise<void>((resolve) => { resolveTicks = resolve; });
  const repository: WebhookWorkerRepository = {
    async cleanup() { calls.push("retention"); return {}; },
    async cleanupViewer() {
      calls.push("viewer");
      if (++viewerCalls === 1) return { grants_deleted: 1_000, panels_deleted: 0 };
      if (viewerCalls === 2) throw new Error("cleanup unavailable");
      return { grants_deleted: 0, panels_deleted: 0 };
    },
    async claim() {
      calls.push("claim");
      if (++claims === 3) clock += 60 * 60 * 1_000;
      if (claims === 4) resolveTicks();
      return [];
    },
    async prepare() { return null; },
    async recheckViewer() { return "stale"; },
    async finish() { return false; },
  };
  const runtime = createWebhookWorkerRuntime({
    repository,
    encryptionKey: randomBytes(32),
    intervalMs: 1,
    now: () => new Date(clock),
  });
  runtime.start();
  try {
    await waitForTicks(ticks);
  } finally {
    runtime.stop();
  }

  assert.deepEqual(calls, [
    "retention", "viewer", "claim",
    "viewer", "claim",
    "claim",
    "retention", "viewer", "claim",
  ]);
});
