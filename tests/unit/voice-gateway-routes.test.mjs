// The request path of `supabase/functions/voice-gateway/index.ts`, driven end to
// end in node.
//
// The entrypoint is Deno code, and the easy thing would have been to declare it
// untestable and scan its source for strings. That would not have caught any of
// what is asserted below: that a banned caller never reaches the SFU, that a
// full channel is refused before a token is minted, that the administrative
// token used for CreateRoom is never in a response body, that an ignorable
// webhook touches no table, and that a webhook whose body does not match its
// signature causes no database call at all. Those are orderings and absences,
// and a source scan cannot see either.
//
// What makes it run: one resolution hook for the `npm:` specifier, and a plain
// object standing in for `Deno`. Nothing in the function under test is modified
// or re-implemented here.
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { register } from "node:module";
import test from "node:test";

register(new URL("./helpers/voice-gateway-npm-alias.mjs", import.meta.url));

const {
  programSupabase,
  supabaseCalls,
  supabaseCallNames,
} = await import("./helpers/voice-gateway-supabase-stub.mjs");

const CHANNEL_ID = "3f2a9c14-0e5b-4d7a-9b31-7c6d5e4f8a21";
const CHAT_ID = "b7e41d02-9a3c-4f18-8d62-15ac93be7401";
const USER_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const API_KEY = "APIfixturekey";
const API_SECRET = "fixture-secret-not-a-production-value";
const SERVICE_ROLE_KEY = "service-role-fixture-not-a-real-key";
const SIGNALLING_URL = "wss://voice.letscube.test";
const JOINED_SECONDS = 1_757_699_400;
const JOINED_AT = new Date(JOINED_SECONDS * 1_000).toISOString();
const FUNCTION_ORIGIN = "https://core.letscube.test";

const DEFAULT_ENVIRONMENT = {
  SUPABASE_URL: FUNCTION_ORIGIN,
  SUPABASE_ANON_KEY: "anon-fixture",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
  LIVEKIT_URL: SIGNALLING_URL,
  LIVEKIT_API_KEY: API_KEY,
  LIVEKIT_API_SECRET: API_SECRET,
};

let environment = { ...DEFAULT_ENVIRONMENT };
let handler = null;
let fetchCalls = [];
let fetchReply = async () => new Response("{}", { status: 200 });

globalThis.Deno = {
  env: { get: (name) => environment[name] },
  serve: (given) => {
    handler = given;
    return { finished: Promise.resolve() };
  },
};
globalThis.fetch = async (...args) => {
  fetchCalls.push(args);
  return fetchReply(...args);
};

await import("../../supabase/functions/voice-gateway/index.ts");
assert.equal(typeof handler, "function", "the entrypoint did not register a handler");

function reset(plan = {}, overrides = {}) {
  environment = { ...DEFAULT_ENVIRONMENT, ...overrides };
  fetchCalls = [];
  fetchReply = async () => new Response("{}", { status: 200 });
  programSupabase({ serviceRoleKey: SERVICE_ROLE_KEY, ...defaultPlan(), ...plan });
}

function defaultPlan() {
  return {
    getUser: () => ({ data: { user: { id: USER_ID } }, error: null }),
    rpc: (name) => {
      if (name === "is_banned") return { data: false, error: null };
      if (name === "is_muted") return { data: false, error: null };
      if (name === "voice_webhook_event_seen") return { data: true, error: null };
      return { data: null, error: null };
    },
    table: ({ table }) => {
      if (table === "voice_channels") {
        return {
          data: {
            id: CHANNEL_ID,
            chat_id: CHAT_ID,
            max_participants: 10,
            speak_role: "member",
            participant_count: 2,
            archived: false,
          },
          error: null,
        };
      }
      if (table === "chat_members") return { data: { role: "member" }, error: null };
      // The columns this table really has. A stub that answered a column name
      // the database does not carry is what let the gateway ask for
      // `display_name` and look correct here while failing in production.
      if (table === "profiles") {
        return { data: { full_name: "Фиктивный Участник", username: "fixture_user" }, error: null };
      }
      return { data: null, error: null };
    },
  };
}

