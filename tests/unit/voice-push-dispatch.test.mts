import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const module = await import("../../supabase/functions/send-push-notifications/voice-dispatch.ts").catch(() => null);
const api = () => { assert.ok(module, "bounded voice dispatcher must exist"); return module; };
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const START = Date.UTC(2026, 8, 21, 12);
const stamp = (n: number) => new Date(n).toISOString();
const hash = "a".repeat(64);
function prepared(claim: Record<string, unknown>, now = START) {
  return { ...claim, protocol_version: 1, event: "ring", chat_id: id(10), channel_id: id(11),
    caller_id: id(12), recipient_id: id(13), recipient_session_id: id(14),
    ring_started_at: "2026-09-21 15:00:00.000000+03", expires_at: stamp(START + 45000),
    claimed_until: stamp(Math.min(now + 15000, START + 45000)), token: "fictional-voice-token", token_hash: hash };
}

function fixture(options: Record<string, any> = {}) {
  let now = START;
  let wave = 0;
  const calls: Array<{ name: string; args: any; signal?: AbortSignal }> = [];
  const sends: any[] = [];
  const sleeps: number[] = [];
  const deps = {
    enabled: () => true,
    now: () => now,
    uuid: () => id(100 + wave++),
    sleep: async (ms: number) => { sleeps.push(ms); now += ms; },
    getAccessToken: async (signal: AbortSignal) => { calls.push({ name: "oauth", args: {}, signal }); return "fixture-oauth"; },
    rpc: async (name: string, args: any, signal: AbortSignal): Promise<unknown> => {
      calls.push({ name, args, signal });
      if (name === "voice_push_claim") return calls.filter((c) => c.name === name).length === 1
        ? [{ event_id: id(1), push_device_id: id(2), claim_id: args.p_claim_id }] : [];
      if (name === "voice_push_prepare") return [prepared({ event_id: args.p_event_id,
        push_device_id: args.p_push_device_id, claim_id: args.p_claim_id }, now)];
      if (name === "voice_push_complete") return true;
      throw new Error("unexpected RPC");
    },
    send: async (message: any, access: string, signal: AbortSignal) => {
      sends.push({ message, access, signal }); return { status: 200, body: { name: "private-provider-id" } };
    },
    ...options,
  };
  return { deps, calls, sends, sleeps, advance: (ms: number) => { now += ms; } };
}

test("disabled voice is inert (RED before dispatcher)", async () => {
  const f = fixture({ enabled: () => false });
  const result = await api().drainVoicePush(f.deps, 20);
  assert.equal(result.status, "disabled");
  assert.deepEqual(f.calls, []); assert.deepEqual(f.sends, []);
});

test("OAuth precedes exact named claim/prepare/send/complete protocol (RED before dispatcher)", async () => {
  const f = fixture();
  const result = await api().drainVoicePush(f.deps, 1);
  assert.deepEqual(f.calls.map((c) => c.name), ["oauth", "voice_push_claim", "voice_push_prepare", "voice_push_complete"]);
  assert.deepEqual(f.calls[1].args, { p_limit: 1, p_claim_id: id(100) });
  assert.deepEqual(f.calls[2].args, { p_event_id: id(1), p_push_device_id: id(2), p_claim_id: id(100) });
  assert.deepEqual(f.calls[3].args, { p_event_id: id(1), p_push_device_id: id(2), p_claim_id: id(100),
    p_result: "accepted", p_retry_after_ms: null, p_token_hash: hash });
  assert.equal(result.accepted, 1);
  assert.equal(f.sends[0].message.message.android.ttl, "45s");
  assert.equal(f.sends[0].message.message.data.ring_started_at, String(START));
  assert.equal("notification" in f.sends[0].message.message, false);
  assert.equal("collapse_key" in f.sends[0].message.message.android, false);
  assert.ok(f.calls.every((c) => c.signal instanceof AbortSignal));
  assert.doesNotMatch(JSON.stringify(result), /fictional|provider-id|10000000/);
  assert.deepEqual(Object.keys(result).sort(), ["accepted","claimed","discarded","invalid_token","retry","stale","status","suppressed","uncertain"]);
});

