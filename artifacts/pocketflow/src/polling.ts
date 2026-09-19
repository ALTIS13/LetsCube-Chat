import type { AppContext } from "#pf/app/context";
import type { Router } from "#pf/app/router";
import { highestProcessedUpdateId } from "#pf/store/updates";
import { TransportError } from "#pf/transport/types";

/**
 * The long-poll loop.
 *
 * Simple to run locally, which is what §18 asks of it, and correct about the
 * two things that are easy to get wrong:
 *
 * **The offset.** `getUpdates(offset)` means «everything below this is
 * acknowledged, give me the rest» — read off the platform's own query, which
 * returns `update_id >= offset` and retires `update_id < offset`. So the next
 * offset is the highest id seen **plus one**, and starting a fresh process
 * from `highestProcessedUpdateId() + 1` rather than from 0 avoids re-reading
 * the whole retained queue after every restart. (Re-reading would be handled
 * correctly by `claimUpdate`, but it would be a pointless storm.)
 *
 * **Failure.** A loop that dies on the first network hiccup is a bot that
 * stops until somebody notices. Everything retries with a bounded backoff, and
 * a rate limit is honoured rather than fought.
 */

export type PollingLoop = {
  start(): void;
  stop(): Promise<void>;
};

const MAX_BACKOFF_MS = 30_000;

export function createPollingLoop(
  ctx: AppContext,
  router: Router,
  options?: { timeoutSeconds?: number; limit?: number },
): PollingLoop {
  const timeoutSeconds = options?.timeoutSeconds ?? 25;
  const limit = options?.limit ?? 50;
  let running = false;
  let settled: Promise<void> | null = null;
  const controller = new AbortController();

  async function loop(): Promise<void> {
    let offset = (await highestProcessedUpdateId(ctx.db)) + 1;
    let failures = 0;
    ctx.log.info("polling.start", { offset });

    while (running) {
      try {
        const updates = await ctx.bot.getUpdates({
          offset,
          limit,
          timeoutSeconds,
          signal: controller.signal,
        });
        failures = 0;
        for (const update of updates) {
          // The offset advances even when handling throws. The update itself
          // is not lost — `router.handle` releases its claim on failure, and
          // the platform keeps it queued until acknowledged — but a handler
          // that throws on every attempt must not wedge the loop on one
          // message while everybody else's messages wait behind it.
          offset = Math.max(offset, update.updateId + 1);
          try {
            await router.handle(ctx, update);
          } catch (error) {
            ctx.log.error("polling.handler_failed", {
              update_id: update.updateId,
              error: error instanceof Error ? error.message : "unknown",
            });
          }
        }
      } catch (error) {
        if (!running) break;
        failures += 1;
        const retryAfter =
          error instanceof TransportError && error.retryAfterSeconds !== null
            ? error.retryAfterSeconds * 1000
            : Math.min(2 ** Math.min(failures, 5) * 500, MAX_BACKOFF_MS);
        ctx.log.warn("polling.failed", {
          error: error instanceof Error ? error.message : "unknown",
          retry_in_ms: retryAfter,
          consecutive: failures,
        });
        await new Promise((resolve) => setTimeout(resolve, retryAfter));
      }
    }
    ctx.log.info("polling.stopped");
  }

  return {
    start() {
      if (running) return;
      running = true;
      settled = loop();
    },
    async stop() {
      running = false;
      // Aborting the in-flight long poll is what makes shutdown prompt rather
      // than up to `timeoutSeconds` late — §19 asks for a graceful shutdown,
      // and one that takes half a minute is not one in practice.
      controller.abort();
      await settled?.catch(() => undefined);
    },
  };
}
