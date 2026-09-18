// Slice 5's switch and its two limits, as decisions rather than as transport.
//
// `tests/unit/voice-gateway-routes.test.mjs` drives the routes and proves the
// answers change; this file drives the functions that decide, with every value
// a deployment might actually hold, and then pins the seam between the three
// deployables that have to agree about them — the Edge Function, the worker and
// the migration. A name or a number that disagrees across that seam is a silent
// failure: PostgREST answers 404, the gateway reads that as «I could not ask»,
// and the limit is simply gone with nothing saying so.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  readVoiceActiveParticipants,
  readVoiceAdmission,
  readVoiceConcurrencyCap,
  readVoiceRateLimitAnswer,
  VOICE_IN_FLIGHT_SECONDS,
  VOICE_RATE_LIMITS,
} from "../../supabase/functions/voice-gateway/admission.mjs";

// ── the kill switch ─────────────────────────────────────────────────────────

test("VOICE_ENABLED=false is the only value that closes voice", () => {
  assert.deepEqual(readVoiceAdmission({ VOICE_ENABLED: "false" }), {
    ok: false,
    error: "voice_disabled",
    status: 503,
  });
});

test("absent, empty and true all leave voice open, as BOT_CREATION_ENABLED does", () => {
  // Generally available: no configuration required. The switch is a kill
  // switch, not an enable switch — `docs/operations/bot-gateway.md:84-88`, and
  // the failure that rule was written for is a variable left set after a
  // canary, which closed the feature for everybody including the owner.
  for (const environment of [{}, { VOICE_ENABLED: undefined }, { VOICE_ENABLED: "" }, { VOICE_ENABLED: "true" }]) {
    assert.deepEqual(
      readVoiceAdmission(environment),
      { ok: true },
      JSON.stringify(environment),
    );
  }
  // And a caller with no environment object at all is not an outage.
  assert.deepEqual(readVoiceAdmission(undefined), { ok: true });
});

test("an unrecognised value is a configuration error, never an implicit «on»", () => {
  for (
    const value of [
      "FALSE",
      "False",
      "fAlse",
      " false",
      "false ",
      "0",
      "1",
      "no",
      "off",
      "disabled",
      "true ",
      "TRUE",
      "yes",
    ]
  ) {
    assert.deepEqual(
      readVoiceAdmission({ VOICE_ENABLED: value }),
      { ok: false, error: "not_configured", status: 503 },
      `VOICE_ENABLED=${JSON.stringify(value)}`,
    );
  }
  // A non-string is the shape a mistyped compose value can take, and it must
  // not be read as «on» either.
  for (const value of [false, true, 0, 1, [], {}]) {
    assert.equal(
      readVoiceAdmission({ VOICE_ENABLED: value }).ok,
      false,
      `VOICE_ENABLED=${JSON.stringify(value)}`,
    );
  }
});

test("the two refusals are told apart on the wire while reading the same to a person", () => {
  // Both are 503 and both map to `disabled` in `lib/voiceGateway.ts`, so the
  // reader sees «Голосовые чаты сейчас отключены.» either way — which is true
  // either way. Whoever is probing the route needs the difference, so the body
  // carries it.
  const off = readVoiceAdmission({ VOICE_ENABLED: "false" });
  const broken = readVoiceAdmission({ VOICE_ENABLED: "nope" });
  assert.equal(off.status, broken.status);
  assert.notEqual(off.error, broken.error);
});

// ── the concurrency cap's configuration ─────────────────────────────────────

test("no cap set is no cap, which is the behaviour this deployment already had", () => {
  for (
    const environment of [
      {},
      { VOICE_MAX_TOTAL_PARTICIPANTS: undefined },
      { VOICE_MAX_TOTAL_PARTICIPANTS: null },
      { VOICE_MAX_TOTAL_PARTICIPANTS: "" },
    ]
  ) {
    assert.deepEqual(readVoiceConcurrencyCap(environment), { ok: true, cap: null }, JSON.stringify(environment));
  }
  assert.deepEqual(readVoiceConcurrencyCap(undefined), { ok: true, cap: null });
});