function tokenRequest(body = { channelId: CHANNEL_ID }, init = {}) {
  return new Request(`${FUNCTION_ORIGIN}/functions/v1/voice-gateway/token`, {
    method: "POST",
    headers: {
      authorization: "Bearer caller-supabase-jwt",
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...(init.omitBody ? { body: undefined } : {}),
  });
}

async function readJson(response) {
  return JSON.parse(await response.text());
}

function decodePayload(jwt) {
  return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
}

function createRoomCall() {
  return fetchCalls.find(([url]) => String(url).includes("CreateRoom")) ?? null;
}

// ── POST /voice-gateway/token ────────────────────────────────────────────────

test("CreateRoom goes to LIVEKIT_API_URL when there is one, not to the public URL", async () => {
  // The URL a browser dials and the URL this function calls are different in
  // production: the first is a path on a shared hostname, the second is the
  // container on the internal network, so the administrative API is never
  // published at all. What comes back to the client must still be the public
  // one -- an internal name is unreachable from a browser.
  reset({}, { LIVEKIT_API_URL: "http://letscube-voice:7880" });
  const response = await handler(tokenRequest());

  assert.equal(response.status, 200);
  const call = createRoomCall();
  assert.ok(call, "no CreateRoom was made");
  assert.equal(
    String(call[0]),
    "http://letscube-voice:7880/twirp/livekit.RoomService/CreateRoom",
  );
  assert.equal((await readJson(response)).url, SIGNALLING_URL);
});

test("without LIVEKIT_API_URL the public URL is still what CreateRoom uses", async () => {
  reset();
  await handler(tokenRequest());

  const call = createRoomCall();
  assert.ok(call, "no CreateRoom was made");
  assert.ok(
    String(call[0]).startsWith(SIGNALLING_URL.replace(/^wss:/, "https:").replace(/^ws:/, "http:")),
    `CreateRoom went to ${call[0]}`,
  );
});

test("the profile read names columns the database actually has", async () => {
  reset();
  await handler(tokenRequest());

  const profileRead = supabaseCalls().find(
    (call) => call.kind === "table" && call.name === "profiles",
  );
  assert.ok(profileRead, "the gateway never read the profile");
  // `public.profiles` carries `full_name` and `username` and no `display_name`,
  // read off production on 2026-09-13. PostgREST answers an unknown column with
  // an error, and the cosmetic fallback here would have swallowed it silently
  // -- every caller would have joined the room nameless and nothing would say
  // why.
  for (const column of profileRead.columns.split(",").map((part) => part.trim())) {
    assert.ok(
      ["full_name", "username"].includes(column),
      `asked profiles for ${column}`,
    );
  }
});

test("a member of the chat is given a join token for the derived room", async () => {
  reset();
  const response = await handler(tokenRequest());
  const body = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.url, SIGNALLING_URL);
  assert.equal(body.room, `vc_${CHANNEL_ID}`);
  assert.equal(body.identity, USER_ID);
  assert.equal(body.canPublish, true);
  assert.equal(body.maxParticipants, 10);

  const claims = decodePayload(body.token);
  assert.equal(claims.video.room, `vc_${CHANNEL_ID}`);
  assert.equal(claims.video.roomAdmin, false);
  assert.equal(claims.video.roomCreate, false);
  assert.equal(claims.sub, USER_ID);
  assert.equal(claims.exp - claims.nbf, 610);
});

test("the room is created on the SFU with the cap, before the token is useful", async () => {
  reset();
  await handler(tokenRequest());

  const call = createRoomCall();
  assert.ok(call, "CreateRoom was not called");
  assert.equal(call[0], "https://voice.letscube.test/twirp/livekit.RoomService/CreateRoom");
  const sent = JSON.parse(call[1].body);
  assert.deepEqual(sent, {
    name: `vc_${CHANNEL_ID}`,
    maxParticipants: 10,
    emptyTimeout: 60,
  });
});

