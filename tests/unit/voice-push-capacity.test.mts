import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test, { type TestContext } from "node:test";
import { drainVoicePush, type VoiceDependencies, type VoiceProviderResponse, type VoiceSummary }
  from "../../supabase/functions/send-push-notifications/voice-dispatch.ts";

type Dispatch = typeof drainVoicePush;
type Outcome = "accepted" | "retry" | "invalid_token" | "discarded";
type Target = {
  event: string; device: string; state: "pending" | "claimed" | "accepted" | "terminal";
  attempts: number; next: number; lease: string; until: number;
};
type Send = { drain: number; device: string; lease: string; at: number; ttl: string };
type Completion = { drain: number; result: Outcome; hint: unknown; ack: unknown };
type Options = {
  cap?: number; sendMs?: number; prepareMs?: number;
  // Deliberately permissive SQL only for the independent Edge attempt-guard probe.
  extraSqlAttempt?: boolean;
  response?: (target: Target) => VoiceProviderResponse;
  ack?: (target: Target) => "ok" | "stale" | "lost_after_commit" | "unknown";
};
const START = Date.UTC(2026, 8, 21, 12);
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const stamp = (n: number) => new Date(n).toISOString();
const TOKEN_HASH = "b".repeat(64);

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new Error("synthetic_abort")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

function clock(t: TestContext) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: START });
  return {
    advance: (ms: number) => t.mock.timers.tick(ms),
    async settle<T>(promise: Promise<T>): Promise<T> {
      let done = false;
      let value: T;
      let failure: unknown;
      promise.then((result) => { value = result; done = true; }, (error) => { failure = error; done = true; });
      // Flush every drain's microtasks before advancing the one shared clock.
      // In particular, concurrent sleeps must not each advance global time.
      for (let step = 0; step <= 700; step++) {
        for (let turn = 0; turn < 100; turn++) await Promise.resolve();
        if (done) { if (failure) throw failure; return value!; }
        t.mock.timers.tick(100);
      }
      assert.fail("synthetic run exceeded 70 seconds of virtual time");
    },
  };
}

