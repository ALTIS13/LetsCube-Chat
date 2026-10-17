import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

let handler;
let env = {};
let requests = [];
let webCalls = [];
let fcmCalls = [];
let provider = "web";
let claimToken;
let currentFixture;
let webDescriptors = [];
let events = [];
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function fingerprint(target, web) {
  const fields = web ? [target.id, target.user_id, target.endpoint, target.p256dh, target.auth]
    : [target.id, target.user_id, target.platform, target.provider, target.token, target.app_version, target.session_id];
  return "v1:" + createHash("sha256").update(Buffer.concat(fields.flatMap(value => {
    if (value === null) return [Buffer.from("-1:")];
    const bytes = Buffer.from(value, "utf8"); return [Buffer.from(`${bytes.length}:`), bytes];
  }))).digest("hex");
}
function request() {
  return new Request("https://fixture.invalid/functions/v1/send-push-notifications", {
    method: "POST", headers: { "x-kub-push-token": "fixture-dispatch" }, body: "{}",
  });
}
const rowId = "20000000-0000-4000-8000-000000000001";
const subscriptionId = "30000000-0000-4000-8000-000000000001";
const deviceId = "30000000-0000-4000-8000-000000000002";
const chatId = "40000000-0000-4000-8000-000000000001";
const messageId = "50000000-0000-4000-8000-000000000001";
const notificationId = "60000000-0000-4000-8000-000000000001";
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

globalThis.Deno = { env: { get: (key) => env[key] }, serve: (callback) => { handler = callback; } };
globalThis.__albumWebpush = {
  setVapidDetails() {},
  async sendNotification(subscription, payload) {
    events.push("provider"); webDescriptors.push(subscription);
    webCalls.push(JSON.parse(payload));
    currentFixture.options.onProvider?.(currentFixture);
    if (currentFixture.options.webError) throw currentFixture.options.webError;
  },
};
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "npm:web-push@3.6.7") {
      return { url: "data:text/javascript,export default globalThis.__albumWebpush", shortCircuit: true };
    }
    return next(specifier, context);
  },
});
await import("../../supabase/functions/send-push-notifications/index.ts");
hook.deregister();
const originalFetch = globalThis.fetch;
test.after(() => {
  globalThis.fetch = originalFetch;
  delete globalThis.Deno;
  delete globalThis.__albumWebpush;
});

test("album Web preview selector uses the freshly rechecked member and exact subscription", async () => {
  configure("web");
  await handler(request());
  assert.equal(webCalls.length, 1);
  assert.deepEqual(webCalls[0].web_preview, {
    preview_v: 1, subscription_id: subscriptionId, notification_id: notificationId,
  });
  assert.equal(webCalls[0].body, "Новое уведомление");
});