test("strict PostgreSQL timestamp normalization rejects rollover and local-time ambiguity", () => {
  const parse = api().parseVoiceTimestamp;
  for (const value of ["2026-09-21T12:00:00Z", "2026-09-21 15:00:00+03", "2026-09-21T08:00:00-04:00",
    "2026-09-21T12:00:00.000999+0000"]) assert.equal(parse(value), START);
  assert.equal(parse("2024-02-29T12:00:00.123456Z"), Date.UTC(2024, 1, 29, 12, 0, 0, 123));
  for (const value of [null, START, "2026-02-29T12:00:00Z", "2026-04-31T00:00:00Z", "2026-13-01T00:00:00Z",
    "2026-09-21T24:00:00Z", "2026-09-21T12:60:00Z", "2026-09-21T12:00:60Z", "2026-09-21T12:00:00",
    "2026-09-21T12:00:00+24", "2026-09-21T12:00:00+03:99", "2026-09-21", "tomorrow", " 2026-09-21T12:00:00Z"])
    assert.equal(parse(value), null, String(value));
});

for (const [field, value] of Object.entries({ event_id: id(90), push_device_id: id(90), claim_id: id(90),
  protocol_version: 2, recipient_session_id: null, expires_at: stamp(START), ring_started_at: "2026-02-30T00:00:00Z",
  claimed_until: stamp(START), token_hash: "not-sha256", token: " bad-token " })) {
  test(`prepare rejects invalid ${field} without a provider call`, async () => {
    const f = fixture(); const original = f.deps.rpc;
    f.deps.rpc = async (...args) => {
      const result = await original(...args);
      return args[0] === "voice_push_prepare" ? [{ ...(result as any[])[0], [field]: value }] : result;
    };
    await api().drainVoicePush(f.deps, 1);
    assert.equal(f.sends.length, 0);
    const complete = f.calls.find((c) => c.name === "voice_push_complete");
    assert.ok(complete, "malformed prepare must discard only the original safe claim");
    assert.equal(complete.args.p_event_id, id(1)); assert.equal(complete.args.p_push_device_id, id(2));
    assert.equal(complete.args.p_claim_id, id(100)); assert.equal(complete.args.p_result, "discarded");
  });
}

for (const reason of ["session revoked", "calls disabled", "capability lost", "account rebound", "ring answered", "blocked member"]) {
  test(`SQL prepare revalidation (${reason}) suppresses send`, async () => {
    const f = fixture(); const original = f.deps.rpc;
    f.deps.rpc = async (...args) => args[0] === "voice_push_prepare" ? [] : original(...args);
    await api().drainVoicePush(f.deps, 1);
    assert.equal(f.sends.length, 0);
    assert.equal(f.calls.filter((c) => c.name === "voice_push_complete").length, 0);
  });
}

test("fresh feature gate and live lease are checked again immediately before send", async () => {
  for (const change of ["gate", "lease"]) {
    let enabled = true; const f = fixture({ enabled: () => enabled }); const original = f.deps.rpc;
    f.deps.rpc = async (...args) => {
      const rows = await original(...args);
      if (args[0] === "voice_push_prepare") { if (change === "gate") enabled = false; else f.advance(15000); }
      return rows;
    };
    await api().drainVoicePush(f.deps, 1); assert.equal(f.sends.length, 0);
  }
});