// A shared RPC dependency, not a second dispatcher. This models admission/leases
// and acknowledgements only; real SQL, locks and pg_net are tested elsewhere.
function sharedSql(count: number, options: Options = {}) {
  const targets: Target[] = Array.from({ length: count }, (_, n) => ({
    event: id(1 + Math.floor(n / 8)), device: id(200 + n), state: "pending",
    attempts: 0, next: START, lease: "", until: 0,
  }));
  const sends: Send[] = [];
  const completions: Completion[] = [];
  const claims: Array<{ drain: number; requested: number; granted: number }> = [];
  const sleeps: number[] = [];
  const activeByDrain = new Map<number, number>();
  const peakByDrain = new Map<number, number>();
  let wave = 1000;
  let active = 0;
  let peak = 0;
  let peakClaims = 0;
  const liveClaims = () => targets.filter((target) => target.state === "claimed" && target.until > Date.now()).length;
  const counters = () => ({
    accepted: targets.filter((target) => target.state === "accepted").length,
    ready: targets.filter((target) => target.state === "pending" && target.next <= Date.now() && Date.now() < START + 45_000).length,
    liveClaimed: liveClaims(),
    terminal: targets.filter((target) => target.state === "terminal").length,
    activeSends: active,
  });

  function dependencies(drain: number): VoiceDependencies {
    return {
      enabled: () => true,
      now: Date.now,
      uuid: () => id(wave++),
      sleep: (ms) => { sleeps.push(ms); return delay(ms); },
      getAccessToken: async () => "synthetic-access",
      rpc: async (name, args, signal) => {
        if (name === "voice_push_claim") {
          assert.deepEqual(Object.keys(args).sort(), ["p_claim_id", "p_limit"]);
          assert.equal(typeof args.p_limit, "number");
          const requested = args.p_limit as number;
          const available = Math.max(0, (options.cap ?? 16) - liveClaims());
          const rows = targets.filter((target) => Date.now() < START + 45_000 &&
            target.attempts < (options.extraSqlAttempt ? 4 : 3) &&
            ((target.state === "pending" && target.next <= Date.now()) ||
              (target.state === "claimed" && target.until <= Date.now())))
            .slice(0, Math.min(requested, available));
          for (const target of rows) {
            target.state = "claimed"; target.attempts++; target.lease = String(args.p_claim_id);
            target.until = Math.min(Date.now() + 15_000, START + 45_000);
          }
          peakClaims = Math.max(peakClaims, liveClaims());
          claims.push({ drain, requested, granted: rows.length });
          return rows.map((target) => ({ event_id: target.event, push_device_id: target.device, claim_id: target.lease }));
        }
        const target = targets.find((row) => row.event === args.p_event_id && row.device === args.p_push_device_id);
        assert.ok(target, "RPC must address an actual synthetic target");
        assert.equal(args.p_claim_id, target.lease, "prepare/complete must retain the acquired lease");
        if (name === "voice_push_prepare") {
          assert.deepEqual(Object.keys(args).sort(), ["p_claim_id", "p_event_id", "p_push_device_id"]);
          const row = { event_id: target.event, push_device_id: target.device, claim_id: target.lease,
            protocol_version: 1, event: "ring", chat_id: id(100), channel_id: id(101),
            caller_id: id(102), recipient_id: id(103), recipient_session_id: id(104),
            ring_started_at: stamp(START), expires_at: stamp(START + 45_000),
            claimed_until: stamp(target.until), token: target.device, token_hash: TOKEN_HASH };
          await delay(options.prepareMs ?? 0, signal);
          return [row];
        }
        assert.equal(name, "voice_push_complete", "no unmodelled RPC may silently succeed");
        assert.deepEqual(Object.keys(args).sort(), ["p_claim_id", "p_event_id", "p_push_device_id",
          "p_result", "p_retry_after_ms", "p_token_hash"]);
        assert.equal(args.p_token_hash, TOKEN_HASH);
        const result = args.p_result as Outcome;
        assert.ok(["accepted", "retry", "invalid_token", "discarded"].includes(result));
        const mode = options.ack?.(target) ?? "ok";
        const entry: Completion = { drain, result, hint: args.p_retry_after_ms, ack: false };
        completions.push(entry);
        if (mode === "stale" || target.until <= Date.now()) return false;
        if (mode === "unknown") { entry.ack = null; return null; }
        const next = Date.now() + (options.extraSqlAttempt ? 0 :
          Math.max(2000 * 2 ** (target.attempts - 1), Number(args.p_retry_after_ms ?? 0)));
        target.state = result === "accepted" ? "accepted" : result === "retry" &&
          target.attempts < (options.extraSqlAttempt ? 4 : 3) && next < START + 45_000 ? "pending" : "terminal";
        target.next = next; target.until = 0;
        if (mode === "lost_after_commit") { entry.ack = "lost"; throw new Error("synthetic_lost_ack"); }
        entry.ack = true;
        return true;
      },
      send: async (envelope, access, signal) => {
        assert.equal(access, "synthetic-access");
        assert.equal(signal.aborted, false);
        const target = targets.find((row) => row.device === envelope.message.token);
        assert.ok(target);
        assert.equal(target.state, "claimed");
        sends.push({ drain, device: target.device, lease: target.lease, at: Date.now() - START,
          ttl: envelope.message.android.ttl });
        active++;
        activeByDrain.set(drain, (activeByDrain.get(drain) ?? 0) + 1);
        peak = Math.max(peak, active);
        peakByDrain.set(drain, Math.max(peakByDrain.get(drain) ?? 0, activeByDrain.get(drain)!));
        try {
          await delay(options.sendMs ?? 100, signal);
          return options.response?.(target) ?? { status: 200 };
        } finally {
          active--; activeByDrain.set(drain, activeByDrain.get(drain)! - 1);
        }
      },
    };
  }
  return { dependencies, targets, sends, completions, claims, sleeps, counters, peakByDrain,
    get peak() { return peak; }, get peakClaims() { return peakClaims; } };
}

function assertUniqueLeases(sends: Send[]) {
  assert.equal(new Set(sends.map((send) => `${send.device}:${send.lease}`)).size, sends.length,
    "one provider attempt per target/lease, not a promise of exactly-once delivery");
}

function assertPerDrain(f: ReturnType<typeof sharedSql>, summaries: VoiceSummary[]) {
  for (const summary of summaries) assert.ok(summary.claimed <= 20, "per-drain total claims <= 20");
  for (const peak of f.peakByDrain.values()) assert.ok(peak <= 4, "per-drain provider concurrency <= 4");
  assert.ok(f.claims.every((claim) => claim.requested <= 4), "no local claim batch above four");
  assertUniqueLeases(f.sends);
}

