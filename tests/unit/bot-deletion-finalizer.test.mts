import assert from "node:assert/strict";
import test from "node:test";

import {
  createBotDeletionFinalizerRepository,
  runBotDeletionFinalizerBatch,
} from "../../artifacts/api-server/src/bot/deletionFinalizer.ts";

test("deletion finalizer calls only the bounded service-role RPC", async () => {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const repository = createBotDeletionFinalizerRepository({
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: 2, error: null };
    },
  });

  const finalized = await runBotDeletionFinalizerBatch({
    repository,
    batchSize: 25,
    requestId: "deletion-finalizer-test",
  });

  assert.equal(finalized, 2);
  assert.deepEqual(calls, [
    {
      name: "bot_deletion_finalize_internal",
      args: { p_limit: 25, p_request_id: "deletion-finalizer-test" },
    },
  ]);
});

test("deletion finalizer fails closed on malformed RPC results", async () => {
  const repository = createBotDeletionFinalizerRepository({
    async rpc() {
      return { data: "2", error: null };
    },
  });

  await assert.rejects(
    runBotDeletionFinalizerBatch({
      repository,
      batchSize: 25,
      requestId: "deletion-finalizer-test",
    }),
    /bot_deletion_finalizer_rpc_invalid/,
  );
});
