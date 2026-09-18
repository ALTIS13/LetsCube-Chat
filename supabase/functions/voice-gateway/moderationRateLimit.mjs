// A bound on how fast one person can moderate a room.
//
// The audit of 2026-09-18 found no rate limiting anywhere in this gateway, and
// the client has carried a `rate_limited` category since it was written
// (`lib/voiceGateway.ts`). This is the smallest thing that closes it for the two
// moderation routes without inventing a scheme: the same shape
// `support-gateway/rateLimit.mjs` and `auth-yandex-gateway/rateLimit.mjs`
// already use — a factory, an injected clock, one `check` that both decides and
// records, and a `retryAfterSeconds` for the header.
//
// **What it does and does not bound.** It is per isolate, exactly as
// support-gateway's is, so it bounds one runtime instance rather than the
// deployment. That is honest and still worth having: it turns a held-down
// button or a scripted loop into 429s instead of into twirp calls, which is the
// cost worth stopping. A deployment-wide limit needs a table and an RPC, which
// is the `support_rate_limit_signals` pattern and a migration; it is not this.
//
// The window is deliberately generous. A moderator clearing a raid mutes
// several people in a few seconds and must not be told to wait, so the limit is
// set where a human cannot reach it and a loop reaches it at once.

/** Twenty actions a minute per person: above any hand, below any script. */
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 20;
/**
 * A cap on how many callers are remembered, so a long-lived isolate cannot grow
 * a map without end. Support's per-session map has no such cap; this one prunes
 * the callers whose whole history has aged out before it refuses to grow.
 */
const DEFAULT_MAX_CALLERS = 2_000;

export function createVoiceModerationRateLimiter(options = {}) {
  const now = options.now ?? Date.now;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const maxCallers = options.maxCallers ?? DEFAULT_MAX_CALLERS;
  const history = new Map();

  return {
    /**
     * One action by one caller. `{ ok: true }` records it; a refusal records
     * nothing, so a caller being refused cannot push their own window forward
     * and lock themselves out for longer than the window.
     */
    check(callerId) {
      const key = typeof callerId === "string" ? callerId : String(callerId ?? "");
      const timestamp = now();
      const active = (history.get(key) ?? []).filter(
        (at) => timestamp - at < windowMs,
      );

      if (active.length >= limit) {
        history.set(key, active);
        return {
          ok: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((active[0] + windowMs - timestamp) / 1_000),
          ),
        };
      }

      active.push(timestamp);
      history.set(key, active);
      if (history.size > maxCallers) {
        for (const [entry, times] of history) {
          if (entry !== key && times.every((at) => timestamp - at >= windowMs)) {
            history.delete(entry);
          }
        }
      }
      return { ok: true };
    },
  };
}
