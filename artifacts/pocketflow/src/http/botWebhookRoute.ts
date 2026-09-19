import { createHash, timingSafeEqual } from "node:crypto";

import type { Request, RequestHandler, Response } from "express";

import { readBoundedBody } from "#pf/http/hookRoute";
import type { Logger } from "#pf/lib/logger";
import { LETSCUBE_WEBHOOK_SECRET_HEADER } from "#pf/transport/letscube";
import type { BotTransport, Update } from "#pf/transport/types";

/**
 * The platform's own webhook: where updates arrive when `TRANSPORT=webhook`.
 *
 * This is not the inbox in `hookRoute.ts` and confusing the two would be a
 * security bug rather than a naming problem. That one is public, one row per
 * sender, one secret per row, and it is *for* strangers. This one has exactly
 * one caller — the LETSCUBE gateway — and one shared secret, the
 * `secret_token` given to `setWebhook`, which the gateway returns in
 * `LETSCUBE_WEBHOOK_SECRET_HEADER` on every delivery.
 *
 * **Answer fast, work afterwards.** The gateway treats a slow or failed
 * response as a failed delivery and retries it, so handling an update inside
 * the request would turn one slow database query into a redelivery storm and,
 * with it, a duplicate of every side effect. The handler therefore runs after
 * the response is sent, and idempotency is `store/updates.ts`'s job — which is
 * where it belongs, because the polling transport needs exactly the same
 * protection and has no HTTP response to hide behind.
 *
 * The one thing that is *not* deferred is authentication. An unauthenticated
 * caller never reaches the body, never reaches the parser and never reaches
 * the queue.
 */

export const BOT_UPDATE_MAX_BODY_BYTES = 256 * 1024;

/**
 * How many updates may be in flight before the route pushes back.
 *
 * A 429 here is not a failure, it is the backpressure signal the platform is
 * designed to understand: it will redeliver. Accepting without bound would
 * trade a visible delay for an invisible memory problem.
 */
export const DEFAULT_MAX_IN_FLIGHT = 100;

/**
 * Constant-time comparison that also hides the expected length.
 *
 * `timingSafeEqual` throws on unequal lengths, and the usual workaround — a
 * length check first — leaks the length of the secret. Hashing both sides to
 * 32 bytes removes both problems and costs a SHA-256 on a value that is
 * already in memory.
 */
export function secretMatches(presented: string | null, expected: string): boolean {
  if (presented === null) return false;
  const a = createHash("sha256").update(presented, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

export type BotWebhookRoute = {
  handle: RequestHandler;
  /** Resolves when every update accepted so far has finished. For shutdown. */
  drain(): Promise<void>;
  inFlight(): number;
};

export type BotWebhookRouteDeps = {
  bot: Pick<BotTransport, "parseWebhookUpdate">;
  log: Logger;
  /** The same value passed to `setWebhook` as `secret_token`. */
  secret: string;
  /** Where an accepted update goes. Runs after the response, never inside it. */
  onUpdate: (update: Update) => void | Promise<void>;
  maxBodyBytes?: number;
  maxInFlight?: number;
  secretHeader?: string;
};

export function createBotWebhookRoute(deps: BotWebhookRouteDeps): BotWebhookRoute {
  const maxBodyBytes = deps.maxBodyBytes ?? BOT_UPDATE_MAX_BODY_BYTES;
  const maxInFlight = deps.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT;
  const header = (deps.secretHeader ?? LETSCUBE_WEBHOOK_SECRET_HEADER).toLowerCase();
  const pending = new Set<Promise<void>>();

  function run(update: Update, log: Logger): void {
    const task = (async () => {
      try {
        await deps.onUpdate(update);
      } catch (error) {
        // The response has already been sent, so this cannot be reported to
        // the platform. It has to be visible here or it is not visible at all.
        log.error("bot_webhook.handler_failed", {
          update_id: update.updateId,
          kind: update.kind,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    })();
    pending.add(task);
    void task.finally(() => pending.delete(task));
  }

  const handle: RequestHandler = async (request: Request, response: Response): Promise<void> => {
    const log = deps.log.with({ route: "bot_webhook" });
    try {
      const raw = request.headers[header];
      const presented = typeof raw === "string" && raw.length > 0 ? raw : null;
      if (!secretMatches(presented, deps.secret)) {
        // No detail in the body and no detail in the log: a wrong secret and a
        // missing one are the same answer to whoever is asking.
        log.warn("bot_webhook.unauthorized");
        response.status(401).json({ ok: false, error: { code: "unauthorized" } });
        return;
      }

      if (pending.size >= maxInFlight) {
        log.warn("bot_webhook.busy", { in_flight: pending.size });
        response.setHeader("Retry-After", "5");
        response.status(429).json({ ok: false, error: { code: "busy" } });
        return;
      }

      const bounded = await readBoundedBody(request, maxBodyBytes);
      if (!bounded.ok) {
        log.warn("bot_webhook.body_rejected", { reason: bounded.reason });
        response
          .status(bounded.reason === "too_large" ? 413 : 400)
          .json({ ok: false, error: { code: bounded.reason } });
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(bounded.bytes.toString("utf8")) as unknown;
      } catch {
        // 400 rather than 200: a body that is not JSON will never become JSON
        // on a retry, and telling the platform so is more useful than
        // pretending it was handled.
        log.warn("bot_webhook.invalid_json");
        response.status(400).json({ ok: false, error: { code: "invalid_json" } });
        return;
      }

      // The adapter owns the wire format, including the decision that an
      // unreadable update becomes `unsupported` rather than an exception — so
      // this route has no parsing of its own to get wrong.
      const update = deps.bot.parseWebhookUpdate(payload);

      response.status(200).json({ ok: true });
      run(update, log);
    } catch (error) {
      log.error("bot_webhook.failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
      if (!response.headersSent) {
        response.status(500).json({ ok: false, error: { code: "internal_error" } });
      }
    }
  };

  return {
    handle,
    inFlight: () => pending.size,
    async drain() {
      // Settled rather than all: a handler that threw has already been logged,
      // and shutdown must not become the place where that error resurfaces.
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
  };
}
