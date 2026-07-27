import assert from "node:assert/strict";
import test from "node:test";

import { createSupportRateLimiter } from "../../supabase/functions/support-gateway/rateLimit.mjs";

test("support gateway limits new tickets per identity in the short window", () => {
  let now = 1_000_000;
  const limiter = createSupportRateLimiter({ now: () => now });
  const signal = {
    ipHash: "ip-a",
    emailHash: "email-a",
    phoneHash: "phone-a",
  };

  assert.equal(limiter.checkTicket(signal).ok, true);
  assert.equal(limiter.checkTicket(signal).ok, true);
  assert.equal(limiter.checkTicket(signal).ok, true);
  const blocked = limiter.checkTicket(signal);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retryAfterSeconds, 900);

  now += 15 * 60 * 1_000 + 1;
  assert.equal(limiter.checkTicket(signal).ok, true);
});

test("support gateway enforces the daily ticket limit across changing IPs", () => {
  let now = 1_000_000;
  const limiter = createSupportRateLimiter({ now: () => now });
  for (let index = 0; index < 10; index += 1) {
    assert.equal(
      limiter.checkTicket({
        ipHash: `ip-${index}`,
        emailHash: "email-a",
        phoneHash: `phone-${index}`,
      }).ok,
      true,
    );
    now += 15 * 60 * 1_000 + 1;
  }
  assert.equal(
    limiter.checkTicket({
      ipHash: "ip-new",
      emailHash: "email-a",
      phoneHash: "phone-new",
    }).ok,
    false,
  );
});

test("support message limiter isolates sessions and prevents floods", () => {
  const limiter = createSupportRateLimiter({
    now: () => 1_000_000,
    messageLimit: 3,
    messageWindowMs: 60_000,
  });

  assert.equal(limiter.checkMessage("session-a").ok, true);
  assert.equal(limiter.checkMessage("session-a").ok, true);
  assert.equal(limiter.checkMessage("session-a").ok, true);
  assert.equal(limiter.checkMessage("session-a").ok, false);
  assert.equal(limiter.checkMessage("session-b").ok, true);
});