test("the administrative token is used against the SFU and never sent to anyone", async () => {
  reset();
  const response = await handler(tokenRequest());
  const raw = await response.text();
  const body = JSON.parse(raw);

  const call = createRoomCall();
  const adminToken = String(call[1].headers.authorization).slice("Bearer ".length);
  const adminClaims = decodePayload(adminToken);
  assert.equal(adminClaims.video.roomCreate, true);
  assert.equal(adminClaims.video.roomJoin, false);

  assert.notEqual(adminToken, body.token);
  assert.equal(raw.includes(adminToken), false, "the admin token is in the response");
  assert.equal(raw.includes(API_SECRET), false);
  assert.equal(raw.includes(SERVICE_ROLE_KEY), false);
});

test("a caller with no Supabase token, or one the API rejects, gets 401", async () => {
  reset();
  const missing = await handler(tokenRequest({ channelId: CHANNEL_ID }, { headers: { authorization: "" } }));
  assert.equal(missing.status, 401);
  assert.deepEqual(await readJson(missing), { ok: false, error: "unauthorized" });

  reset({ getUser: () => ({ data: { user: null }, error: new Error("bad jwt") }) });
  const rejected = await handler(tokenRequest());
  assert.equal(rejected.status, 401);
  assert.equal(createRoomCall(), null);
});

test("a channel id that is not a uuid is refused before anything is read", async () => {
  for (const channelId of ["", "scratch", `${CHANNEL_ID} or 1=1`, null, 5, undefined]) {
    reset();
    const response = await handler(tokenRequest({ channelId }));
    assert.equal(response.status, 400, `accepted ${JSON.stringify(channelId)}`);
    assert.deepEqual(await readJson(response), { ok: false, error: "invalid_request" });
    assert.equal(supabaseCalls().length, 0);
  }
  reset();
  const notJson = await handler(tokenRequest("{not json"));
  assert.equal(notJson.status, 400);
});

test("a banned caller never reaches the channel, the membership or the SFU", async () => {
  reset({
    rpc: (name) => (name === "is_banned" ? { data: true, error: null } : { data: null, error: null }),
  });
  const response = await handler(tokenRequest());

  assert.equal(response.status, 403);
  assert.deepEqual(await readJson(response), { ok: false, error: "banned" });
  assert.equal(createRoomCall(), null);
  assert.equal(
    supabaseCallNames().some((name) => name.startsWith("table:")),
    false,
    "a banned caller caused a table read",
  );
});

test("a missing or archived channel is 404 and a non-member is 403", async () => {
  reset({ table: ({ table }) => (table === "voice_channels" ? { data: null, error: null } : { data: null, error: null }) });
  const missing = await handler(tokenRequest());
  assert.equal(missing.status, 404);
  assert.deepEqual(await readJson(missing), { ok: false, error: "channel_not_found" });

  const base = defaultPlan();
  reset({
    table: (state) => {
      if (state.table === "voice_channels") {
        const row = base.table(state);
        return { data: { ...row.data, archived: true }, error: null };
      }
      return base.table(state);
    },
  });
  const archived = await handler(tokenRequest());
  assert.equal(archived.status, 404);

  reset({
    table: (state) => (state.table === "chat_members" ? { data: null, error: null } : base.table(state)),
  });
  const stranger = await handler(tokenRequest());
  assert.equal(stranger.status, 403);
  assert.deepEqual(await readJson(stranger), { ok: false, error: "not_a_member" });
  assert.equal(createRoomCall(), null);
});

test("the membership row is read for this caller and this chat", async () => {
  reset();
  await handler(tokenRequest());
  const membership = supabaseCalls().find((call) => call.name === "chat_members");
  assert.deepEqual(membership.filters, { chat_id: CHAT_ID, user_id: USER_ID });
  const channel = supabaseCalls().find((call) => call.name === "voice_channels");
  assert.deepEqual(channel.filters, { id: CHANNEL_ID });
  assert.equal(channel.columns.includes("*"), false);
});

test("a full channel is refused before a room is created or a token minted", async () => {
  const base = defaultPlan();
  reset({
    table: (state) => {
      if (state.table === "voice_channels") {
        const row = base.table(state);
        return { data: { ...row.data, participant_count: 10 }, error: null };
      }
      return base.table(state);
    },
  });
  const response = await handler(tokenRequest());
  const body = await readJson(response);

  assert.equal(response.status, 409);
  assert.deepEqual(body, { ok: false, error: "channel_full" });
  assert.equal(createRoomCall(), null);
  assert.equal("token" in body, false);
});

