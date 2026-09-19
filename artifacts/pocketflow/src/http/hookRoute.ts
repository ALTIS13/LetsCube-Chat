import type { IncomingMessage } from "node:http";

import type { Request, RequestHandler, Response } from "express";

import { buildEventCard } from "#pf/lib/eventCard";
import type { Logger } from "#pf/lib/logger";
import type { Db } from "#pf/store/db";
import {
  asWebhookId,
  claimEvent,
  getWebhook,
  normalizeEventKey,
  recordDelivery,
  releaseEvent,
  verifySecret,
  type Webhook,
} from "#pf/store/webhooks";
import type { BotTransport } from "#pf/transport/types";

/**
 * `POST /hook/<id>` — the generic webhook inbox (§5).
 *
 * Anything that can make an HTTP request can use this: GitHub, Grafana, Uptime
 * Kuma, a cron script with `curl`. That is the feature, and it is also the
 * threat model, because the address is on the public internet and the body is
 * written by somebody else's software.
 *
 * The order of the checks below is the design, so it is worth stating why it is
 * this order and not another:
 *
 *   1. **rate limit first**, before the database and before the KDF. Every
 *      later step costs something an attacker would like to spend on our
 *      behalf — a query, 16 MiB of scrypt, a message into somebody's chat.
 *   2. **identify, then authenticate, then read**. The body is not touched
 *      until the secret has been verified, so an unauthenticated peer cannot
 *      make this process hold a megabyte of their data.
 *   3. **bound the body**, and refuse rather than truncate. A body cut in half
 *      is not JSON, and «parse whatever arrived» is how a partial payload
 *      becomes a confident wrong card.
 *   4. **claim, deliver, release on failure.** The idempotency key is claimed
 *      before the send and released if the send throws, which makes the
 *      guarantee at-least-once: a sender that retries after our gateway was
 *      down still gets through.
 *
 * **Why no secret in the URL.** §5 asks for `Authorization: Bearer` or a
 * dedicated header, preferred over a secret in the URL, and this route
 * therefore accepts *only* the two headers. A query parameter is not a lesser
 * option, it is a different one: URLs are written to access logs, proxy logs
 * and browser history by default, and a credential that lives there is a
 * credential that leaks without anybody doing anything wrong.
 */

export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/** The dedicated header, for senders that cannot set `Authorization`. */
export const HOOK_SECRET_HEADER = "x-pocketflow-secret";

/**
 * Where this route is mounted, and the address a person is shown.
 *
 * Both live here rather than in `http/server.ts` so that the management screen
 * cannot print an address the server does not serve: one constant, one
 * builder, and a rename that misses a caller fails to compile.
 */
export const HOOK_ROUTE_PATH = "/hook/:id";

export function hookUrl(publicBaseUrl: string, id: string): string {
  return `${publicBaseUrl.replace(/\/+$/, "")}/hook/${id}`;
}

/**
 * Headers a sender uses to say «this is the same event you already saw».
 *
 * `Idempotency-Key` is the general one; the other three are what the common
 * senders actually put on a retry. A header is preferred over anything in the
 * body because it is the sender's own statement about delivery rather than our
 * guess about their data model.
 */
export const EVENT_KEY_HEADERS = [
  "idempotency-key",
  "x-idempotency-key",
  "x-event-id",
  "x-github-delivery",
] as const;

/**
 * Body fields accepted as an event id when no header carried one.
 *
 * A bare `id` is deliberately **not** in this list. In most payloads it is the
 * id of the *object* — the monitor, the alert rule, the repository — not of the
 * delivery, so deduplicating on it would swallow every later event from the
 * same source for as long as the retention window lasts. That is a silent
 * failure, and a silent failure in a notification pipeline is the worst kind.
 */
export const EVENT_KEY_FIELDS = [
  "event_id",
  "eventId",
  "delivery_id",
  "deliveryId",
  "idempotency_key",
  "idempotencyKey",
] as const;

export type RateLimitDecision = { allowed: boolean; retryAfterSeconds: number };

export type RateLimiter = { take(key: string): RateLimitDecision };

/**
 * A token bucket, in memory, per process.
 *
 * Stated plainly because it matters operationally: PocketFlow runs as one
 * process, so this is the whole limiter. A second replica would need a shared
 * one, and the honest place to learn that is here rather than after an
 * incident.
 *
 * `maxKeys` bounds the map so that a scan of random ids cannot grow it without
 * limit. Eviction is oldest-touched first, and it is why there are two
 * limiters in this route rather than one: evicting a key hands its bucket back
 * full, so the per-id limit alone could be reset by churning ids. The global
 * limiter is not evictable and is what actually bounds that.
 */
