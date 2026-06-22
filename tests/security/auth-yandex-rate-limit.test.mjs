import assert from "node:assert/strict";
import test from "node:test";

import { createAuthRateLimiter } from "../../supabase/functions/auth-yandex-gateway/rateLimit.mjs";

test("auth gateway rate limiter blocks repeated attempts for the same email", () => {
  let now = 1_000_000;
  const limiter = createAuthRateLimiter({
    now: () => now,
    windowMs: 60_000,
    emailLimit: 2,
    ipLimit: 20,
  });

  assert.equal(
    limiter.check({ action: "signup", email: "USER@example.test", ip: "203.0.113.10" }).ok,
    true,
  );
  assert.equal(
    limiter.check({ action: "signup", email: "user@example.test", ip: "203.0.113.10" }).ok,
    true,
  );

  const blocked = limiter.check({
    action: "signup",
    email: " user@example.test ",
    ip: "203.0.113.10",
  });

  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "email");
  assert.equal(blocked.retryAfterSeconds, 60);

  now += 60_001;
  assert.equal(
    limiter.check({ action: "signup", email: "user@example.test", ip: "203.0.113.10" }).ok,
    true,
  );
});

test("auth gateway rate limiter separates signup and recovery counters", () => {
  const limiter = createAuthRateLimiter({
    now: () => 1_000_000,
    windowMs: 60_000,
    emailLimit: 1,
    ipLimit: 20,
  });

  assert.equal(
    limiter.check({ action: "signup", email: "user@example.test", ip: "203.0.113.10" }).ok,
    true,
  );
  assert.equal(
    limiter.check({ action: "recovery", email: "user@example.test", ip: "203.0.113.10" }).ok,
    true,
  );
});

test("auth gateway rate limiter blocks abusive IP fan-out", () => {
  const limiter = createAuthRateLimiter({
    now: () => 1_000_000,
    windowMs: 60_000,
    emailLimit: 20,
    ipLimit: 2,
  });

  assert.equal(
    limiter.check({ action: "recovery", email: "a@example.test", ip: "203.0.113.10" }).ok,
    true,
  );
  assert.equal(
    limiter.check({ action: "recovery", email: "b@example.test", ip: "203.0.113.10" }).ok,
    true,
  );

  const blocked = limiter.check({
    action: "recovery",
    email: "c@example.test",
    ip: "203.0.113.10",
  });

  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "ip");
});

test("auth gateway rate limiter does not share anonymous IP bucket when IP is missing", () => {
  const limiter = createAuthRateLimiter({
    now: () => 1_000_000,
    windowMs: 60_000,
    emailLimit: 20,
    ipLimit: 1,
  });

  assert.equal(limiter.check({ action: "signup", email: "a@example.test", ip: null }).ok, true);
  assert.equal(limiter.check({ action: "signup", email: "b@example.test", ip: null }).ok, true);
});