test("a plain positive integer is the cap, and nothing else is", () => {
  assert.deepEqual(readVoiceConcurrencyCap({ VOICE_MAX_TOTAL_PARTICIPANTS: "1" }), { ok: true, cap: 1 });
  assert.deepEqual(readVoiceConcurrencyCap({ VOICE_MAX_TOTAL_PARTICIPANTS: "60" }), { ok: true, cap: 60 });
  assert.deepEqual(readVoiceConcurrencyCap({ VOICE_MAX_TOTAL_PARTICIPANTS: "0060" }), { ok: true, cap: 60 });
  assert.deepEqual(readVoiceConcurrencyCap({ VOICE_MAX_TOTAL_PARTICIPANTS: "10000" }), { ok: true, cap: 10_000 });

  for (
    const value of [
      "0",
      "-1",
      "-20",
      "1.5",
      "20.0",
      " 20",
      "20 ",
      "2 0",
      "1e3",
      "0x10",
      "+5",
      "twenty",
      "20;drop",
      "Infinity",
      "NaN",
      // Parsed to a safe integer it does not equal, and past the ceiling.
      "9007199254740993",
      "10001",
      20,
      true,
      [],
    ]
  ) {
    assert.deepEqual(
      readVoiceConcurrencyCap({ VOICE_MAX_TOTAL_PARTICIPANTS: value }),
      { ok: false, error: "not_configured", status: 503 },
      `VOICE_MAX_TOTAL_PARTICIPANTS=${JSON.stringify(value)}`,
    );
  }
});

test("zero is refused rather than read as a second kill switch", () => {
  // Two ways to turn voice off is two things to remember, and the one that
  // looks like a number would be the one nobody documented.
  assert.equal(readVoiceConcurrencyCap({ VOICE_MAX_TOTAL_PARTICIPANTS: "0" }).ok, false);
});

// ── reading the database's answers ──────────────────────────────────────────

test("only a positive «no» refuses a caller", () => {
  assert.deepEqual(readVoiceRateLimitAnswer({ ok: true }), { allowed: true });
  assert.deepEqual(readVoiceRateLimitAnswer({ ok: false, retry_after_seconds: 42 }), {
    allowed: false,
    retryAfterSeconds: 42,
  });
  // A retry-after that is missing, absurd or not a number still has to produce
  // a header, and one second is the honest floor: the window has not passed.
  for (const retry of [undefined, null, 0, -5, "soon", {}, Number.NaN]) {
    assert.deepEqual(
      readVoiceRateLimitAnswer({ ok: false, retry_after_seconds: retry }),
      { allowed: false, retryAfterSeconds: 1 },
      JSON.stringify(retry),
    );
  }
  // A fractional answer rounds away from the caller, never towards them.
  assert.equal(readVoiceRateLimitAnswer({ ok: false, retry_after_seconds: 2.1 }).retryAfterSeconds, 3);
});

test("anything the limiter cannot read allows, and says it is degraded", () => {
  // The fail-open decision, in one test. `null` is what the gateway passes when
  // the RPC errored or does not exist — the state of a deployment where this
  // migration has not been applied — and it must not stop calls.
  for (const data of [null, undefined, "", 0, false, true, "yes", [], {}, { ok: "true" }, { ok: 1 }]) {
    assert.deepEqual(
      readVoiceRateLimitAnswer(data),
      { allowed: true, degraded: true },
      JSON.stringify(data),
    );
  }
  // A genuine allow is not degraded, so the warn-once line means something.
  assert.equal(readVoiceRateLimitAnswer({ ok: true }).degraded, undefined);
});

test("the participant count is a number or an admission of not knowing", () => {
  assert.equal(readVoiceActiveParticipants(0), 0);
  assert.equal(readVoiceActiveParticipants(41), 41);
  assert.equal(readVoiceActiveParticipants("41"), 41);
  assert.equal(readVoiceActiveParticipants(41.9), 41);

  for (const data of [null, undefined, -1, "-1", "many", "", [], {}, Number.NaN, Infinity]) {
    assert.equal(readVoiceActiveParticipants(data), null, JSON.stringify(data));
  }
  // `Number(true)` is 1, and a cap that read `true` as one participant would
  // refuse every join on a deployment whose RPC answered the wrong type.
  assert.equal(readVoiceActiveParticipants(true), null);
  assert.equal(readVoiceActiveParticipants(false), null);
});

// ── the seam between the function, the worker and the migration ─────────────
//
// Comments stripped before every scan below. Guards in this repository have
// matched their own prose five times in one session, and the migration is
// nothing but prose around some SQL.

const MIGRATION = ".migration-backup/supabase/migrations/20260918190000_voice_limits_bind_the_deployment.sql";

const stripSql = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");

const stripTs = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");

const sql = stripSql(readFileSync(MIGRATION, "utf8"));
const gateway = stripTs(readFileSync("supabase/functions/voice-gateway/index.ts", "utf8"));
const reconciler = stripTs(readFileSync("artifacts/api-server/src/workers/voiceReconciler.ts", "utf8"));

/** The parameter names the migration declares, in the order it declares them. */
function declaredParameters(name) {
  const match = new RegExp(
    `create or replace function public\\.${name}\\s*\\(([^)]*)\\)`,
  ).exec(sql);
  assert.ok(match, `the migration declares no public.${name}`);
  return [...match[1].matchAll(/\b(p_[a-z_]+)\b/g)].map((entry) => entry[1]);
}