async function backlogProbe(t: TestContext, dispatch: Dispatch) {
  const time = clock(t);
  const f = sharedSql(53);
  const first = await time.settle(dispatch(f.dependencies(0), 999));
  assert.equal(first.claimed, 20, "one drain must leave >20 backlog for another invocation");
  assert.equal(first.accepted, 20);
  assert.deepEqual(f.counters(), { accepted: 20, ready: 33, liveClaimed: 0, terminal: 0, activeSends: 0 });
  const second = await time.settle(dispatch(f.dependencies(1), 20));
  const third = await time.settle(dispatch(f.dependencies(2), 20));
  const empty = await time.settle(dispatch(f.dependencies(3), 20));
  assert.deepEqual([second.accepted, third.accepted, empty.accepted], [20, 13, 0]);
  assert.equal(empty.status, "idle");
  assert.equal(f.peak, 4, "positive control: concurrent provider calls actually overlap");
  assert.equal(f.sends.length, 53);
  assert.deepEqual(f.counters(), { accepted: 53, ready: 0, liveClaimed: 0, terminal: 0, activeSends: 0 });
  assertPerDrain(f, [first, second, third, empty]);
}

test("capacity: 53 targets require 20/20/13 claims across subsequent drains", async (t) => {
  await backlogProbe(t, drainVoicePush);
});

async function overlapProbe(t: TestContext, dispatch: Dispatch, cap = 16) {
  const time = clock(t);
  const f = sharedSql(93, { cap });
  const summaries = await time.settle(Promise.all(Array.from({ length: 6 }, (_, n) => dispatch(f.dependencies(n), 999))));
  assertPerDrain(f, summaries);
  assert.equal(f.peak, cap === 16 ? 16 : 24, "positive control: provider calls actually overlap across drains");
  assert.equal(f.peakClaims, cap === 16 ? 16 : 24);
  if (cap === 16) {
    assert.deepEqual(summaries.map((summary) => summary.accepted).sort((a, b) => a - b), [0, 0, 20, 20, 20, 20]);
    assert.deepEqual(f.counters(), { accepted: 80, ready: 13, liveClaimed: 0, terminal: 0, activeSends: 0 });
    const recovery = await time.settle(dispatch(f.dependencies(6), 20));
    assert.equal(recovery.accepted, 13);
    assertPerDrain(f, [recovery]);
  }
  assert.equal(f.sends.length, 93);
  assert.deepEqual(f.counters(), { accepted: 93, ready: 0, liveClaimed: 0, terminal: 0, activeSends: 0 });
  const idle = await time.settle(dispatch(f.dependencies(7), 20));
  assert.equal(idle.claimed, 0, "acknowledged targets never repeat in a later drain");
  return f;
}

test("capacity: six overlapping drains respect synthetic global16 and recover residual backlog", async (t) => {
  await overlapProbe(t, drainVoicePush);
});

test("capacity control: Task3-style admission permits aggregate24 despite each drain staying at four", async (t) => {
  const f = await overlapProbe(t, drainVoicePush, Infinity);
  assert.throws(() => assert.ok(f.peak <= 16, "aggregate16 requires SQL admission"), { code: "ERR_ASSERTION" });
});

test("capacity: delayed invocation and HTTP503 retry preserve fresh work and absolute expiry across two drains", async (t) => {
  const time = clock(t);
  const f = sharedSql(30, { sendMs: 200,
    response: (target) => target.device === id(200) && target.attempts === 1 ? { status: 503, retryAfter: "3" } : { status: 200 } });
  // Models arrival after a missed wake, not an HTTP/cron recovery implementation.
  time.advance(5000);
  assert.equal(f.sends.length, 0);
  const summaries = await time.settle(Promise.all([drainVoicePush(f.dependencies(0), 20), drainVoicePush(f.dependencies(1), 20)]));
  assertPerDrain(f, summaries);
  assert.equal(f.peak, 8);
  assert.equal(summaries.reduce((sum, summary) => sum + summary.accepted, 0), 30);
  assert.equal(summaries.reduce((sum, summary) => sum + summary.retry, 0), 1);
  assert.equal(summaries.reduce((sum, summary) => sum + summary.claimed, 0), 31);
  const retried = f.sends.filter((send) => send.device === id(200));
  assert.deepEqual(retried.map((send) => send.at), [5000, 8200]);
  assert.deepEqual(retried.map((send) => send.ttl), ["40s", "36s"]);
  assert.notEqual(retried[0].lease, retried[1].lease);
  assert.equal(f.completions.find((entry) => entry.result === "retry")?.hint, 3000);
  assert.ok(f.sends.filter((send) => send.device !== id(200)).every((send) => send.at < 8200));
  assert.deepEqual(f.counters(), { accepted: 30, ready: 0, liveClaimed: 0, terminal: 0, activeSends: 0 });
});