function configure(nextProvider, options = {}) {
  provider = nextProvider;
  requests = [];
  webCalls = [];
  fcmCalls = [];
  webDescriptors = []; events = [];
  const entered = deferred(), release = deferred();
  const f = { entered, release, status: "deliver", liveActive: options.liveActive ?? true, rechecks: 0, acks: [], options, writes: [],
    subscription: { id: subscriptionId, user_id: "70000000-0000-4000-8000-000000000001",
      endpoint: "https://push.invalid/test", p256dh: "fixture-key", auth: "fixture-auth", is_active: true,
      ...options.subscription },
    device: { id: deviceId, user_id: "70000000-0000-4000-8000-000000000001",
      token: "fixture-registration", provider: "fcm", enabled: true, revoked_at: null, app_version: "0.1.8",
      platform: "android", session_id: null,
      ...options.device },
    payload: { kind: "message", title: "LETSCUBE", body: "Новое сообщение", chatId, messageId, notificationId,
      url: `/?chat=${chatId}&message=${messageId}`, tag: `message:chat:${chatId}` } };
  currentFixture = f;
  env = {
    KUB_PUSH_DISPATCH_TOKEN: "fixture-dispatch",
    SUPABASE_URL: "https://fixture.invalid",
    SUPABASE_SECRET_KEY: "fixture-backend",
    VAPID_PUBLIC_KEY: "fixture-public",
    VAPID_PRIVATE_KEY: "fixture-private",
    ALBUM_PUSH_DISPATCH_ENABLED: "1",
    FCM_PROJECT_ID: "fixture-project",
    FCM_CLIENT_EMAIL: "fixture@example.invalid",
    FCM_PRIVATE_KEY: privateKey,
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    requests.push({ path: url.pathname, url, init });
    if (url.pathname === "/rest/v1/rpc/push_outbox_claim") return Response.json([]);
    if (url.pathname === "/rest/v1/rpc/native_push_outbox_claim") return Response.json([]);
    if (url.pathname === "/rest/v1/rpc/album_push_claim") {
      claimToken = JSON.parse(init.body).p_claim_token;
      return Response.json([{
        id: rowId, subscription_id: provider === "web" ? subscriptionId : null,
        device_id: provider === "fcm" ? deviceId : null, attempt_count: 0,
      }]);
    }
    if (["/rest/v1/push_subscriptions", "/rest/v1/user_push_devices"].includes(url.pathname)) {
      const target = url.pathname.endsWith("/push_subscriptions") ? f.subscription : f.device;
      if (init.method === "PATCH") {
        f.writes.push({ url, patch: JSON.parse(init.body) });
        const matches = [...url.searchParams].every(([key, value]) => value === "is.null"
          ? target[key] == null : value.startsWith("eq.") && String(target[key]) === value.slice(3));
        if (matches) Object.assign(target, JSON.parse(init.body));
        return Response.json(matches ? [{ id: target.id }] : []);
      }
      if (options.lookupError) return new Response("unavailable", { status: 503 });
      const columns = url.searchParams.get("select").split(",");
      return Response.json(options.missing ? [] : [Object.fromEntries(Object.entries(target).filter(([key]) => columns.includes(key)))]);
    }
    if (url.pathname === "/rest/v1/rpc/album_push_recheck" || url.pathname === "/rest/v1/rpc/album_push_recheck_bound") {
      const args = JSON.parse(init.body);
      if (url.pathname.endsWith("_bound")) {
        const cached = f.cachedTarget;
        assert.deepEqual(args, { p_outbox_id: rowId, p_claim_token: claimToken, p_target_id: cached.id,
          p_target_fingerprint: fingerprint(cached, provider === "web") });
      } else assert.deepEqual(args, { p_outbox_id: rowId, p_claim_token: claimToken });
      assert.equal(webCalls.length + fcmCalls.length, 0);
      f.rechecks += 1;
      events.push("recheck");
      if (f.rechecks === 2 && options.finalError) return new Response("unavailable", { status: 503 });
      if (f.rechecks === 2 && options.finalThrow) throw Error("Fixture private content");
      if (f.rechecks === 2 && options.finalMalformed) return Response.json({ status: "deliver" });
      if (url.pathname.endsWith("_bound") && args.p_target_fingerprint !== fingerprint(provider === "web" ? f.subscription : f.device, provider === "web")) {
        return Response.json([{ status: "target_changed", payload: null }]);
      }
      const status = f.liveActive ? f.status : "target_inactive";
      return Response.json([{ status, payload: status === "deliver" ? f.payload : null }]);
    }
    if (url.pathname === "/rest/v1/rpc/album_push_ack") {
      const args = JSON.parse(init.body); f.acks.push(args);
      assert.equal(args.p_outbox_id, rowId); assert.equal(args.p_claim_token, claimToken);
      return Response.json(true);
    }
    if (url.hostname === "oauth2.googleapis.com") {
      events.push("oauth");
      entered.resolve(); if (options.holdOAuth) await release.promise;
      return Response.json({ access_token: "fixture-oauth" });
    }
    if (url.hostname === "fcm.googleapis.com") {
      events.push("provider");
      fcmCalls.push(JSON.parse(init.body));
      options.onProvider?.(f);
      if (options.fcmError) return Response.json({ error: { status: "NOT_FOUND", details: [
        { "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" },
      ] } }, { status: 404 });
      return Response.json({ name: "fixture-accepted" });
    }
    throw new Error(`unexpected fixture request to ${url.pathname}`);
  };
  f.cachedTarget = structuredClone(provider === "web" ? f.subscription : f.device);
  return f;
}

