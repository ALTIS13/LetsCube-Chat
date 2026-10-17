import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const sourceUrl = new URL("../../artifacts/api-server/src/workers/pushDispatcher.ts", import.meta.url);
const source = readFileSync(sourceUrl, "utf8").replaceAll("\r\n", "\n");
const config = readFileSync(new URL("../../artifacts/api-server/src/workers/pushDispatcherConfig.ts", import.meta.url), "utf8");
const ROW = "10000000-0000-4000-8000-000000000001";
const SUB = "20000000-0000-4000-8000-000000000001";
const USER = "30000000-0000-4000-8000-000000000001";
const OTHER = "30000000-0000-4000-8000-000000000002";
const plain = value => JSON.parse(JSON.stringify(value));
function fingerprint(descriptor) {
  const fields = [descriptor.id.toLowerCase(), descriptor.user_id.toLowerCase(), descriptor.endpoint, descriptor.p256dh, descriptor.auth];
  return "v1:" + createHash("sha256").update(Buffer.concat(fields.flatMap(value => {
    const bytes = Buffer.from(value, "utf8"); return [Buffer.from(`${bytes.length}:`), bytes];
  }))).digest("hex");
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function compile(text, imports) {
  const module = { exports: {} };
  const result = ts.transpileModule(text, { reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  assert.equal(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  vm.runInNewContext(result.outputText, { module, exports: module.exports,
    require(name) { assert.ok(Object.hasOwn(imports, name), `unexpected dependency ${name}`); return imports[name]; },
    setTimeout, process: { env: {} }, crypto: { randomUUID }, Buffer, Date });
  return module.exports;
}

function fixture(text = source, options = {}) {
  const events = [], sends = [], writes = [], logs = [], rpcs = [];
  const entered = deferred(), release = deferred(), providerEntered = deferred(), providerRelease = deferred();
  const row = { id: ROW, subscription_id: SUB, payload: { kind: "message", title: "Fictional", body: "fixture" },
    attempt_count: 0, ...options.row };
  const subscription = { id: SUB, user_id: USER, endpoint: "https://provider.invalid/fictional",
    p256dh: "fictional-key", auth: "fictional-auth", is_active: true, ...options.subscription };
  let eligible = true, token = null;
  let stored = { id: ROW, claim_token: null, sent_at: null, suppressed_at: null, attempt_count: row.attempt_count };
  const client = {
    async rpc(name, args) {
      rpcs.push({ name, args: plain(args) }); events.push(name);
      if (name === "push_outbox_claim") {
        token = args.p_claim_token; stored.claim_token = token;
        return options.claimError ? { data: [row], error: { message: subscription.endpoint } }
          : { data: Object.hasOwn(options, "claimRows") ? options.claimRows : [row], error: null };
      }
      assert.ok(["push_outbox_delivery_recheck", "push_outbox_delivery_recheck_bound"].includes(name));
      if (name === "push_outbox_delivery_recheck_bound") {
        assert.deepEqual(Object.keys(args).sort(), ["p_claim_token", "p_outbox_id", "p_subscription_fingerprint", "p_subscription_id"]);
        assert.equal(args.p_outbox_id, ROW); assert.equal(args.p_claim_token, token);
        assert.equal(args.p_subscription_id, row.subscription_id);
        if (options.boundMissing) return { data: null, error: { code: "PGRST202" } };
        if (args.p_subscription_fingerprint !== fingerprint(subscription)) {
          stored.claim_token = null; return { data: "subscription_changed", error: null };
        }
      } else assert.deepEqual(plain(args), { p_outbox_id: ROW, p_claim_token: token });
      if (options.recheckThrow) throw new Error(subscription.endpoint);
      if (options.recheckError) return { data: "deliver", error: { message: subscription.endpoint } };
      const status = Object.hasOwn(options, "status") ? options.status
        : (!subscription.is_active ? "subscription_inactive" : eligible ? "deliver" : "not_eligible");
      if (["read", "not_eligible", "subscription_inactive"].includes(status)) {
        stored.suppressed_at = "terminal"; stored.claim_token = null;
      }
      if (status === "foreground") stored.claim_token = null;
      return { data: status, error: null };
    },
    from(table) {
      const predicates = []; let patch, operation = "read", columns;
      const query = {
        select(value) { columns = value; return query; },
        eq(key, value) { predicates.push([key, value]); return query; },
        is(key, value) { predicates.push([key, value]); return query; },
        lt() { return query; }, order() { return query; }, limit() { return query; }, in() { return query; },
        update(value) { patch = plain(value); operation = "update"; return query; },
        delete() { operation = "delete"; return query; },
        async then(done, fail) {
          try {
            if (operation !== "read") {
              writes.push({ table, patch, operation, predicates: plain(predicates), columns }); events.push("write:" + table);
              if (options.ackError && table === "notifications_push_outbox") return done({ data: null, error: { message: subscription.endpoint } });
              if (options.ackThrow && table === "notifications_push_outbox") throw new Error(subscription.endpoint);
              const record = table === "notifications_push_outbox" ? stored : subscription;
              const matches = predicates.every(([key, value]) => record[key] === value);
              if (matches && table === "notifications_push_outbox") stored = { ...stored, ...patch };
              if (matches && table === "push_subscriptions") Object.assign(subscription, patch);
              return done({ data: matches ? [{ id: table === "notifications_push_outbox" ? ROW : SUB }] : [], error: null });
            }
            if (table === "notifications_push_outbox") return done({ data: [row], error: null });
            assert.equal(table, "push_subscriptions"); const snapshot = plain(subscription);
            events.push("subscriptions"); entered.resolve();
            if (options.holdSubscriptions) await release.promise;
            return done({ data: options.subError ? null : options.missingSubscription ? [] : [snapshot],
              error: options.subError ? { message: subscription.endpoint } : null });
          } catch (error) { return fail(error); }
        },
      }; return query;
    },
  };
  const logger = Object.fromEntries(["error", "warn", "info"].map(level => [level, (...args) => logs.push([level, ...args])]));
  const worker = compile(text + "\nexport { tick as runTick };", {
    "@supabase/supabase-js": { createClient() { throw Error("startup forbidden"); } },
    "node:crypto": { createHash, randomUUID },
    "web-push": { default: { async sendNotification(...args) {
      sends.push(plain(args)); events.push("provider"); providerEntered.resolve();
      if (options.holdProvider) await providerRelease.promise;
      if (options.providerError) throw options.providerError;
    } } },
    "../lib/logger": { logger }, "./pushDispatcherConfig": compile(config, {}),
  });
  return { run: () => worker.runTick(client), events, sends, writes, logs, rpcs, entered, release, providerEntered, providerRelease,
    disable() { eligible = false; }, replaceClaim() { stored.claim_token = OTHER; },
    rebindSubscription() { subscription.user_id = OTHER; },
    activateSubscription() { subscription.is_active = true; },
    changeDescriptor() { subscription.endpoint = "https://provider.invalid/B"; subscription.p256dh = "key-B"; subscription.auth = "auth-B"; },
    get subscription() { return subscription; },
    get stored() { return stored; }, get token() { return token; } };
}

async function heldDisable(text = source) {
  const f = fixture(text, { holdSubscriptions: true }); const pending = f.run();
  await f.entered.promise; f.disable(); f.release.resolve(); await pending;
  assert.equal(f.sends.length, 0, "disabled during lookup must never reach provider");
  return f;
}
test("actual legacy worker refuses disable during its subscription await", () => heldDisable());

test("actual legacy worker sends generic display paths and an identifier-only Web preview selector", async () => {
  const notificationId = "70000000-0000-4000-8000-000000000001";
  const f = fixture(source, { row: { payload: { kind: "message", title: "Fictional Sender", body: "Fictional private text",
    notificationId, web_preview: { grant_secret: "fictional-forged-grant" } } } });
  await f.run();
  assert.equal(f.sends.length, 1);
  const payload = JSON.parse(f.sends[0][1]);
  assert.equal(payload.title, "LETSCUBE");
  assert.equal(payload.body, "Новое уведомление");
  assert.deepEqual(payload.web_preview, { preview_v: 1, subscription_id: SUB, notification_id: notificationId });
  assert.doesNotMatch(JSON.stringify(payload), /Fictional|fictional-forged-grant/);
});

test("allowed positive control reaches the provider once with a generic display body", async () => {
  const f = fixture(); await f.run();
  assert.equal(f.sends.length, 1); assert.equal(JSON.parse(f.sends[0][1]).body, "Новое уведомление");
});
async function allowed(text = source) {
  const f = fixture(text); await f.run();
  assert.deepEqual(f.events.slice(0, 4), ["push_outbox_claim", "subscriptions", "push_outbox_delivery_recheck_bound", "provider"], "fresh recheck is the last async boundary before send");
  assert.equal(f.rpcs[0].args.p_limit, 50);
  assert.match(f.token, /^[0-9a-f-]{36}$/);
  const [ack] = f.writes; assert.equal(f.writes.length, 1);
  assert.deepEqual(ack.predicates, [["id", ROW], ["claim_token", f.token]], "completion must bind exact claim token");
  assert.equal(ack.patch.claim_token, null); assert.equal(ack.patch.claimed_until, null);
  assert.equal(ack.patch.last_error, null); assert.match(ack.patch.sent_at, /^\d{4}-/);
  return f;
}
test("allowed delivery claims, freshly rechecks and completes only its token", () => allowed());
for (const status of ["read", "subscription_inactive", "subscription_changed", "not_eligible", "foreground", "claim_lost", "unexpected", null, { status: "deliver" }]) {
  test(`refused recheck ${JSON.stringify(status)} neither sends nor overwrites SQL settlement`, async () => {
    const f = fixture(source, { status }); await f.run();
    assert.equal(f.sends.length, 0, "only literal deliver may send"); assert.equal(f.writes.length, 0);
  });
}
for (const flag of ["claimError", "subError", "recheckError", "recheckThrow"]) {
  test(`${flag} refuses without provider or unclaimed fallback`, async () => {
    const f = fixture(source, { [flag]: true }); await f.run();
    assert.equal(f.sends.length, 0); assert.equal(f.writes.length, 0);
    assert.equal(JSON.stringify(f.logs).includes("provider.invalid"), false, "backend errors must not leak subscription details");
  });
}

test("new tick uses a new lease token", async () => {
  const f = fixture(); await f.run(); const token = f.token; await f.run(); assert.notEqual(f.token, token);
});
async function lateAck(text = source) {
  const f = fixture(text, { holdProvider: true }); const pending = f.run();
  await f.providerEntered.promise; f.replaceClaim(); f.providerRelease.resolve(); await pending;
  assert.equal(f.stored.claim_token, OTHER, "late ACK must not clear a replacement lease");
  assert.equal(f.stored.sent_at, null);
}
test("ACK after a new claimant cannot change its row", () => lateAck());
for (const flag of ["ackError", "ackThrow"]) {
  test(`provider acceptance followed by ${flag} is not retried as a provider failure`, async () => {
    const f = fixture(source, { [flag]: true }); await f.run();
    assert.equal(f.sends.length, 1); assert.equal(f.writes.length, 1);
    assert.equal(f.stored.attempt_count, 0); assert.equal(JSON.stringify(f.logs).includes("provider.invalid"), false);
  });
}
test("live inactive subscription is settled by RPC, not by cached caller state", async () => {
  const f = fixture(source, { subscription: { is_active: false } }); await f.run();
  assert.equal(f.sends.length, 0); assert.equal(f.writes.length, 0);
  assert.equal(f.stored.suppressed_at, "terminal"); assert.equal(f.stored.claim_token, null);
});
async function reactivated(text = source) {
  const f = fixture(text, { subscription: { is_active: false }, holdSubscriptions: true });
  const pending = f.run();
  await f.entered.promise; f.activateSubscription(); f.release.resolve(); await pending;
  assert.equal(f.sends.length, 1, "fresh server deliver must override stale cached inactive flag");
  assert.equal(f.stored.suppressed_at, null); assert.equal(f.writes.length, 1);
  assert.ok(f.stored.sent_at);
}
test("reactivated descriptor is sent despite a cached inactive snapshot", () => reactivated());
test("transient provider error consumes one attempt and releases exactly its claim", async () => {
  const f = fixture(source, { providerError: { statusCode: 503, body: '{"reason":"Busy"}', endpoint: "DO_NOT_LOG" } });
  await f.run(); const [ack] = f.writes;
  assert.equal(ack.patch.attempt_count, 1); assert.equal(ack.patch.last_error, "webpush:503:Busy");
  assert.equal(ack.patch.claim_token, null); assert.equal(ack.patch.claimed_until, null);
  assert.deepEqual(ack.predicates, [["id", ROW], ["claim_token", f.token]]);
  assert.equal(JSON.stringify(f.logs).includes("DO_NOT_LOG"), false);
});
for (const statusCode of [404, 410]) {
  test(`${statusCode} deactivates the same subscription binding, never deletes it`, async () => {
    const f = fixture(source, { providerError: { statusCode } }); await f.run();
    const [sub, ack] = f.writes; assert.equal(sub.operation, "update"); assert.equal(sub.patch.is_active, false);
    assert.ok(sub.predicates.some(([key, value]) => key === "id" && value === SUB));
    assert.ok(sub.predicates.some(([key, value]) => key === "user_id" && value === USER), "deactivation keeps recipient binding");
    assert.equal(ack.patch.suppression_reason, "subscription_inactive");
    assert.deepEqual(ack.predicates, [["id", ROW], ["claim_token", f.token]]);
  });
}
async function invalidClaim(text, row) {
  const f = fixture(text, { row }); await f.run();
  assert.equal(f.sends.length, 0, "invalid or exhausted claim must not send");
  assert.equal(f.rpcs.length, 1, "invalid claim must stop before delivery recheck");
  assert.equal(f.events.includes("subscriptions"), false);
}
for (const row of [{ attempt_count: 5 }, { attempt_count: -1 }, { attempt_count: 0.5 }, { id: "bad" }, { payload: [] }]) {
  test(`malformed/exhausted claimed row ${JSON.stringify(row)} never sends`, () => invalidClaim(source, row));
}
async function reboundSubscription(text = source) {
  const f = fixture(text, { holdProvider: true, providerError: { statusCode: 404 } }); const pending = f.run();
  await f.providerEntered.promise; f.rebindSubscription(); f.providerRelease.resolve(); await pending;
  assert.equal(f.subscription.is_active, true, "late provider failure must not deactivate another recipient binding");
  assert.equal(f.subscription.user_id, OTHER);
}
test("late 404 cannot deactivate a subscription rebound to another recipient", () => reboundSubscription());
for (const claimRows of [null, {}, [], [
  { id: ROW, subscription_id: SUB, payload: {}, attempt_count: 0 },
  { id: ROW, subscription_id: SUB, payload: {}, attempt_count: 0 },
]]) {
  test(`empty or invalid claim batch ${JSON.stringify(claimRows)} has no lookup/send`, async () => {
    const f = fixture(source, { claimRows }); await f.run();
    assert.equal(f.sends.length, 0); assert.equal(f.writes.length, 0); assert.equal(f.events.includes("subscriptions"), false);
  });
}
async function refusal(text, options) {
  const f = fixture(text, options); await f.run();
  assert.equal(f.sends.length, 0, "refused authority must not send");
}
const mutations = [
  ["omit fresh RPC", 'const result = await supabase.rpc("push_outbox_delivery_recheck_bound", {\n      p_outbox_id: row.id, p_claim_token: claimToken,\n      p_subscription_id: sub.id, p_subscription_fingerprint: descriptorFingerprint,\n    });',
    'const result = { data: "deliver", error: null };', heldDisable, "disabled during lookup must never reach provider"],
  ["allow unknown status", 'if (status !== "deliver") return;', 'if (status === "claim_lost") return;',
    text => refusal(text, { status: "unexpected" }), "refused authority must not send"],
  ["omit completion token", '.eq("id", id).eq("claim_token", claimToken).select("id")', '.eq("id", id).select("id")',
    lateAck, "late ACK must not clear a replacement lease"],
  ["raise attempt ceiling", "const MAX_ATTEMPTS = 5;", "const MAX_ATTEMPTS = 6;",
    text => invalidClaim(text, { attempt_count: 5 }), "invalid or exhausted claim must not send"],
  ["omit subscription owner fence", '.eq("id", descriptor.id).eq("user_id", descriptor.user_id).eq("endpoint", descriptor.endpoint)',
    '.eq("id", descriptor.id).eq("endpoint", descriptor.endpoint)', reboundSubscription,
    "late provider failure must not deactivate another recipient binding"],
  ["restore stale cached inactive veto", 'if (status !== "deliver") return;',
    'if (status !== "deliver") return;\n  if (sub.is_active !== true) return;',
    reactivated, "fresh server deliver must override stale cached inactive flag"],
  ["ignore RPC error", "if (result.error) return;", "",
    text => refusal(text, { recheckError: true }), "refused authority must not send"],
  ["use old unbound ABI", 'const result = await supabase.rpc("push_outbox_delivery_recheck_bound", {\n      p_outbox_id: row.id, p_claim_token: claimToken,\n      p_subscription_id: sub.id, p_subscription_fingerprint: descriptorFingerprint,\n    });',
    'const result = await supabase.rpc("push_outbox_delivery_recheck", { p_outbox_id: row.id, p_claim_token: claimToken });',
    descriptorChanged, "same-id same-owner descriptor replacement must refuse stale provider bytes"],
  ["send different endpoint than fingerprinted", '{ endpoint: descriptor.endpoint, keys: { p256dh: descriptor.p256dh, auth: descriptor.auth } },',
    '{ endpoint: "https://provider.invalid/different", keys: { p256dh: descriptor.p256dh, auth: descriptor.auth } },',
    boundUnicode, "provider bytes must match bound fingerprint"],
];
for (const [name, needle, replacement, scenario, message] of mutations) {
  test(`actual compiled omission is rejected: ${name}`, async () => {
    assert.equal(source.split(needle).length - 1, 1, "one actual mutation anchor");
    await assert.rejects(() => scenario(source.replace(needle, replacement)), error => {
      assert.equal(error.code, "ERR_ASSERTION", "compile/setup failures cannot kill a mutant");
      assert.equal(error.message.split("\n")[0], message); return true;
    });
  });
}

async function descriptorChanged(text = source) {
  const f = fixture(text, { holdSubscriptions: true }); const pending = f.run();
  await f.entered.promise; f.changeDescriptor(); f.release.resolve(); await pending;
  assert.equal(f.sends.length, 0, "same-id same-owner descriptor replacement must refuse stale provider bytes");
  return f;
}
test("cached descriptor A cannot send after same S/UID changes to B before final check", () => descriptorChanged());
test("bound RPC missing fails closed without falling back to old ABI", async () => {
  const f = fixture(source, { boundMissing: true }); await f.run();
  assert.equal(f.sends.length, 0, "missing bound RPC must never use unbound fallback");
  assert.equal(f.rpcs.filter(call => call.name === "push_outbox_delivery_recheck").length, 0);
});
test("missing cached descriptor refuses without unbound fallback or unverified suppression", async () => {
  const f = fixture(source, { missingSubscription: true }); await f.run();
  assert.equal(f.sends.length, 0); assert.equal(f.writes.length, 0); assert.equal(f.rpcs.length, 1);
});
async function boundUnicode(text = source) {
  const sid = "70000000-0000-4000-8000-000000000050", uid = "70000000-0000-4000-8000-000000000001";
  const f = fixture(text, { row: { subscription_id: sid }, subscription: { id: sid, user_id: uid,
    endpoint: "https://provider.invalid/\u00e9/\u{1f9ca}?x=1#f", p256dh: "a\u{1f9ca}:bc", auth: "auth:\u00e9" } });
  await f.run(); assert.equal(f.sends.length, 1);
  const [sent] = f.sends; const check = f.rpcs.find(call => call.name === "push_outbox_delivery_recheck_bound");
  assert.ok(check, "descriptor-bound RPC must execute");
  assert.equal(check.args.p_subscription_fingerprint, "v1:31a3586636684d806e71ae039a72c602302f7be949c8a4de4b491d7e4cd16f29");
  assert.equal(check.args.p_subscription_fingerprint, fingerprint({ id: sid, user_id: uid,
    endpoint: sent[0].endpoint, p256dh: sent[0].keys.p256dh, auth: sent[0].keys.auth }), "provider bytes must match bound fingerprint");
  assert.equal(JSON.stringify(check.args).includes("provider.invalid"), false);
  assert.equal(JSON.stringify(check.args).includes("auth:"), false);
}
test("bound fingerprint is of the exact descriptor bytes passed to provider", () => boundUnicode());