export function createRateLimiter(options: {
  capacity: number;
  refillPerMinute: number;
  maxKeys?: number;
  now?: () => number;
}): RateLimiter {
  const capacity = Math.max(1, options.capacity);
  const perSecond = Math.max(options.refillPerMinute, 1) / 60;
  const maxKeys = options.maxKeys ?? 5000;
  const now = options.now ?? (() => Date.now());
  const buckets = new Map<string, { tokens: number; updatedAt: number }>();

  return {
    take(key) {
      const at = now();
      const existing = buckets.get(key);
      const bucket = existing ?? { tokens: capacity, updatedAt: at };
      if (existing) {
        const elapsedSeconds = Math.max(0, (at - bucket.updatedAt) / 1000);
        bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSeconds * perSecond);
        bucket.updatedAt = at;
        // Re-inserted so the map's iteration order tracks recency, which is
        // what makes the eviction below «oldest first» rather than arbitrary.
        buckets.delete(key);
      }
      let decision: RateLimitDecision;
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        decision = { allowed: true, retryAfterSeconds: 0 };
      } else {
        decision = {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) / perSecond)),
        };
      }
      buckets.set(key, bucket);
      while (buckets.size > maxKeys) {
        const oldest = buckets.keys().next();
        if (oldest.done) break;
        buckets.delete(oldest.value);
      }
      return decision;
    },
  };
}

export type BoundedBody =
  | { ok: true; bytes: Buffer }
  | { ok: false; reason: "too_large" | "aborted" };

/**
 * Reads at most `limit` bytes, and refuses the rest rather than truncating it.
 *
 * `Content-Length` is checked first when the sender offered one — refusing
 * before the transfer is cheaper for both sides — but it is not trusted: the
 * running total is what actually enforces the bound, because a chunked request
 * has no length to check and a lying one is trivial to send.
 */
export async function readBoundedBody(
  request: IncomingMessage,
  limit: number,
): Promise<BoundedBody> {
  const declared = Number(request.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) return { ok: false, reason: "too_large" };

  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      total += buffer.length;
      if (total > limit) return { ok: false, reason: "too_large" };
      chunks.push(buffer);
    }
  } catch {
    // A client that hung up mid-body. There is nothing to answer and nothing
    // to log beyond the fact, which the caller does.
    return { ok: false, reason: "aborted" };
  }
  return { ok: true, bytes: Buffer.concat(chunks) };
}

function headerValue(request: Request, name: string): string | null {
  const raw = request.headers[name];
  // A duplicated credential header arrives joined with a comma and is never
  // something a correct sender does; refusing is safer than guessing which
  // half was meant.
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value.length > 0 ? value : null;
}

/** `Authorization: Bearer <secret>`, or the dedicated header. Never the URL. */
export function presentedSecret(request: Request): string | null {
  const authorization = headerValue(request, "authorization");
  if (authorization !== null) {
    const match = /^Bearer[ ]+(\S+)$/i.exec(authorization);
    if (match?.[1]) return match[1];
  }
  return headerValue(request, HOOK_SECRET_HEADER);
}

function isJsonContentType(value: string | null): boolean {
  if (value === null) return false;
  const type = value.split(";")[0]?.trim().toLowerCase() ?? "";
  return type === "application/json" || type.endsWith("+json");
}

export type ParsedBody =
  | { ok: true; body: unknown }
  | { ok: false; reason: "empty" | "invalid_json" };

/**
 * JSON when it is JSON, text when it is not.
 *
 * The text arm is not a fallback nobody uses: `curl -d 'диск заполнен'` from a
 * cron job is exactly the sender §5 names, and answering it with 400 because
 * it did not send an object would make the simplest case the one that does not
 * work. A body that *claims* to be JSON and is not is still an error, because
 * there the sender told us what to expect.
 */
export function parseHookBody(bytes: Buffer, contentType: string | null): ParsedBody {
  const text = bytes.toString("utf8");
  if (text.trim().length === 0) return { ok: false, reason: "empty" };
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    if (isJsonContentType(contentType)) return { ok: false, reason: "invalid_json" };
    return { ok: true, body: text };
  }
}

/** The sender's own idempotency key, or null when they did not offer one. */
export function eventKeyFor(request: Request, body: unknown): string | null {
  for (const name of EVENT_KEY_HEADERS) {
    const value = headerValue(request, name);
    if (value !== null) return normalizeEventKey(value);
  }
  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    for (const field of EVENT_KEY_FIELDS) {
      const value = record[field];
      if (typeof value === "string" || typeof value === "number") {
        return normalizeEventKey(String(value));
      }
    }
  }
  return null;
}

function fail(response: Response, status: number, code: string, message: string): void {
  response.status(status).json({ ok: false, error: { code, message } });
}