async function heldPrepare(channel, change, assertion, holdDigest = 1) {
  const f = configure(channel, { holdOAuth: channel === "fcm" });
  const original = crypto.subtle.digest;
  let digests = 0;
  if (channel === "web") crypto.subtle.digest = async function (...args) {
    events.push("digest");
    if (++digests === holdDigest) { f.entered.resolve(); await f.release.promise; }
    return original.apply(this, args);
  };
  try {
    const pending = handler(request());
    await f.entered.promise; change(f); f.release.resolve();
    const result = await (await pending).json(); assertion(result, f);
  } finally { f.release.resolve(); crypto.subtle.digest = original; }
}
for (const channel of ["web", "fcm"]) {
  test(`held ${channel} prepare descriptor A-to-B refuses old bytes before provider`, () => heldPrepare(channel,
    f => { if (channel === "web") f.subscription.auth += "-B"; else f.device.session_id = "70000000-0000-4000-8000-000000000099"; },
    result => {
      assert.equal(webCalls.length + fcmCalls.length, 0, "bound album refuses replaced descriptor");
      assert.equal(result.album.sent, 0);
      assert.equal(requests.filter(r => r.path === "/rest/v1/rpc/album_push_recheck_bound").length, 1);
    }));
  test(`held ${channel} prepare followed by denial never reaches provider`, () => heldPrepare(channel,
    f => { f.status = "not_eligible"; }, () => {
      assert.equal(webCalls.length + fcmCalls.length, 0, "revoked while preparing must not reach provider");
    }));
  test(`held ${channel} prepare sends the newly eligible member, not preflight route`, () => heldPrepare(channel,
    f => { const next = "50000000-0000-4000-8000-000000000099";
      f.payload = { ...f.payload, messageId: next, notificationId: "60000000-0000-4000-8000-000000000099",
        url: `/?chat=${chatId}&message=${next}` }; }, () => {
      const sent = channel === "web" ? webCalls[0] : fcmCalls[0];
      assert.equal(JSON.stringify(sent).includes("50000000-0000-4000-8000-000000000099"), true, "provider must use final eligible member");
    }));
}

async function allowed(channel, options = {}) {
  const f = configure(channel, options); const result = await (await handler(request())).json();
  assert.equal(webCalls.length + fcmCalls.length, 1, "fresh album deliver must reach provider once");
  assert.equal(result.album.sent, 1); assert.equal(f.rechecks, 2);
  assert.deepEqual(f.acks, [{ p_outbox_id: rowId, p_claim_token: claimToken, p_outcome: "sent", p_error: null }]);
  return f;
}
for (const channel of ["web", "fcm"]) {
  test(`held ${channel} positive performs final RPC after prepare and before provider`, () => heldPrepare(channel,
    () => {}, (result, f) => {
      assert.deepEqual(events, channel === "web" ? ["recheck", "digest", "digest", "recheck", "provider"]
        : ["recheck", "oauth", "recheck", "provider"]);
      assert.equal(result.album.sent, 1); assert.equal(f.acks.length, 1);
    }));
  for (const status of ["read", "target_inactive", "foreground", "claim_lost", "unexpected"]) {
    test(`held ${channel} final ${status} cannot send`, () => heldPrepare(channel,
      f => { f.status = status; }, (result, f) => {
        assert.equal(webCalls.length + fcmCalls.length, 0, "final refused authority must not send");
        assert.equal(f.rechecks, 2);
        if (status === "unexpected") {
          assert.equal(result.album.failed, 1);
          assert.deepEqual(f.acks, [{ p_outbox_id: rowId, p_claim_token: claimToken, p_outcome: "release", p_error: "invalid_recheck" }]);
        } else assert.equal(f.acks.length, 0, "trusted RPC owns denial settlement");
      }));
  }
  for (const flag of ["finalError", "finalThrow", "finalMalformed"]) {
    test(`${channel} ${flag} refuses final authority without provider`, async () => {
      const f = configure(channel, { [flag]: true }); const result = await (await handler(request())).json();
      assert.equal(webCalls.length + fcmCalls.length, 0); assert.equal(result.album.failed, 1);
      assert.deepEqual(f.acks, [{ p_outbox_id: rowId, p_claim_token: claimToken, p_outcome: "release", p_error: "invalid_recheck" }]);
    });
  }
  test(`current inactive ${channel} RPC state still refuses cached active descriptor`, async () => {
    const f = configure(channel, { liveActive: false }); await handler(request());
    assert.equal(webCalls.length + fcmCalls.length, 0); assert.equal(f.rechecks, 1); assert.equal(f.acks.length, 0);
  });
  for (const options of [{ missing: true }, { lookupError: true }]) {
    test(`${channel} unavailable cached descriptor releases instead of permanent suppression: ${JSON.stringify(options)}`, async () => {
      const f = configure(channel, options); await handler(request());
      assert.equal(webCalls.length + fcmCalls.length, 0); assert.equal(f.acks.length, 1);
      assert.equal(f.acks[0].p_outcome, "release");
    });
  }
}