test("a muted member joins without permission to publish", async () => {
  reset({
    rpc: (name) => {
      if (name === "is_banned") return { data: false, error: null };
      if (name === "is_muted") return { data: true, error: null };
      return { data: null, error: null };
    },
  });
  const body = await readJson(await handler(tokenRequest()));

  assert.equal(body.canPublish, false);
  const claims = decodePayload(body.token);
  assert.equal(claims.video.canPublish, false);
  assert.equal(claims.video.roomJoin, true);
  assert.equal(claims.video.canSubscribe, true);
});

test("a listen-only channel refuses publication to a plain member", async () => {
  const base = defaultPlan();
  reset({
    table: (state) => {
      if (state.table === "voice_channels") {
        const row = base.table(state);
        return { data: { ...row.data, speak_role: "admin" }, error: null };
      }
      return base.table(state);
    },
  });
  assert.equal(decodePayload((await readJson(await handler(tokenRequest()))).token).video.canPublish, false);

  reset({
    table: (state) => {
      if (state.table === "voice_channels") {
        const row = base.table(state);
        return { data: { ...row.data, speak_role: "admin" }, error: null };
      }
      if (state.table === "chat_members") return { data: { role: "owner" }, error: null };
      return base.table(state);
    },
  });
  assert.equal(decodePayload((await readJson(await handler(tokenRequest()))).token).video.canPublish, true);
});

test("an SFU that refuses or does not answer produces no token", async () => {
  reset();
  fetchReply = async () => new Response("boom", { status: 500 });
  const refused = await handler(tokenRequest());
  const refusedBody = await readJson(refused);
  assert.equal(refused.status, 503);
  assert.deepEqual(refusedBody, { ok: false, error: "voice_unavailable" });

  reset();
  fetchReply = async () => {
    throw new TypeError("connection refused");
  };
  const silent = await handler(tokenRequest());
  assert.equal(silent.status, 503);
  assert.equal((await readJson(silent)).error, "voice_unavailable");
});

test("a database error is 503 and never leaks its message", async () => {
  reset({
    rpc: (name) =>
      name === "is_banned"
        ? { data: null, error: { message: "permission denied for function is_banned" } }
        : { data: null, error: null },
  });
  const response = await handler(tokenRequest());
  const raw = await response.text();
  assert.equal(response.status, 503);
  assert.deepEqual(JSON.parse(raw), { ok: false, error: "unavailable" });
  assert.equal(raw.includes("permission denied"), false);
});