/** The argument names a caller sends, in the order it sends them. */
function calledParameters(source, name) {
  const match = new RegExp(`rpc\\(\\s*"${name}"\\s*,\\s*\\{([^}]*)\\}`).exec(source);
  assert.ok(match, `nothing calls ${name}`);
  return [...match[1].matchAll(/\b(p_[a-z_]+)\s*:/g)].map((entry) => entry[1]);
}

test("every argument the gateway sends is a parameter the migration declares", () => {
  // PostgREST resolves an RPC by name *and* argument names. One misspelling and
  // the call is a 404 the gateway reads as «I could not ask», so it fails open
  // and the limit is gone with nothing anywhere saying so. That is the failure
  // this test exists for, and it cannot be seen from either file alone.
  for (
    const [name, caller] of [
      ["voice_rate_limit_consume", gateway],
      ["voice_active_participants", gateway],
      ["voice_rate_limit_prune", reconciler],
    ]
  ) {
    assert.deepEqual(
      calledParameters(caller, name),
      declaredParameters(name),
      `the call to ${name} does not match the migration's signature`,
    );
  }
});

test("the actions the gateway spends are the actions the table permits", () => {
  const constraint = /check\s*\(action in \(([^)]*)\)\)/.exec(sql);
  assert.ok(constraint, "the migration does not constrain `action`");
  const permitted = [...constraint[1].matchAll(/'([a-z_]+)'/g)].map((entry) => entry[1]).sort();
  assert.deepEqual(
    Object.keys(VOICE_RATE_LIMITS).sort(),
    permitted,
    "an action the gateway spends would violate the table's check constraint, which fails open",
  );
});

test("the numbers the gateway passes are inside the bounds the RPCs enforce", () => {
  // Both functions raise on an argument outside their range, and a raise is a
  // 500 the gateway reads as «I could not ask» — so a constant widened here
  // without the migration being widened too would silently remove the limit
  // rather than loosen it.
  const consume = /p_limit is null or p_limit < 1 or p_limit > (\d+)/.exec(sql);
  const window = /p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > (\d+)/.exec(sql);
  const inFlight = /p_in_flight_seconds is null or p_in_flight_seconds < 0 or p_in_flight_seconds > (\d+)/.exec(sql);
  assert.ok(consume && window && inFlight, "the RPCs no longer bound their arguments");

  for (const [action, plan] of Object.entries(VOICE_RATE_LIMITS)) {
    assert.ok(plan.limit >= 1 && plan.limit <= Number(consume[1]), `${action} limit`);
    assert.ok(
      plan.windowSeconds >= 1 && plan.windowSeconds <= Number(window[1]),
      `${action} window`,
    );
  }
  assert.ok(
    VOICE_IN_FLIGHT_SECONDS >= 0 && VOICE_IN_FLIGHT_SECONDS <= Number(inFlight[1]),
    "the in-flight window is outside what the RPC accepts",
  );
});

test("the worker's retention is longer than the longest window the gateway counts", () => {
  // The one invariant that spans two deployables and can go wrong quietly. If
  // the sweep deleted signals the gateway still counts, every caller's
  // allowance would silently widen — the limit would look present and be
  // partly absent, which is worse than not having it.
  const retention = /const RATE_LIMIT_RETENTION_MS = ([0-9_]+) \* ([0-9_]+);/.exec(reconciler);
  assert.ok(retention, "the reconciler no longer declares a retention for these signals");
  const retentionMs = Number(retention[1].replace(/_/g, "")) * Number(retention[2].replace(/_/g, ""));
  const longestWindowMs = Math.max(
    ...Object.values(VOICE_RATE_LIMITS).map((plan) => plan.windowSeconds * 1_000),
  );
  assert.ok(
    retentionMs > longestWindowMs,
    `retention ${retentionMs}ms does not outlast the ${longestWindowMs}ms window`,
  );
});

test("the migration keeps the table where PostgREST cannot reach it", () => {
  // `private` is not an exposed schema on this deployment, which is the reason
  // `private.voice_webhook_events` is where it is. A counter moved to `public`
  // would become readable by anybody holding a publishable key.
  assert.match(sql, /create table if not exists private\.voice_rate_limit_signals/);
  assert.doesNotMatch(sql, /create table[^\n]*public\.voice_rate_limit_signals/);
  // And only the gateway's role may call in.
  for (
    const signature of [
      "public.voice_rate_limit_consume(uuid,text,integer,integer)",
      "public.voice_active_participants(integer)",
      "public.voice_rate_limit_prune(timestamptz)",
    ]
  ) {
    assert.ok(
      sql.includes(`'${signature}'`),
      `${signature} is not in the migration's grant and check lists`,
    );
  }
  assert.match(sql, /revoke all on function %s from public, anon, authenticated, service_role/);
  assert.match(sql, /grant execute on function %s to service_role/);
});