export type HookRouteDeps = {
  db: Db;
  bot: Pick<BotTransport, "sendText">;
  log: Logger;
  maxBodyBytes?: number;
  /** Per webhook id. Defaults to a burst of 20 and one every three seconds. */
  perWebhookLimiter?: RateLimiter;
  /** Across every caller. Defaults to 300 a minute. */
  globalLimiter?: RateLimiter;
};

export function createHookRoute(deps: HookRouteDeps): RequestHandler {
  const maxBodyBytes = deps.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const perWebhook =
    deps.perWebhookLimiter ?? createRateLimiter({ capacity: 20, refillPerMinute: 20 });
  const global = deps.globalLimiter ?? createRateLimiter({ capacity: 300, refillPerMinute: 300 });

  return async function hookRoute(request: Request, response: Response): Promise<void> {
    const log = deps.log.with({ route: "hook" });
    try {
      const globalDecision = global.take("all");
      if (!globalDecision.allowed) {
        response.setHeader("Retry-After", String(globalDecision.retryAfterSeconds));
        fail(response, 429, "rate_limited", "too many webhook deliveries");
        return;
      }

      const id = asWebhookId(String(request.params.id ?? ""));
      if (id === null) {
        fail(response, 404, "unknown_webhook", "no such webhook");
        return;
      }

      const decision = perWebhook.take(id);
      if (!decision.allowed) {
        response.setHeader("Retry-After", String(decision.retryAfterSeconds));
        fail(response, 429, "rate_limited", "too many deliveries for this webhook");
        return;
      }

      const webhook: Webhook | null = await getWebhook(deps.db, id);
      if (webhook === null) {
        fail(response, 404, "unknown_webhook", "no such webhook");
        return;
      }

      const secret = presentedSecret(request);
      if (secret === null) {
        response.setHeader("WWW-Authenticate", 'Bearer realm="pocketflow"');
        fail(
          response,
          401,
          "missing_secret",
          `send the secret as "Authorization: Bearer <secret>" or "${HOOK_SECRET_HEADER}: <secret>"`,
        );
        return;
      }
      if (!(await verifySecret(secret, webhook.secretHash))) {
        // The id is logged, the secret never is — not even its length, which
        // is why this line carries no field for it at all.
        log.warn("hook.bad_secret", { webhook_id: webhook.id });
        fail(response, 401, "bad_secret", "secret rejected");
        return;
      }

      // Checked after the secret so that «does this webhook exist and is it
      // switched off» is not a question an unauthenticated caller can ask.
      if (!webhook.enabled) {
        fail(response, 403, "webhook_disabled", "this webhook is disabled");
        return;
      }

      const bounded = await readBoundedBody(request, maxBodyBytes);
      if (!bounded.ok) {
        if (bounded.reason === "too_large") {
          fail(response, 413, "body_too_large", `body must be at most ${maxBodyBytes} bytes`);
        } else {
          fail(response, 400, "aborted", "the request body did not arrive");
        }
        return;
      }

      const parsed = parseHookBody(bounded.bytes, headerValue(request, "content-type"));
      if (!parsed.ok) {
        fail(
          response,
          400,
          parsed.reason === "empty" ? "empty_body" : "invalid_json",
          parsed.reason === "empty" ? "the body was empty" : "the body is not valid JSON",
        );
        return;
      }

      const eventKey = eventKeyFor(request, parsed.body);
      if (eventKey !== null) {
        const first = await claimEvent(deps.db, webhook.id, eventKey);
        if (!first) {
          log.info("hook.duplicate", { webhook_id: webhook.id });
          response.status(200).json({ ok: true, duplicate: true });
          return;
        }
      }

      const card = buildEventCard({ sourceName: webhook.displayName, body: parsed.body });
      try {
        await deps.bot.sendText({ chatId: webhook.chatId, text: card });
      } catch (error) {
        // The claim is released so a retry is not swallowed as a duplicate.
        if (eventKey !== null) await releaseEvent(deps.db, webhook.id, eventKey);
        log.error("hook.delivery_failed", {
          webhook_id: webhook.id,
          error: error instanceof Error ? error.message : "unknown",
        });
        response.setHeader("Retry-After", "30");
        fail(response, 502, "delivery_failed", "could not deliver the event; retry later");
        return;
      }

      await recordDelivery(deps.db, webhook.id);
      log.info("hook.delivered", {
        webhook_id: webhook.id,
        bytes: bounded.bytes.length,
        deduplicated: eventKey !== null,
      });
      response.status(200).json({ ok: true });
    } catch (error) {
      log.error("hook.failed", { error: error instanceof Error ? error.message : "unknown" });
      if (!response.headersSent) {
        fail(response, 500, "internal_error", "the webhook could not be processed");
      }
    }
  };
}