async function lateFailure(channel, field = "user_id") {
  const options = { webError: { statusCode: 410 }, fcmError: true, onProvider: f => {
    const target = channel === "web" ? f.subscription : f.device;
    target[field] = field === "user_id" ? "70000000-0000-4000-8000-000000000099" : "fictional-replacement";
  } };
  const f = configure(channel, options); const result = await (await handler(request())).json();
  const target = channel === "web" ? f.subscription : f.device;
  assert.equal(channel === "web" ? target.is_active : target.enabled, true, "late permanent failure must preserve replacement descriptor");
  assert.equal(webCalls.length + fcmCalls.length, 1); assert.equal(result.album.pruned, 1);
  assert.equal(f.acks.length, 1); assert.equal(f.acks[0].p_outcome, "gone");
  assert.equal(f.writes.length, 1);
}
for (const [channel, fields] of [["web", ["user_id", "endpoint", "p256dh", "auth"]], ["fcm", ["user_id", "token", "provider", "app_version"]]]) {
  for (const field of fields) test(`album ${channel} late permanent error cannot retire changed ${field}`, () => lateFailure(channel, field));
  test(`album ${channel} unchanged permanent failure retires exact sent descriptor`, async () => {
    const f = configure(channel, { webError: { statusCode: 410 }, fcmError: true }); await handler(request());
    assert.equal(channel === "web" ? f.subscription.is_active : f.device.enabled, false);
    const params = Object.fromEntries(f.writes[0].url.searchParams);
    assert.deepEqual(Object.keys(params).sort(), channel === "web"
      ? ["auth", "endpoint", "id", "p256dh", "user_id"] : ["app_version", "id", "platform", "provider", "session_id", "token", "user_id"]);
    assert.equal(params.user_id, "eq.70000000-0000-4000-8000-000000000001");
  });
}
test("native album retirement retains null app-version CAS", async () => {
  const f = configure("fcm", { fcmError: true, device: { app_version: null } }); await handler(request());
  assert.equal(f.writes[0].url.searchParams.get("app_version"), "is.null");
  assert.equal(f.device.enabled, false);
});

