export function createSupportRateLimiter(options = {}) {
  const now = options.now ?? Date.now;
  const shortWindowMs = options.shortWindowMs ?? 15 * 60 * 1_000;
  const shortLimit = options.shortLimit ?? 3;
  const dailyWindowMs = options.dailyWindowMs ?? 24 * 60 * 60 * 1_000;
  const dailyLimit = options.dailyLimit ?? 10;
  const messageWindowMs = options.messageWindowMs ?? 60 * 1_000;
  const messageLimit = options.messageLimit ?? 20;
  let tickets = [];
  const messages = new Map();

  return {
    checkTicket(signal) {
      const timestamp = now();
      tickets = tickets.filter((entry) => timestamp - entry.at < dailyWindowMs);

      const matching = (entry) =>
        sameNonEmpty(entry.ipHash, signal.ipHash) ||
        sameNonEmpty(entry.emailHash, signal.emailHash) ||
        sameNonEmpty(entry.phoneHash, signal.phoneHash);
      const shortMatches = tickets.filter(
        (entry) => timestamp - entry.at < shortWindowMs && matching(entry),
      );
      if (shortMatches.length >= shortLimit) {
        return blocked(shortMatches[0].at + shortWindowMs - timestamp);
      }

      const dailyMatches = tickets.filter(matching);
      if (dailyMatches.length >= dailyLimit) {
        return blocked(dailyMatches[0].at + dailyWindowMs - timestamp);
      }

      tickets.push({ ...signal, at: timestamp });
      return { ok: true };
    },

    checkMessage(sessionHash) {
      const timestamp = now();
      const active = (messages.get(sessionHash) ?? []).filter(
        (entry) => timestamp - entry < messageWindowMs,
      );
      if (active.length >= messageLimit) {
        messages.set(sessionHash, active);
        return blocked(active[0] + messageWindowMs - timestamp);
      }
      active.push(timestamp);
      messages.set(sessionHash, active);
      return { ok: true };
    },
  };
}

function sameNonEmpty(left, right) {
  return Boolean(left && right && left === right);
}

function blocked(remainingMs) {
  return {
    ok: false,
    retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1_000)),
  };
}
