import { randomUUID } from "node:crypto";

import type { BotRpcClient, BotRpcResult } from "#bot/repository";

const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

export interface BotDeletionFinalizerRepository {
  finalize(input: { limit: number; requestId: string }): Promise<number>;
}

export function createBotDeletionFinalizerRepository(
  client: BotRpcClient,
): BotDeletionFinalizerRepository {
  return {
    async finalize(input) {
      let response: BotRpcResult;
      try {
        response = await client.rpc("bot_deletion_finalize_internal", {
          p_limit: input.limit,
          p_request_id: input.requestId,
        });
      } catch {
        throw new Error("bot_deletion_finalizer_rpc_failed");
      }
      if (response.error) throw new Error("bot_deletion_finalizer_rpc_failed");
      if (
        typeof response.data !== "number" ||
        !Number.isSafeInteger(response.data) ||
        response.data < 0 ||
        response.data > input.limit
      ) {
        throw new Error("bot_deletion_finalizer_rpc_invalid");
      }
      return response.data;
    },
  };
}

export async function runBotDeletionFinalizerBatch(input: {
  repository: BotDeletionFinalizerRepository;
  batchSize: number;
  requestId: string;
}): Promise<number> {
  if (
    !Number.isSafeInteger(input.batchSize) ||
    input.batchSize < 1 ||
    input.batchSize > 100 ||
    !REQUEST_ID_RE.test(input.requestId)
  ) {
    throw new Error("bot_deletion_finalizer_input_invalid");
  }
  return input.repository.finalize({
    limit: input.batchSize,
    requestId: input.requestId,
  });
}

export function createBotDeletionFinalizerRuntime(input: {
  repository: BotDeletionFinalizerRepository;
  intervalMs?: number;
  batchSize?: number;
  requestId?: () => string;
}): { start(): void; stop(): void } {
  const intervalMs = input.intervalMs ?? 60_000;
  const batchSize = input.batchSize ?? 50;
  const requestId = input.requestId ?? randomUUID;
  let stopped = true;
  let running = false;
  let timer: NodeJS.Timeout | undefined;

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(() => void tick(), intervalMs);
    timer.unref();
  };
  const tick = async (): Promise<void> => {
    if (stopped || running) return;
    running = true;
    try {
      await runBotDeletionFinalizerBatch({
        repository: input.repository,
        batchSize,
        requestId: requestId(),
      });
    } catch {
      // The next bounded pass retries rows that remain due.
    } finally {
      running = false;
      schedule();
    }
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      void tick();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