const indexUrl = new URL("../../supabase/functions/send-push-notifications/index.ts", import.meta.url);
const albumUrl = new URL("../../supabase/functions/send-push-notifications/album-dispatch.ts", import.meta.url);
const indexSource = readFileSync(indexUrl, "utf8").replaceAll("\r\n", "\n");
const albumSource = readFileSync(albumUrl, "utf8").replaceAll("\r\n", "\n");
const nativeSource = readFileSync(new URL("./native-push-descriptor.ts", indexUrl), "utf8");
const encoded = text => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(text)).toString("base64")}`;
let mutationSequence = 0;
function replaceOnce(text, needle, replacement) {
  assert.equal(text.split(needle).length - 1, 1, "one actual mutation anchor");
  return text.replace(needle, replacement);
}
function albumBlock(transform) {
  const a = indexSource.indexOf("async function dispatchAlbumPush("), b = indexSource.indexOf("async function dispatchVoice(", a);
  return indexSource.slice(0, a) + transform(indexSource.slice(a, b)) + indexSource.slice(b);
}
async function mutated({ index = indexSource, album = albumSource, native = nativeSource }, scenario) {
  let js = stripTypeScriptTypes(index);
  js = js.replace('"npm:web-push@3.6.7"', '"data:text/javascript,export default globalThis.__albumWebpush"');
  js = js.replace(/"(\.\/[^"\n]+\.ts)"/g, (_match, path) => JSON.stringify(path === "./album-dispatch.ts" ? encoded(album)
    : path === "./native-push-descriptor.ts" ? encoded(native) : new URL(path, indexUrl).href));
  const original = handler;
  try { await import(`${encoded(js)}#album-${++mutationSequence}`); await scenario(); }
  finally { handler = original; }
}
const noSend = channel => () => heldPrepare(channel, f => { f.status = "not_eligible"; }, () => {
  assert.equal(webCalls.length + fcmCalls.length, 0, "revoked while preparing must not reach provider");
}, 2);
const freshMember = channel => () => heldPrepare(channel, f => {
  const next = "50000000-0000-4000-8000-000000000099";
  f.payload = { ...f.payload, messageId: next, url: `/?chat=${chatId}&message=${next}` };
}, () => {
  assert.equal(JSON.stringify(channel === "web" ? webCalls[0] : fcmCalls[0]).includes("50000000-0000-4000-8000-000000000099"), true, "provider must use final eligible member");
});
for (const channel of ["web", "fcm"]) {
  for (const [label, input, scenario, message] of [
    ["omit final RPC", () => ({ album: replaceOnce(albumSource, "fresh = recheck(await deps.recheck(row.id, token, binding));", "fresh = eligible;") }),
      noSend(channel), "revoked while preparing must not reach provider"],
    ["send preflight payload", () => ({ album: replaceOnce(albumSource, "prepared.send(fresh.payload!)", "prepared.send(eligible.payload)") }),
      freshMember(channel), "provider must use final eligible member"],
    ["retirement by id only", () => channel === "web"
      ? ({ index: albumBlock(text => replaceOnce(text, '["id", "user_id", "endpoint", "p256dh", "auth"] as const', '["id"] as const')) })
      : ({ native: replaceOnce(nativeSource, '["id", "user_id", "platform", "provider", "token", "app_version", "session_id"] as const', '["id"] as const') }),
      () => lateFailure(channel), "late permanent failure must preserve replacement descriptor"],
  ]) test(`compiled album ${channel} mutant rejected: ${label}`, async () => {
    await assert.rejects(mutated(input(), scenario), error => {
      assert.equal(error.code, "ERR_ASSERTION", "setup errors cannot kill a mutant");
      assert.equal(error.message.split("\n")[0], message); return true;
    });
  });
  test(`compiled album ${channel} unbound final fallback sends replaced descriptor and is rejected`, async () => {
    await assert.rejects(mutated({ album: replaceOnce(albumSource,
      'deps.recheck(row.id, token, binding)', 'deps.recheck(row.id, token)') }, () => heldPrepare(channel,
      f => { if (channel === "web") f.subscription.auth += "-B"; else f.device.token += "-B"; }, () => {
        assert.equal(webCalls.length + fcmCalls.length, 0, "literal bound album denial");
      })), error => {
      assert.equal(error.code, "ERR_ASSERTION");
      assert.equal(error.message.split("\n")[0], "literal bound album denial");
      return true;
    });
  });
}
for (const [label, input, scenario, message] of [
  ["Web digest after final RPC", () => ({ index: albumBlock(text => replaceOnce(text,
    'const topic = await createWebPushTopic(tag);\n        return { binding: { targetId: descriptor.id, fingerprint }, send: async freshPayload => {',
    'return { binding: { targetId: descriptor.id, fingerprint }, send: async freshPayload => {\n          const topic = await createWebPushTopic(tag);')) }),
    noSend("web"), "revoked while preparing must not reach provider"],
  ["OAuth await after final RPC", () => ({ index: albumBlock(text => replaceOnce(text,
    'const accessToken = await fcmAccessToken;\n        return { binding: { targetId: descriptor.id, fingerprint }, send: async freshPayload => {',
    'return { binding: { targetId: descriptor.id, fingerprint }, send: async freshPayload => {\n          const accessToken = await fcmAccessToken;')) }),
    noSend("fcm"), "revoked while preparing must not reach provider"],
  ["restore cached Web inactive veto", () => ({ index: albumBlock(text => replaceOnce(text, 'if (!descriptor)',
    'if (!descriptor || subscriptions.get(row.subscription_id)?.is_active === false)')) }),
    () => allowed("web", { subscription: { is_active: false } }), "fresh album deliver must reach provider once"],
  ["restore cached native inactive veto", () => ({ index: albumBlock(text => replaceOnce(text, 'if (!descriptor || descriptor.provider',
    'if (!descriptor || !device?.enabled || device.revoked_at || descriptor.provider')) }),
    () => allowed("fcm", { device: { enabled: false } }), "fresh album deliver must reach provider once"],
  ["omit native owner projection", () => ({ index: albumBlock(text => replaceOnce(text,
    '"id,user_id,platform,token,provider,enabled,revoked_at,app_version,session_id"', '"id,platform,token,provider,enabled,revoked_at,app_version,session_id"')) }),
    () => allowed("fcm"), "fresh album deliver must reach provider once"],
  ["omit final neutral payload guard", () => ({ album: replaceOnce(albumSource,
    "!neutralExactMessage(fresh.payload) || ", "") }),
    () => heldPrepare("web", f => { f.payload = { ...f.payload, title: "Fixture private content" }; }, () => {
      assert.equal(webCalls.length + fcmCalls.length, 0, "invalid final payload must not reach provider");
    }), "invalid final payload must not reach provider"],
  ["omit prepared chat binding", () => ({ album: replaceOnce(albumSource,
    " || fresh.payload.chatId !== eligible.payload.chatId", "") }),
    () => heldPrepare("fcm", f => {
      const next = "40000000-0000-4000-8000-000000000099";
      f.payload = { ...f.payload, chatId: next, url: `/?chat=${next}&message=${messageId}`, tag: `message:chat:${next}` };
    }, () => { assert.equal(webCalls.length + fcmCalls.length, 0, "cross-chat final payload must not reach provider"); }),
    "cross-chat final payload must not reach provider"],
]) test(`compiled album mutant rejected: ${label}`, async () => {
  await assert.rejects(mutated(input(), scenario), error => {
    assert.equal(error.code, "ERR_ASSERTION", "setup errors cannot kill a mutant");
    assert.equal(error.message.split("\n")[0], message); return true;
  });
});