test("provider error classification never revokes tokens for a generic invalid payload", () => {
  const classify = api().classifyVoiceResponse;
  const body = (code: string) => ({ error: { message: "private", details: [
    { "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: code }] } });
  assert.equal(classify({ status: 404, body: body("UNREGISTERED") }, START).result, "invalid_token");
  assert.equal(classify({ status: 403, body: body("SENDER_ID_MISMATCH") }, START).result, "retry");
  assert.equal(classify({ status: 400, body: body("INVALID_ARGUMENT") }, START).result, "discarded");
  assert.equal(classify({ status: 503, body: { private: "raw" } }, START).retryAfterMs, null);
  assert.equal(classify({ status: 429, retryAfter: "1" }, START).retryAfterMs, 60000);
  assert.equal(classify({ status: 503, retryAfter: "120" }, START).retryAfterMs, 120000);
  assert.equal(classify({ status: 503, retryAfter: new Date(START + 65000).toUTCString() }, START).retryAfterMs, 65000);
});

test("retries claim a new lease and prepare again, bounded to three local attempts", async () => {
  const f = fixture(); let sent = 0; let nextAttemptAt = START; const sendTimes: number[] = [];
  const original = f.deps.rpc;
  f.deps.rpc = async (name, args, signal) => {
    if (name === "voice_push_claim") {
      f.calls.push({ name, args, signal });
      return sent < 3 && f.deps.now() >= nextAttemptAt ? [{ event_id: id(1), push_device_id: id(2), claim_id: args.p_claim_id }] : [];
    }
    if (name === "voice_push_complete" && args.p_result === "retry") {
      assert.equal(args.p_retry_after_ms, null);
      nextAttemptAt = f.deps.now() + (sent === 1 ? 2000 : 4000);
    }
    return original(name, args, signal);
  };
  f.deps.send = async () => { sendTimes.push(f.deps.now() - START); sent++; return { status: sent < 3 ? 503 : 200 }; };
  const result = await api().drainVoicePush(f.deps, 20);
  assert.equal(result.accepted, 1); assert.equal(result.retry, 2); assert.equal(sent, 3);
  assert.deepEqual(f.sleeps, [2000, 2000, 2000]);
  assert.deepEqual(sendTimes, [0, 2000, 6000]);
  assert.equal(f.calls.filter((c) => c.name === "voice_push_prepare").length, 3);
  assert.equal(new Set(f.calls.filter((c) => c.name === "voice_push_claim").map((c) => c.args.p_claim_id)).size, 7);
});

test("invalid-token completion carries captured hash and safe original claim, never direct device mutation", async () => {
  const f = fixture({ send: async () => ({ status: 404, body: { error: { details: [
    { "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }] } } }) });
  const result = await api().drainVoicePush(f.deps, 1);
  assert.equal(result.invalid_token, 1);
  assert.deepEqual(f.calls.at(-1)?.args, { p_event_id: id(1), p_push_device_id: id(2), p_claim_id: id(100),
    p_result: "invalid_token", p_retry_after_ms: null, p_token_hash: hash });
});

test("cancel uses the captured generation through the same sole payload builder", async () => {
  const f = fixture(); const original = f.deps.rpc;
  f.deps.rpc = async (...args) => { const rows = await original(...args);
    return args[0] === "voice_push_prepare" ? [{ ...(rows as any[])[0], event: "cancel" }] : rows; };
  await api().drainVoicePush(f.deps, 1);
  assert.equal(f.sends[0].message.message.data.event, "cancel");
  assert.equal(f.sends[0].message.message.data.ring_key, `voice:${id(11)}:${START}`);
});

test("an empty claim does not poll/spin and OAuth failure never claims", async () => {
  const empty = fixture({ rpc: async () => [] });
  assert.equal((await api().drainVoicePush(empty.deps, 20)).status, "idle");
  assert.deepEqual(empty.sleeps, []);
  const failed = fixture({ getAccessToken: async () => { throw new Error("private-key-material"); } });
  const result = await api().drainVoicePush(failed.deps, 20);
  assert.equal(result.status, "provider_auth_failed"); assert.deepEqual(failed.calls, []);
  assert.doesNotMatch(JSON.stringify(result), /private-key-material/);
});

for (const phase of ["oauth", "claim", "prepare", "send", "complete"] as const) {
  test(`${phase} timeout aborts at its literal bound and settles even if transport ignores abort`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = fixture(); let signal: AbortSignal | undefined;
    const stalled = (s: AbortSignal): Promise<any> => { signal = s; return new Promise(() => {}); };
    if (phase === "oauth") f.deps.getAccessToken = stalled;
    else if (phase === "send") f.deps.send = async (_m, _a, s) => stalled(s);
    else { const original = f.deps.rpc; f.deps.rpc = async (name, args, s) =>
      name === `voice_push_${phase}` ? stalled(s) : original(name, args, s); }
    const run = api().drainVoicePush(f.deps, 1);
    for (let n = 0; n < 100; n++) await Promise.resolve();
    assert.ok(signal);
    const bound = phase === "oauth" || phase === "send" ? 4000 : 2000;
    t.mock.timers.tick(bound - 1); assert.equal(signal.aborted, false);
    t.mock.timers.tick(1); assert.equal(signal.aborted, true);
    const result = await run;
    assert.equal(result.accepted, 0);
  });
}

test("send timeout is capped to the remaining claim lease", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(); const original = f.deps.rpc; let signal: AbortSignal | undefined;
  f.deps.rpc = async (...args) => { const rows = await original(...args);
    return args[0] === "voice_push_prepare" ? [{ ...(rows as any[])[0], claimed_until: stamp(START + 25) }] : rows; };
  f.deps.send = async (_m, _a, s) => { signal = s; return new Promise(() => {}); };
  const run = api().drainVoicePush(f.deps, 1);
  for (let n = 0; n < 100; n++) await Promise.resolve();
  assert.ok(signal); t.mock.timers.tick(24); assert.equal(signal.aborted, false);
  t.mock.timers.tick(1); assert.equal(signal.aborted, true); await run;
});

async function mutant(needle: string, replacement: string) {
  const url = new URL("../../supabase/functions/send-push-notifications/voice-dispatch.ts", import.meta.url);
  const source = readFileSync(url, "utf8");
  assert.equal(source.split(needle).length - 1, 1, "one exact mutation target");
  const js = stripTypeScriptTypes(source.replace(needle, replacement)).replace('"./voice-payload.ts"',
    JSON.stringify(new URL("./voice-payload.ts", url).href));
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}

for (const [name, needle, replacement, override] of [
  ["protocol admission", "row.protocol_version !== 1 || ", "", { protocol_version: 2 }],
  ["exact prepare identity", "!row || !matches(row, claim)", "!row", { push_device_id: id(90) }],
] as const) {
  test(`mutation: ${name} removal makes the behavioral rejection assertion fail`, async () => {
    const m = await mutant(needle, replacement); const f = fixture(); const original = f.deps.rpc;
    f.deps.rpc = async (...args) => { const rows = await original(...args);
      return args[0] === "voice_push_prepare" ? [{ ...(rows as any[])[0], ...override }] : rows; };
    await m.drainVoicePush(f.deps, 1);
    assert.throws(() => assert.equal(f.sends.length, 0), { code: "ERR_ASSERTION" });
  });
}

test("mutation: widening concurrency literal changes observable claimed wave size", async () => {
  const m = await mutant("const CONCURRENCY = 4;", "const CONCURRENCY = 5;"); const f = fixture();
  await m.drainVoicePush(f.deps, 20);
  assert.throws(() => assert.equal(f.calls.find((c) => c.name === "voice_push_claim")?.args.p_limit, 4), { code: "ERR_ASSERTION" });
});

test("mutation: lowering 429 floor changes the provider-delay assertion", async () => {
  const m = await mutant("Math.max(60_000, hint ?? 0)", "Math.max(2_000, hint ?? 0)");
  assert.throws(() => assert.equal(m.classifyVoiceResponse({ status: 429 }, START).retryAfterMs, 60000), { code: "ERR_ASSERTION" });
});

test("Retry-After past lifetime is passed unchanged to SQL, without sleep or resend", async () => {
  const f = fixture({ send: async () => ({ status: 429, retryAfter: "90" }) });
  await api().drainVoicePush(f.deps, 20);
  assert.equal(f.calls.find((c) => c.name === "voice_push_complete")?.args.p_retry_after_ms, 90000);
  assert.deepEqual(f.sleeps, []);
});

test("stale and uncertain acks do not report acceptance or resend on the same lease", async () => {
  for (const fail of [false, true]) {
    const f = fixture(); const original = f.deps.rpc;
    f.deps.rpc = async (...args) => {
      if (args[0] === "voice_push_complete") { if (fail) throw new Error("private RPC body"); return false; }
      return original(...args);
    };
    const result = await api().drainVoicePush(f.deps, 1);
    assert.equal(result.accepted, 0); assert.equal(f.sends.length, 1);
    assert.equal(fail ? result.uncertain : result.stale, 1);
    assert.doesNotMatch(JSON.stringify(result), /private/);
  }
});

async function readyTargetsProbe(dispatch: typeof import("../../supabase/functions/send-push-notifications/voice-dispatch.ts").drainVoicePush) {
  const f = fixture(); const original = f.deps.rpc; let live = 0; let peak = 0;
  f.deps.rpc = async (name, args, signal) => {
    if (name === "voice_push_claim") {
      f.calls.push({ name, args, signal });
      assert.ok(args.p_limit <= 4);
      return Array.from({ length: args.p_limit }, (_, n) => ({ event_id: id(1), push_device_id: id(n + 200 + f.calls.length), claim_id: args.p_claim_id }));
    }
    return original(name, args, signal);
  };
  f.deps.send = async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 2)); live--; return { status: 200 }; };
  const result = await dispatch(f.deps, 999);
  assert.equal(f.calls.filter((c) => c.name === "voice_push_claim").length, 5);
  assert.equal(peak, 4); assert.equal(result.claimed, 20); assert.equal(result.accepted, 20);
}

test("twenty ready targets drain in five batches with <=4 concurrent sends and no local lease queue", async () => {
  await readyTargetsProbe(api().drainVoicePush);
});

test("mutation: restoring a four-wave cutoff fails the twenty-target regression", async () => {
  const m = await mutant("while (summary.claimed < limit)", "while (summary.claimed < limit && waveIds.size < 4)");
  await assert.rejects(() => readyTargetsProbe(m.drainVoicePush), { code: "ERR_ASSERTION" });
});

async function mixedRetryProbe(dispatch: typeof import("../../supabase/functions/send-push-notifications/voice-dispatch.ts").drainVoicePush) {
  const f = fixture(); const original = f.deps.rpc;
  const targets = Array.from({ length: 18 }, (_, n) => ({ device: id(200 + n), attempts: 0,
    next: START, done: false, claim: "" }));
  const sent: Array<{ device: string; time: number }> = [];
  f.deps.rpc = async (name, args, signal) => {
    if (name === "voice_push_claim") {
      f.calls.push({ name, args, signal });
      return targets.filter((t) => !t.done && t.attempts < 3 && t.next <= f.deps.now()).slice(0, args.p_limit).map((t) => {
        t.attempts++; t.claim = args.p_claim_id;
        return { event_id: id(1), push_device_id: t.device, claim_id: t.claim };
      });
    }
    const target = targets.find((t) => t.device === args.p_push_device_id);
    assert.ok(target); assert.equal(args.p_claim_id, target.claim);
    if (name === "voice_push_prepare") return [prepared({ event_id: id(1), push_device_id: target.device,
      claim_id: target.claim, }, f.deps.now())].map((r) => ({ ...r, token: target.device }));
    if (name === "voice_push_complete") {
      assert.equal(args.p_retry_after_ms, null);
      target.done = args.p_result !== "retry";
      target.next = f.deps.now() + 2000 * 2 ** (target.attempts - 1);
    }
    return original(name, args, signal);
  };
  f.deps.send = async (envelope) => {
    const device = envelope.message.token;
    const target = targets.find((t) => t.device === device)!;
    sent.push({ device, time: f.deps.now() - START });
    return { status: device === targets[0].device && target.attempts < 3 ? 503 : 200 };
  };
  const result = await dispatch(f.deps, 20);
  assert.equal(result.claimed, 20); assert.equal(result.accepted, 18); assert.equal(result.retry, 2);
  assert.ok(targets.every((t) => t.done));
  assert.ok(sent.slice(0, 18).every((s) => s.time === 0), "fresh targets do not wait behind retry sleep");
  assert.deepEqual(sent.filter((s) => s.device === targets[0].device).map((s) => s.time), [0, 2000, 6000]);
  assert.deepEqual(f.sleeps, [2000, 2000, 2000]);
}

test("fake SQL next_attempt_at preserves an early retry across eighteen fresh targets and empty polls", async () => {
  await mixedRetryProbe(api().drainVoicePush);
});

test("mutation: replacing pending retries per wave loses the earlier failed target", async () => {
  const m = await mutant("for (const retry of retries) if (retry)", "pendingRetries.clear(); for (const retry of retries) if (retry)");
  await assert.rejects(() => mixedRetryProbe(m.drainVoicePush), { code: "ERR_ASSERTION" });
});

async function budgetProbe(dispatch: typeof import("../../supabase/functions/send-push-notifications/voice-dispatch.ts").drainVoicePush) {
  const f = fixture(); const original = f.deps.rpc; let device = 200; let completions = 0;
  f.deps.rpc = async (name, args, signal) => {
    if (name === "voice_push_claim") return Array.from({ length: args.p_limit }, () => ({
      event_id: id(1), push_device_id: id(device++), claim_id: args.p_claim_id }));
    if (name === "voice_push_complete" && ++completions % 4 === 0) f.advance(5000);
    const result = await original(name, args, signal);
    return result;
  };
  const result = await dispatch(f.deps, 20);
  assert.equal(result.status, "budget_exhausted"); assert.equal(result.claimed, 16);
  assert.equal(f.deps.now() - START, 20000);
}

test("twenty-second drain deadline stops claiming even with fresh targets remaining", async () => {
  await budgetProbe(api().drainVoicePush);
});

test("mutation: widening the twenty-second budget breaks the deadline regression", async () => {
  const m = await mutant("const BUDGET_MS = 20_000;", "const BUDGET_MS = 25_000;");
  await assert.rejects(() => budgetProbe(m.drainVoicePush), { code: "ERR_ASSERTION" });
});

test("mutation: removing the initial feature gate causes forbidden OAuth work", async () => {
  const m = await mutant('if (!deps.enabled()) return voiceSummary("disabled");', "");
  const f = fixture({ enabled: () => false });
  await m.drainVoicePush(f.deps, 20);
  assert.throws(() => assert.deepEqual(f.calls, []), { code: "ERR_ASSERTION" });
});

test("empty retry polls stay bounded when SQL never makes a retry eligible again", async () => {
  const f = fixture({ send: async () => ({ status: 503 }) });
  const result = await api().drainVoicePush(f.deps, 20);
  assert.equal(result.claimed, 1); assert.equal(result.retry, 1); assert.equal(result.status, "budget_exhausted");
  assert.equal(f.sleeps.length, 9); assert.equal(f.deps.now() - START, 18000);
  assert.equal(f.calls.filter((c) => c.name === "voice_push_claim").length, 11);
});

test("malformed claim batches fail closed without prepare or completion on unsafe identities", async () => {
  for (const kind of ["wrong-claim", "duplicate", "over-limit", "invalid-id", "object"]) {
    const f = fixture({ rpc: async (_name: string, args: any) => {
      const row = { event_id: id(1), push_device_id: id(2), claim_id: args.p_claim_id };
      if (kind === "wrong-claim") return [{ ...row, claim_id: id(99) }];
      if (kind === "invalid-id") return [{ ...row, event_id: "bad" }];
      if (kind === "object") return row;
      return Array.from({ length: kind === "over-limit" ? 5 : 2 }, () => row);
    } });
    const result = await api().drainVoicePush(f.deps, 20);
    assert.equal(result.status, "rpc_failed"); assert.equal(result.claimed, 0); assert.equal(f.sends.length, 0);
  }
});

test("three local send attempts remain a hard guard even if SQL returns a fourth claim", async () => {
  const f = fixture(); const original = f.deps.rpc; let sends = 0;
  f.deps.rpc = async (name, args, signal) => name === "voice_push_claim"
    ? [{ event_id: id(1), push_device_id: id(2), claim_id: args.p_claim_id }] : original(name, args, signal);
  f.deps.send = async () => { sends++; return { status: 503 }; };
  const result = await api().drainVoicePush(f.deps, 4);
  assert.equal(sends, 3); assert.equal(result.suppressed, 1); assert.equal(result.claimed, 4);
});

test("voice authorization requires a configured secret and genuine header or Bearer form", () => {
  const authorize = api().isVoiceRequestAuthorized;
  const request = (headers: Record<string,string>) => new Request("https://fixture.invalid", { headers });
  assert.equal(authorize(request({}), undefined), false);
  assert.equal(authorize(request({ authorization: "fixture-secret" }), "fixture-secret"), false);
  assert.equal(authorize(request({ authorization: "Bearer fixture-secret" }), "fixture-secret"), true);
  assert.equal(authorize(request({ "x-kub-push-token": "fixture-secret" }), "fixture-secret"), true);
});