test("an unconfigured deployment says so instead of minting something unsigned", async () => {
  for (const missing of ["LIVEKIT_API_SECRET", "LIVEKIT_API_KEY", "LIVEKIT_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    reset({}, { [missing]: undefined });
    const response = await handler(tokenRequest());
    assert.equal(response.status, 503, `${missing} was tolerated`);
    assert.deepEqual(await readJson(response), { ok: false, error: "not_configured" });
  }
  reset({}, { LIVEKIT_URL: "not a url" });
  assert.equal((await handler(tokenRequest())).status, 503);
});

test("the routes, the methods and the preflight", async () => {
  reset();
  const wrongMethod = await handler(
    new Request(`${FUNCTION_ORIGIN}/functions/v1/voice-gateway/token`, { method: "GET" }),
  );
  assert.equal(wrongMethod.status, 405);

  for (const path of ["", "/tokens", "/token/extra", "/webhooks", "/../token"]) {
    const response = await handler(
      new Request(`${FUNCTION_ORIGIN}/functions/v1/voice-gateway${path}`, { method: "POST" }),
    );
    assert.equal(response.status, 404, `route ${path} was served`);
  }

  const preflight = await handler(
    new Request(`${FUNCTION_ORIGIN}/functions/v1/voice-gateway/token`, {
      method: "OPTIONS",
      headers: { origin: "https://app.letscube.ru" },
    }),
  );
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://app.letscube.ru");

  const foreign = await handler(
    new Request(`${FUNCTION_ORIGIN}/functions/v1/voice-gateway/token`, {
      method: "OPTIONS",
      headers: { origin: "https://evil.example" },
    }),
  );
  assert.equal(foreign.headers.get("access-control-allow-origin"), null);
});

// ── POST /voice-gateway/webhook ──────────────────────────────────────────────

function webhookRequest(event, options = {}) {
  const body = typeof event === "string" ? event : JSON.stringify(event);
  const bytes = Buffer.from(body, "utf8");
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const claims = {
    iss: options.issuer ?? API_KEY,
    exp: Math.floor(Date.now() / 1_000) + 300,
    sha256: createHash("sha256").update(options.signOver ?? bytes).digest("base64"),
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", options.secret ?? API_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  // The header LiveKit 1.8.4 was measured sending on the probe on 2026-09-13:
  // the compact JWS on its own, with no `Bearer` and no scheme. Every test
  // below runs against that form by default, because the first draft of this
  // file used `Bearer` -- the same assumption the code was written from -- and
  // the suite stayed green over a gateway that would have refused every real
  // delivery. `bearerScheme` keeps the documented form covered too.
  const token = `${header}.${payload}.${signature}`;
  return new Request(`${FUNCTION_ORIGIN}/functions/v1/voice-gateway/webhook`, {
    method: "POST",
    headers: {
      "content-type": options.contentType ?? "application/webhook+json",
      ...(options.omitAuthorization
        ? {}
        : { authorization: options.bearerScheme ? `Bearer ${token}` : token }),
    },
    body,
  });
}

function participantEvent(overrides = {}) {
  return {
    event: "participant_joined",
    id: "EV_7pQm2Lx9RtVb",
    createdAt: String(Math.floor(Date.now() / 1_000)),
    room: { sid: "RM_abc", name: `vc_${CHANNEL_ID}` },
    participant: { sid: "PA_abc", identity: USER_ID, joinedAt: String(JOINED_SECONDS) },
    ...overrides,
  };
}

test("a verified participant_joined is deduped and then applied", async () => {
  reset();
  const response = await handler(webhookRequest(participantEvent()));

  assert.equal(response.status, 200);
  assert.deepEqual(await readJson(response), { ok: true, status: "applied" });

  const rpcs = supabaseCalls().filter((call) => call.kind === "rpc");
  assert.deepEqual(rpcs.map((call) => call.name), [
    "voice_webhook_event_seen",
    "voice_participant_joined",
  ]);
  assert.deepEqual(rpcs[1].args, {
    p_channel_id: CHANNEL_ID,
    p_user_id: USER_ID,
    p_joined_at: JOINED_AT,
  });
  // LiveKit's own event id is not a uuid; what reaches the RPC must be one.
  assert.match(
    rpcs[0].args.p_event_id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test("the documented Bearer form is accepted as well as the one it sends", async () => {
  reset();
  const response = await handler(
    webhookRequest(participantEvent(), { bearerScheme: true }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await readJson(response), { ok: true, status: "applied" });
});

test("a second delivery of the same event changes nothing", async () => {
  reset({
    rpc: (name) => (name === "voice_webhook_event_seen" ? { data: false, error: null } : { data: null, error: null }),
  });
  const response = await handler(webhookRequest(participantEvent()));

  assert.equal(response.status, 200);
  assert.deepEqual(await readJson(response), { ok: true, status: "duplicate" });
  assert.deepEqual(
    supabaseCalls().filter((call) => call.kind === "rpc").map((call) => call.name),
    ["voice_webhook_event_seen"],
  );
});

test("a webhook that is not signed by the SFU causes no database call at all", async () => {
  for (
    const options of [
      { secret: "not-the-secret" },
      { issuer: "APIsomeoneelse" },
      { omitAuthorization: true },
      { signOver: Buffer.from("{}", "utf8") },
    ]
  ) {
    reset();
    const response = await handler(webhookRequest(participantEvent(), options));
    assert.equal(response.status, 401, `accepted ${JSON.stringify(options)}`);
    assert.deepEqual(await readJson(response), { ok: false, error: "unauthorized" });
    assert.deepEqual(supabaseCalls(), [], "an unverified webhook reached the database");
  }
});

test("an event nothing acts on is answered without touching the database", async () => {
  for (
    const event of [
      participantEvent({ event: "track_published" }),
      participantEvent({ room: { name: "scratch" } }),
    ]
  ) {
    reset();
    const response = await handler(webhookRequest(event));
    assert.equal(response.status, 200);
    assert.deepEqual(await readJson(response), { ok: true, status: "ignored" });
    assert.deepEqual(supabaseCalls(), []);
  }
});

test("a participant_left is applied with the session's own joined_at", async () => {
  reset();
  await handler(
    handlerLeftRequest(),
  );
  const rpcs = supabaseCalls().filter((call) => call.kind === "rpc");
  assert.equal(rpcs[1].name, "voice_participant_left");
  assert.equal(rpcs[1].args.p_joined_at, JOINED_AT);
});

function handlerLeftRequest() {
  return webhookRequest(participantEvent({ event: "participant_left", id: "EV_left" }));
}

test("room_finished clears active_since and room_started sets it", async () => {
  reset();
  await handler(
    webhookRequest({
      event: "room_finished",
      id: "EV_finished",
      createdAt: String(Math.floor(Date.now() / 1_000)),
      room: { name: `vc_${CHANNEL_ID}`, creationTime: String(JOINED_SECONDS) },
    }),
  );
  const finished = supabaseCalls().filter((call) => call.kind === "rpc");
  assert.equal(finished[1].name, "voice_channel_set_active");
  assert.deepEqual(finished[1].args, { p_channel_id: CHANNEL_ID, p_active_since: null });

  reset();
  await handler(
    webhookRequest({
      event: "room_started",
      id: "EV_started",
      createdAt: String(Math.floor(Date.now() / 1_000)),
      room: { name: `vc_${CHANNEL_ID}`, creationTime: String(JOINED_SECONDS) },
    }),
  );
  const started = supabaseCalls().filter((call) => call.kind === "rpc");
  assert.deepEqual(started[1].args, {
    p_channel_id: CHANNEL_ID,
    p_active_since: JOINED_AT,
  });
});

test("a malformed or unusable webhook body is 400 and writes nothing", async () => {
  reset();
  const notJson = await handler(webhookRequest("{not json"));
  assert.equal(notJson.status, 400);
  assert.deepEqual(supabaseCalls(), []);

  reset();
  const noJoinedAt = await handler(
    handlerNoJoinedAt(),
  );
  assert.equal(noJoinedAt.status, 400);
  assert.deepEqual(await readJson(noJoinedAt), { ok: false, error: "invalid_request" });
  assert.deepEqual(supabaseCalls(), []);

  reset();
  const empty = await handler(
    new Request(`${FUNCTION_ORIGIN}/functions/v1/voice-gateway/webhook`, { method: "POST" }),
  );
  assert.equal(empty.status, 400);
});

function handlerNoJoinedAt() {
  return webhookRequest(
    participantEvent({ participant: { identity: USER_ID } }),
  );
}

test("a failing RPC is 503 rather than a silent success", async () => {
  reset({
    rpc: (name) =>
      name === "voice_webhook_event_seen"
        ? { data: true, error: null }
        : { data: null, error: { message: "deadlock detected" } },
  });
  const response = await handler(webhookRequest(participantEvent()));
  const raw = await response.text();
  assert.equal(response.status, 503);
  assert.deepEqual(JSON.parse(raw), { ok: false, error: "unavailable" });
  assert.equal(raw.includes("deadlock"), false);
});

test("an idempotency call that answers neither true nor false is not assumed", async () => {
  reset({
    rpc: (name) =>
      name === "voice_webhook_event_seen" ? { data: null, error: null } : { data: null, error: null },
  });
  const response = await handler(webhookRequest(participantEvent()));
  assert.equal(response.status, 503);
  assert.deepEqual(
    supabaseCalls().filter((call) => call.kind === "rpc").map((call) => call.name),
    ["voice_webhook_event_seen"],
  );
});