for (const [channel, options] of [["web", { subscription: { is_active: false } }],
  ["fcm", { device: { enabled: false, revoked_at: "2026-01-01T00:00:00Z" } }]]) {
  test(`fresh album authority overrides cached inactive ${channel} state`, async () => {
    configure(channel, options); const result = await (await handler(request())).json();
    assert.equal(webCalls.length + fcmCalls.length, 1, "cached inactive must not override fresh album deliver");
    assert.equal(result.album.sent, 1);
  });
}

for (const channel of ["web", "fcm"]) {
  test(`album Edge sends one neutral ${channel} card after recheck`, async () => {
    configure(channel);
    const response = await handler(new Request("https://fixture.invalid/functions/v1/send-push-notifications", {
      method: "POST", headers: { "x-kub-push-token": "fixture-dispatch" }, body: "{}",
    }));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.album.sent, 1);
    assert.equal(webCalls.length + fcmCalls.length, 1);
    const push = channel === "web" ? webCalls[0] : fcmCalls[0];
    assert.equal(JSON.stringify(push).includes(messageId), true);
    assert.equal(JSON.stringify(push).includes("Fixture private content"), false);
    assert.ok(requests.findIndex((entry) => entry.path === "/rest/v1/rpc/album_push_recheck") <
      requests.findIndex((entry) => entry.path === "/rest/v1/rpc/album_push_ack"));
  });
}
