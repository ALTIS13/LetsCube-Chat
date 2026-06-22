const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_EMAIL_LIMIT = 5;
const DEFAULT_IP_LIMIT = 30;

export function createAuthRateLimiter(options = {}) {
  const buckets = new Map();
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const windowMs = positiveNumber(options.windowMs, DEFAULT_WINDOW_MS);
  const emailLimit = positiveNumber(options.emailLimit, DEFAULT_EMAIL_LIMIT);
  const ipLimit = positiveNumber(options.ipLimit, DEFAULT_IP_LIMIT);

  return {
    check(input) {
      const currentTime = now();
      const action = normalizePart(input?.action);
      const email = normalizePart(input?.email);
      const ip = normalizePart(input?.ip);
      const candidates = [{ key: `email:${action}:${email}`, limit: emailLimit, reason: "email" }];
      if (ip) candidates.push({ key: `ip:${action}:${ip}`, limit: ipLimit, reason: "ip" });

      for (const candidate of candidates) {
        const timestamps = activeTimestamps(buckets.get(candidate.key), currentTime, windowMs);
        if (timestamps.length >= candidate.limit) {
          buckets.set(candidate.key, timestamps);
          return {
            ok: false,
            reason: candidate.reason,
            retryAfterSeconds: retryAfterSeconds(timestamps[0], currentTime, windowMs),
          };
        }
      }

      for (const candidate of candidates) {
        const timestamps = activeTimestamps(buckets.get(candidate.key), currentTime, windowMs);
        timestamps.push(currentTime);
        buckets.set(candidate.key, timestamps);
      }

      pruneEmptyBuckets(buckets, currentTime, windowMs);
      return { ok: true };
    },
  };
}

function activeTimestamps(value, now, windowMs) {
  const timestamps = Array.isArray(value) ? value : [];
  const since = now - windowMs;
  return timestamps.filter((timestamp) => timestamp > since);
}

function retryAfterSeconds(firstTimestamp, now, windowMs) {
  return Math.max(1, Math.ceil((firstTimestamp + windowMs - now) / 1000));
}

function pruneEmptyBuckets(buckets, now, windowMs) {
  if (buckets.size < 1000) return;
  for (const [key, timestamps] of buckets.entries()) {
    if (activeTimestamps(timestamps, now, windowMs).length === 0) buckets.delete(key);
  }
}

function normalizePart(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