test("capacity: Retry-After beyond this drain's budget resumes in a later invocation before expiry", async (t) => {
  const time = clock(t);
  const f = sharedSql(1, { sendMs: 500,
    response: (target) => target.attempts === 1 ? { status: 503, retryAfter: "25" } : { status: 200 } });
  const first = await time.settle(drainVoicePush(f.dependencies(0), 20));
  assert.equal(first.status, "budget_exhausted");
  assert.equal(first.retry, 1); assert.equal(first.accepted, 0);
  assert.equal(f.completions[0].hint, 25_000);
  time.advance(24_900);
  assert.equal((await time.settle(drainVoicePush(f.dependencies(1), 20))).claimed, 0, "backoff must not be shortened");
  time.advance(100);
  const later = await time.settle(drainVoicePush(f.dependencies(2), 20));
  assert.equal(later.accepted, 1);
  assert.deepEqual(f.sends.map((send) => send.at), [0, 25_500]);
  assert.deepEqual(f.sends.map((send) => send.ttl), ["45s", "19s"]);
  assertUniqueLeases(f.sends);
});

test("capacity: outage through expiry and an HTTP429 floor cannot be shortened by a fresh drain", async (t) => {
  const time = clock(t);
  const f = sharedSql(8, { response: () => ({ status: 429, retryAfter: "1" }) });
  const first = await time.settle(Promise.all([drainVoicePush(f.dependencies(0), 20), drainVoicePush(f.dependencies(1), 20)]));
  assert.equal(first.reduce((sum, summary) => sum + summary.retry, 0), 8);
  assert.ok(f.completions.every((entry) => entry.hint === 60_000));
  assert.deepEqual(f.sleeps, []);
  time.advance(45_000);
  const expired = await time.settle(drainVoicePush(f.dependencies(2), 20));
  assert.equal(expired.claimed, 0); assert.equal(expired.accepted, 0);
  assert.equal(f.sends.length, 8);
  assert.deepEqual(f.counters(), { accepted: 0, ready: 0, liveClaimed: 0, terminal: 8, activeSends: 0 });
  assertPerDrain(f, first);
});

test("capacity: a delayed prepare crossing the exact 45s boundary is refused by Edge before send", async (t) => {
  const time = clock(t);
  const f = sharedSql(4, { prepareMs: 1000 });
  time.advance(44_000);
  const summary = await time.settle(drainVoicePush(f.dependencies(0), 20));
  assert.equal(summary.claimed, 4, "positive control: RPC returned four valid claims before expiry");
  assert.equal(summary.stale, 4);
  assert.equal(summary.accepted, 0); assert.equal(summary.discarded, 0);
  assert.equal(f.completions.length, 4);
  assert.ok(f.completions.every((entry) => entry.result === "discarded"));
  assert.equal(f.sends.length, 0);
  assert.equal(Date.now() - START, 45_000);
  assert.equal(f.counters().liveClaimed, 0);
});

async function budgetProbe(t: TestContext, dispatch: Dispatch) {
  const time = clock(t);
  const f = sharedSql(40, { prepareMs: 1500, sendMs: 3900 });
  const summary = await time.settle(dispatch(f.dependencies(0), 20));
  assert.equal(Date.now() - START, 20_000, "no provider/RPC work may extend the drain deadline");
  assert.equal(summary.status, "budget_exhausted");
  assert.equal(summary.claimed, 16);
  assert.equal(summary.accepted, 12);
  assert.equal(summary.uncertain, 4, "no completion RPC can start after the deadline");
  assert.equal(f.counters().activeSends, 0, "aborted provider calls release in-flight observations");
  assert.ok(f.sends.every((send) => send.at < 20_000));
  assertPerDrain(f, [summary]);
}

test("capacity: slow prepare/provider calls stop at the literal 20s deadline with backlog remaining", async (t) => {
  await budgetProbe(t, drainVoicePush);
});

async function attemptProbe(t: TestContext, dispatch: Dispatch) {
  const time = clock(t);
  const f = sharedSql(1, { extraSqlAttempt: true, response: () => ({ status: 503 }) });
  const summary = await time.settle(dispatch(f.dependencies(0), 4));
  assert.equal(f.sends.length, 3, "Edge must refuse a fourth attempt even when SQL is permissive");
  assert.equal(summary.claimed, 4); assert.equal(summary.retry, 3); assert.equal(summary.suppressed, 1);
  assertUniqueLeases(f.sends);
}

