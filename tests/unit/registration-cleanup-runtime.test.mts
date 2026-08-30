import assert from "node:assert/strict";
import test from "node:test";

import {
  createRegistrationCleanupWorkerRuntime,
  registrationCleanupHealthPayload,
} from "../../artifacts/api-server/src/workers/registrationCleanupWorker.ts";

const success = { claimed: 2, reported: 2, deleted: 0, skipped: 0, failed: 0 };

function runtime({
  enabled = false,
  reportOnly = true,
  result = success,
}: {
  enabled?: boolean;
  reportOnly?: boolean;
  result?: typeof success | null;
} = {}) {
  const timestamps = [
    new Date("2026-08-30T10:00:00.000Z"),
    new Date("2026-08-30T10:00:01.000Z"),
    new Date("2026-08-30T10:00:02.000Z"),
  ];
  return createRegistrationCleanupWorkerRuntime({
    readConfig: () => ({
      enabled,
      reportOnly,
      batchSize: 50,
      intervalMs: 3_600_000,
    }),
    createRepository: async () => ({}),
    runBatch: async () => result,
    now: () => timestamps.shift() ?? new Date("2026-08-30T10:00:03.000Z"),
    schedule: () => undefined,
  });
}

function scheduledRuntime(results: Array<typeof success | null>) {
  const callbacks: Array<() => void> = [];
  const timestamps = [
    new Date("2026-08-30T10:00:00.000Z"),
    new Date("2026-08-30T10:00:01.000Z"),
    new Date("2026-08-30T10:00:02.000Z"),
    new Date("2026-08-30T10:00:03.000Z"),
  ];
  const worker = createRegistrationCleanupWorkerRuntime({
    readConfig: () => ({
      enabled: true,
      reportOnly: true,
      batchSize: 50,
      intervalMs: 3_600_000,
    }),
    createRepository: async () => ({}),
    runBatch: async () => results.shift() ?? null,
    now: () => timestamps.shift() ?? new Date("2026-08-30T10:00:04.000Z"),
    schedule: (callback) => callbacks.push(callback),
  });
  return { callbacks, worker };
}

test("disabled default records effective configuration without attempting a batch", async () => {
  const worker = runtime();

  await worker.start({});

  assert.deepEqual(worker.status(), {
    configured: true,
    enabled: false,
    reportOnly: true,
    lastRunAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastResult: null,
  });
});

test("enabled report-only worker exposes a successful aggregate run", async () => {
  const worker = runtime({ enabled: true, reportOnly: true });

  await worker.start({});

  assert.deepEqual(worker.status(), {
    configured: true,
    enabled: true,
    reportOnly: true,
    lastRunAt: "2026-08-30T10:00:00.000Z",
    lastSuccessAt: "2026-08-30T10:00:01.000Z",
    lastFailureAt: null,
    lastResult: success,
  });
});

test("claim failure records failure without a successful aggregate", async () => {
  const worker = runtime({ enabled: true, result: null });

  await worker.start({});

  const status = worker.status();
  assert.equal(status.lastRunAt, "2026-08-30T10:00:00.000Z");
  assert.equal(status.lastSuccessAt, null);
  assert.equal(status.lastFailureAt, "2026-08-30T10:00:01.000Z");
  assert.equal(status.lastResult, null);
});

test("a batch with bounded RPC failures is not recorded as a successful run", async () => {
  const worker = runtime({
    enabled: true,
    result: { claimed: 1, reported: 0, deleted: 0, skipped: 0, failed: 1 },
  });

  await worker.start({});

  const status = worker.status();
  assert.equal(status.lastSuccessAt, null);
  assert.equal(status.lastFailureAt, "2026-08-30T10:00:01.000Z");
  assert.deepEqual(status.lastResult, {
    claimed: 1,
    reported: 0,
    deleted: 0,
    skipped: 0,
    failed: 1,
  });
});

test("a scheduled failure clears the prior successful attempt evidence", async () => {
  const { callbacks, worker } = scheduledRuntime([success, null]);

  await worker.start({});
  callbacks.shift()?.();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(worker.status(), {
    configured: true,
    enabled: true,
    reportOnly: true,
    lastRunAt: "2026-08-30T10:00:02.000Z",
    lastSuccessAt: null,
    lastFailureAt: "2026-08-30T10:00:03.000Z",
    lastResult: null,
  });
});

test("a scheduled success clears the prior failed attempt evidence", async () => {
  const { callbacks, worker } = scheduledRuntime([null, success]);

  await worker.start({});
  callbacks.shift()?.();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(worker.status(), {
    configured: true,
    enabled: true,
    reportOnly: true,
    lastRunAt: "2026-08-30T10:00:02.000Z",
    lastSuccessAt: "2026-08-30T10:00:03.000Z",
    lastFailureAt: null,
    lastResult: success,
  });
});

test("health projection exposes only configured state, timestamps and aggregate counts", () => {
  const payload = registrationCleanupHealthPayload({
    configured: true,
    enabled: true,
    reportOnly: true,
    lastRunAt: "2026-08-30T10:00:00.000Z",
    lastSuccessAt: "2026-08-30T10:00:01.000Z",
    lastFailureAt: null,
    lastResult: { ...success, injected: "must not be exposed" },
    ignored: "must not be exposed",
  });

  assert.deepEqual(payload, {
    configured: true,
    enabled: true,
    reportOnly: true,
    lastRunAt: "2026-08-30T10:00:00.000Z",
    lastSuccessAt: "2026-08-30T10:00:01.000Z",
    lastFailureAt: null,
    lastResult: success,
  });
});