test("capacity: local three-attempt limit survives an erroneously admitted fourth lease", async (t) => {
  await attemptProbe(t, drainVoicePush);
});

async function acknowledgementProbe(t: TestContext, dispatch: Dispatch) {
  const time = clock(t);
  let fault = true;
  const f = sharedSql(4, { ack: (target) => !fault || target.device === id(200) ? "ok" :
    target.device === id(201) ? "stale" : target.device === id(202) ? "lost_after_commit" : "unknown" });
  const summaries = await time.settle(Promise.all([dispatch(f.dependencies(0), 2), dispatch(f.dependencies(1), 2)]));
  assert.equal(f.sends.length, 4, "all four provider calls returned HTTP200");
  assert.equal(summaries.reduce((sum, summary) => sum + summary.accepted, 0), 1,
    "accepted counts only a true SQL completion acknowledgement");
  assert.equal(summaries.reduce((sum, summary) => sum + summary.stale, 0), 1);
  assert.equal(summaries.reduce((sum, summary) => sum + summary.uncertain, 0), 2);
  assert.deepEqual(f.counters(), { accepted: 2, ready: 0, liveClaimed: 2, terminal: 0, activeSends: 0 });
  const noReplay = await time.settle(dispatch(f.dependencies(2), 20));
  assert.equal(noReplay.claimed, 0); assert.equal(f.sends.length, 4);
  fault = false;
  time.advance(14_900);
  const recovery = await time.settle(dispatch(f.dependencies(3), 20));
  assert.equal(recovery.accepted, 2);
  assert.equal(f.sends.length, 6, "unacknowledged work can repeat on a new lease, not the old lease");
  assert.deepEqual(f.counters(), { accepted: 4, ready: 0, liveClaimed: 0, terminal: 0, activeSends: 0 });
  assertPerDrain(f, [...summaries, noReplay, recovery]);
  for (const summary of summaries) assert.deepEqual(Object.keys(summary).sort(),
    ["accepted", "claimed", "discarded", "invalid_token", "retry", "stale", "status", "suppressed", "uncertain"]);
  assert.doesNotMatch(JSON.stringify(summaries), /synthetic|20000000|bbbbbbbb/i);
}

test("capacity: overlapping drains distinguish SQL acknowledgements from provider acceptance and recover stale leases", async (t) => {
  await acknowledgementProbe(t, drainVoicePush);
});

async function mutate(needle: string, replacement: string, occurrences = 1): Promise<Dispatch> {
  const url = new URL("../../supabase/functions/send-push-notifications/voice-dispatch.ts", import.meta.url);
  const source = readFileSync(url, "utf8");
  assert.equal(source.split(needle).length - 1, occurrences, "mutation must hit the actual production rule");
  const js = stripTypeScriptTypes(source.replaceAll(needle, replacement)).replace('"./voice-payload.ts"',
    JSON.stringify(new URL("./voice-payload.ts", url).href));
  return (await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`)).drainVoicePush;
}

for (const [name, needle, replacement, occurrences, probe, failure] of [
  ["per-drain concurrency widened to five", "const CONCURRENCY = 4;", "const CONCURRENCY = 5;", 1, overlapProbe,
    /per-drain provider concurrency <= 4/],
  ["claim budget widened to twenty-four", "const MAX_LIMIT = 20;", "const MAX_LIMIT = 24;", 1, backlogProbe,
    /one drain must leave >20 backlog/],
  ["deadline widened to twenty-five seconds", "const BUDGET_MS = 20_000;", "const BUDGET_MS = 25_000;", 1, budgetProbe,
    /no provider\/RPC work may extend the drain deadline/],
  ["four provider attempts allowed", "(attempts.get(key) ?? 0) >= 3", "(attempts.get(key) ?? 0) >= 4", 2, attemptProbe,
    /Edge must refuse a fourth attempt/],
  ["false SQL completion counted as accepted", "accepted === true", "typeof accepted === \"boolean\"", 1, acknowledgementProbe,
    /accepted counts only a true SQL completion acknowledgement/],
] as const) {
  test(`capacity mutation: ${name} fails its unchanged behavioral assertions`, async (t) => {
    const dispatch = await mutate(needle, replacement, occurrences);
    await assert.rejects(() => probe(t, dispatch), { code: "ERR_ASSERTION", message: failure });
  });
}
