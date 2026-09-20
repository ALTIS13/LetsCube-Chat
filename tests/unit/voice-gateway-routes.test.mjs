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
      // Slice 5's two limits. Answered here rather than left to the
      // `{ data: null }` fallthrough on purpose: the gateway reads an
      // unrecognised answer as «I could not ask» and allows, so a fixture that
      // did not answer would put every test in this file on the degraded path
      // and none of them on the one production takes.
      if (name === "voice_rate_limit_consume") return { data: { ok: true }, error: null };
      if (name === "voice_active_participants") return { data: 0, error: null };
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

// `resetToken` rather than `reset`: the token route's per-isolate limiter is
// one object for the life of this process and these three are mints like any
// other -- see the note above `nextTokenCallerId`. Written with `reset` first,
// which turned an unrelated test twenty lines up into a 429.
test("an unlimited channel admits the eleventh person, and asks the SFU for no cap", async () => {
  // The owner, 2026-09-20: «изначально ограничения быть не должно». Against the
  // shipped code this was a **503**, not a 409 — `maxParticipants < 1` was read
  // as a misconfigured deployment — so nothing anywhere said «no limit» and the
  // column could not express what the owner asked for.
  const base = defaultPlan();
  resetToken({
    table: (state) => {
      if (state.table === "voice_channels") {
        const row = base.table(state);
        return {
          data: { ...row.data, max_participants: 0, participant_count: 10 },
          error: null,
        };
      }
      return base.table(state);
    },
  });
  const response = await handler(tokenRequest());
  const body = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.maxParticipants, 0);
  assert.equal(typeof body.token, "string");

  // And the room it creates carries the same zero. This only means «unbounded»
  // to an SFU whose own `room.max_participants` is 0 — measured on 2026-09-20,
  // a `CreateRoom` asking 0 against the production config of 10 came back
  // holding 10 — which is why `/srv/letscube/voice/livekit.yaml` changes with
  // this commit and why `seatLimit.mjs` names that dependency.
  const call = createRoomCall();
  assert.ok(call, "no CreateRoom was made");
  assert.equal(JSON.parse(call[1].body).maxParticipants, 0);
});

test("a two-seat channel still refuses a third, which is a private chat's definition and not a cap", async () => {
  // `public.voice_private_room` gives every private chat a room of exactly two
  // and re-asserts it on every call, and
  // `20260920130000_a_group_voice_channel_has_no_seat_limit.sql` now holds that
  // in a trigger as well. The reason is the owner's: Discord answers «a third
  // person is needed in a DM» with a **group DM** — a different object — not
  // with a wider DM. So this refusal must survive a change whose whole purpose
  // is to remove a limit, and it is the case that proves the change did not
  // over-reach.
  const base = defaultPlan();
  resetToken({
    table: (state) => {
      if (state.table === "voice_channels") {
        const row = base.table(state);
        return {
          data: { ...row.data, max_participants: 2, participant_count: 2 },
          error: null,
        };
      }
      return base.table(state);
    },
  });
  const response = await handler(tokenRequest());
  const body = await readJson(response);

  assert.equal(response.status, 409);
  assert.deepEqual(body, { ok: false, error: "channel_full" });
  assert.equal(createRoomCall(), null);
});

test("a seat count the column could not have held is a refusal, not an open door", async () => {
  // A negative `max_participants` cannot pass the CHECK, so seeing one means
  // the row was not read as this function believes. Reading it as 0 would turn
  // a broken row into a channel with no limit at all, which is the failure this
  // whole change has to avoid being able to produce.
  const base = defaultPlan();
  resetToken({
    table: (state) => {
      if (state.table === "voice_channels") {
        const row = base.table(state);
        return { data: { ...row.data, max_participants: -1 }, error: null };
      }
      return base.table(state);
    },
  });
  const response = await handler(tokenRequest());

  assert.equal(response.status, 503);
  assert.deepEqual(await readJson(response), { ok: false, error: "unavailable" });
  assert.equal(createRoomCall(), null);
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

// ── POST /voice-gateway/force-mute, POST /voice-gateway/remove ───────────────
//
// Slice 5's two moderation actions, driven through the same handler as the
// routes above. What is asserted here is the *ordering and the absences*: that
// a plain member never reaches the SFU, that the owner is refused whoever asks,
// that lifting a mute cannot grant more than the token would, and that a twirp
// refusal comes back as a refusal instead of a cheerful 200. A source scan can
// see none of those.
//
// Each test uses a caller of its own, because the gateway's rate limiter is one
// object for the life of the isolate and a fixture that shared a caller across
// twenty tests would start answering 429 halfway down this file. The one test
// that wants a 429 asks for it on purpose.

let callerSeed = 0;
function nextCallerId() {
  callerSeed += 1;
  return `aaaaaaaa-0000-4000-8000-${String(callerSeed).padStart(12, "0")}`;
}
const TARGET_ID = "bbbbbbbb-1111-4111-8111-111111111111";
const OWNER_ID = "cccccccc-2222-4222-8222-222222222222";

function moderationPlan(options = {}) {
  const {
    callerId,
    callerRole = "admin",
    targetRole = "member",
    speakRole = "member",
    archived = false,
    channelRow,
    staffMuted = false,
    rpcError = null,
  } = options;
  return {
    getUser: () => ({ data: { user: { id: callerId } }, error: null }),
    rpc: (name) => {
      if (name === rpcError) return { data: null, error: { message: "permission denied" } };
      if (name === "is_banned") return { data: options.banned === true, error: null };
      if (name === "is_muted") return { data: staffMuted, error: null };
      if (name === "voice_rate_limit_consume") {
        return { data: options.deploymentLimit ?? { ok: true }, error: null };
      }
      return { data: null, error: null };
    },
    table: (state) => {
      if (state.table === "voice_channels") {
        if (channelRow === null) return { data: null, error: null };
        return {
          data: channelRow ?? {
            id: CHANNEL_ID,
            chat_id: CHAT_ID,
            speak_role: speakRole,
            archived,
          },
          error: null,
        };
      }
      if (state.table === "chat_members") {
        const role = state.filters.user_id === callerId ? callerRole : targetRole;
        return { data: role === null ? null : { role }, error: null };
      }
      return { data: null, error: null };
    },
  };
}

function resetModeration(options = {}) {
  const callerId = options.callerId ?? nextCallerId();
  reset(moderationPlan({ ...options, callerId }));
  return callerId;
}

function moderationRequest(action, body, init = {}) {
  return new Request(`${FUNCTION_ORIGIN}/functions/v1/voice-gateway/${action}`, {
    method: "POST",
    headers: {
      authorization: "Bearer caller-supabase-jwt",
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function twirpCall(method) {
  return fetchCalls.find(([url]) => String(url).endsWith(`/${method}`)) ?? null;
}

function twirpCalls() {
  return fetchCalls.map(([url]) => String(url).split("/").pop());
}

test("an administrator mutes a member, and the SFU is told exactly what changes", async () => {
  resetModeration();
  const response = await handler(
    moderationRequest("force-mute", { channelId: CHANNEL_ID, userId: TARGET_ID, muted: true }),
  );
  const raw = await response.text();
  const body = JSON.parse(raw);

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.muted, true);
  assert.equal(body.canPublish, false);

  const call = twirpCall("UpdateParticipant");
  assert.ok(call, `no UpdateParticipant; calls were ${twirpCalls().join(", ")}`);
  assert.equal(
    String(call[0]),
    "https://voice.letscube.test/twirp/livekit.RoomService/UpdateParticipant",
  );
  assert.deepEqual(JSON.parse(call[1].body), {
    room: `vc_${CHANNEL_ID}`,
    identity: TARGET_ID,
    permission: {
      canSubscribe: true,
      canPublish: false,
      canPublishData: false,
      canUpdateMetadata: false,
      hidden: false,
      recorder: false,
      agent: false,
    },
  });

  // The admin token is room-scoped -- an unscoped one is refused by this SFU,
  // measured on 2026-09-18 -- and it never appears in the answer.
  const adminToken = String(call[1].headers.authorization).slice("Bearer ".length);
  const claims = decodePayload(adminToken);
  assert.equal(claims.video.room, `vc_${CHANNEL_ID}`);
  assert.equal(claims.video.roomAdmin, true);
  assert.equal(claims.video.roomJoin, false);
  assert.equal(raw.includes(adminToken), false, "the admin token is in the response");
  assert.equal(raw.includes(API_SECRET), false);
  assert.equal(raw.includes(SERVICE_ROLE_KEY), false);
});

test("an administrator removes a member", async () => {
  resetModeration();
  const response = await handler(
    moderationRequest("remove", { channelId: CHANNEL_ID, userId: TARGET_ID }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await readJson(response), {
    ok: true,
    channelId: CHANNEL_ID,
    userId: TARGET_ID,
  });
  const call = twirpCall("RemoveParticipant");
  assert.ok(call, `no RemoveParticipant; calls were ${twirpCalls().join(", ")}`);
  assert.deepEqual(JSON.parse(call[1].body), {
    room: `vc_${CHANNEL_ID}`,
    identity: TARGET_ID,
  });
});

test("an owner may moderate too", async () => {
  resetModeration({ callerRole: "owner" });
  const response = await handler(
    moderationRequest("force-mute", { channelId: CHANNEL_ID, userId: TARGET_ID, muted: true }),
  );
  assert.equal(response.status, 200);
  assert.ok(twirpCall("UpdateParticipant"));
});

test("a plain member is refused, and never reaches the SFU", async () => {
  for (const action of ["force-mute", "remove"]) {
    resetModeration({ callerRole: "member" });
    const response = await handler(
      moderationRequest(action, { channelId: CHANNEL_ID, userId: TARGET_ID, muted: true }),
    );
    assert.equal(response.status, 403, `${action} allowed a plain member`);
    assert.deepEqual(await readJson(response), { ok: false, error: "not_a_moderator" });
    assert.deepEqual(fetchCalls, [], `${action} called the SFU for a plain member`);
  }
});

test("somebody who is not in the chat at all is refused before the target is read", async () => {
  resetModeration({ callerRole: null, targetRole: null });
  const response = await handler(
    moderationRequest("remove", { channelId: CHANNEL_ID, userId: TARGET_ID }),
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await readJson(response), { ok: false, error: "not_a_member" });
  assert.deepEqual(fetchCalls, []);
});

test("the chat's owner cannot be muted or removed, by anyone", async () => {
  for (const action of ["force-mute", "remove"]) {
    for (const callerRole of ["admin", "owner"]) {
      resetModeration({ callerRole, targetRole: "owner" });
      const response = await handler(
        moderationRequest(action, { channelId: CHANNEL_ID, userId: OWNER_ID, muted: true }),
      );
      assert.equal(
        response.status,
        403,
        `a ${callerRole} was allowed to ${action} the owner`,
      );
      assert.deepEqual(await readJson(response), { ok: false, error: "target_is_owner" });
      assert.deepEqual(fetchCalls, [], `${action} by a ${callerRole} reached the SFU`);
    }
  }
});

test("removing or muting yourself is refused rather than made a second door", async () => {
  for (const action of ["force-mute", "remove"]) {
    const callerId = nextCallerId();
    resetModeration({ callerId, callerRole: "owner", targetRole: "owner" });
    const response = await handler(
      moderationRequest(action, { channelId: CHANNEL_ID, userId: callerId, muted: false }),
    );
    assert.equal(response.status, 403, `${action} on self was allowed`);
    assert.deepEqual(await readJson(response), { ok: false, error: "self_not_allowed" });
    assert.deepEqual(fetchCalls, [], `${action} on self reached the SFU`);
  }
});

test("lifting a mute restores the policy answer, never an unconditional yes", async () => {
  // A listen-only channel: `speak_role` is admin and the target is a member, so
  // an unmute must leave them unable to publish. Without this the route would
  // be a way around `speak_role` for anybody an administrator chose.
  resetModeration({ speakRole: "admin", targetRole: "member" });
  const quiet = await handler(
    moderationRequest("force-mute", { channelId: CHANNEL_ID, userId: TARGET_ID, muted: false }),
  );
  assert.equal(quiet.status, 200);
  assert.equal((await readJson(quiet)).canPublish, false);
  assert.equal(
    JSON.parse(twirpCall("UpdateParticipant")[1].body).permission.canPublish,
    false,
  );

  // And a staff mute from `public.mutes` wins over a chat administrator's
  // unmute, which is the same precedence the token route applies at mint.
  resetModeration({ staffMuted: true });
  const staffMuted = await handler(
    moderationRequest("force-mute", { channelId: CHANNEL_ID, userId: TARGET_ID, muted: false }),
  );
  assert.equal((await readJson(staffMuted)).canPublish, false);
  assert.equal(
    JSON.parse(twirpCall("UpdateParticipant")[1].body).permission.canPublish,
    false,
  );

  // With nothing in the way, it really does come back.
  resetModeration();
  const restored = await handler(
    moderationRequest("force-mute", { channelId: CHANNEL_ID, userId: TARGET_ID, muted: false }),
  );
  assert.equal((await readJson(restored)).canPublish, true);
  assert.equal(
    JSON.parse(twirpCall("UpdateParticipant")[1].body).permission.canPublish,
    true,
  );
});

test("the chat is read off the channel row, and both membership reads use it", async () => {
  const callerId = resetModeration();
  await handler(
    moderationRequest("force-mute", {
      channelId: CHANNEL_ID,
      userId: TARGET_ID,
      muted: true,
    }),
  );
  const memberships = supabaseCalls().filter((call) => call.name === "chat_members");
  assert.equal(memberships.length, 2);
  assert.deepEqual(memberships[0].filters, { chat_id: CHAT_ID, user_id: callerId });
  assert.deepEqual(memberships[1].filters, { chat_id: CHAT_ID, user_id: TARGET_ID });
  const channel = supabaseCalls().find((call) => call.name === "voice_channels");
  assert.deepEqual(channel.filters, { id: CHANNEL_ID });
  assert.equal(channel.columns.includes("*"), false);
});

test("a muted target is not asked about again; an unmuted one is", async () => {
  resetModeration();
  await handler(
    moderationRequest("force-mute", { channelId: CHANNEL_ID, userId: TARGET_ID, muted: true }),
  );
  // The whole sequence, in order, which also pins where slice 5's
  // deployment-wide limiter sits: ahead of `is_banned`, so a loop cannot walk
  // the authorisation path at all.
  assert.deepEqual(
    supabaseCalls().filter((call) => call.kind === "rpc").map((call) => call.name),
    ["voice_rate_limit_consume", "is_banned"],
  );

  resetModeration();
  await handler(
    moderationRequest("force-mute", { channelId: CHANNEL_ID, userId: TARGET_ID, muted: false }),
  );
  const rpcs = supabaseCalls()
    .filter((call) => call.kind === "rpc" && call.name !== "voice_rate_limit_consume");
  assert.deepEqual(rpcs.map((call) => call.name), ["is_banned", "is_muted"]);
  // The person being unmuted, not the moderator doing it.
  assert.deepEqual(rpcs[1].args, { uid: TARGET_ID, cid: CHAT_ID });
});

test("somebody no longer in the chat can be removed from the room but not muted", async () => {
  resetModeration({ targetRole: null });
  const removed = await handler(
    moderationRequest("remove", { channelId: CHANNEL_ID, userId: TARGET_ID }),
  );
  assert.equal(removed.status, 200);
  assert.ok(twirpCall("RemoveParticipant"));

  resetModeration({ targetRole: null });
  const muted = await handler(
    moderationRequest("force-mute", { channelId: CHANNEL_ID, userId: TARGET_ID, muted: true }),
  );
  assert.equal(muted.status, 403);
  assert.deepEqual(await readJson(muted), { ok: false, error: "target_not_a_member" });
  assert.deepEqual(fetchCalls, []);
});

test("a twirp failure is reported as a failure and not swallowed", async () => {
  // A refusal from the SFU.
  resetModeration();
  fetchReply = async () => new Response('{"code":"internal","msg":"boom"}', { status: 500 });
  const refused = await handler(
    moderationRequest("force-mute", { channelId: CHANNEL_ID, userId: TARGET_ID, muted: true }),
  );
  const refusedRaw = await refused.text();
  assert.equal(refused.status, 503);
  assert.deepEqual(JSON.parse(refusedRaw), { ok: false, error: "voice_unavailable" });
  assert.equal(refusedRaw.includes("boom"), false, "LiveKit's message was echoed");

  // Nothing answered at all.
  resetModeration();
  fetchReply = async () => {
    throw new TypeError("connection refused");
  };
  const silent = await handler(
    moderationRequest("remove", { channelId: CHANNEL_ID, userId: TARGET_ID }),
  );
  assert.equal(silent.status, 503);
  assert.deepEqual(await readJson(silent), { ok: false, error: "voice_unavailable" });

  // «That person is not in the room» -- a real answer, and its own status.
  resetModeration();
  fetchReply = async () =>
    new Response('{"code":"not_found","msg":"participant not found"}', { status: 404 });
  const gone = await handler(
    moderationRequest("remove", { channelId: CHANNEL_ID, userId: TARGET_ID }),
  );
  assert.equal(gone.status, 404);
  assert.deepEqual(await readJson(gone), { ok: false, error: "participant_not_in_room" });

  // A 404 that is a missing *method* is an outage, not an empty room. This is
  // the shape `MuteRoomTrack` answers on this build, and reading it as «they
  // already left» would hide a LiveKit upgrade that renamed a method.
  resetModeration();
  fetchReply = async () => new Response('{"code":"bad_route","msg":"no handler"}', { status: 404 });
  const missing = await handler(
    moderationRequest("force-mute", { channelId: CHANNEL_ID, userId: TARGET_ID, muted: true }),
  );
  assert.equal(missing.status, 503);
  assert.deepEqual(await readJson(missing), { ok: false, error: "voice_unavailable" });
});

test("a banned moderator is refused before the channel is read", async () => {
  resetModeration({ banned: true });
  const response = await handler(
    moderationRequest("remove", { channelId: CHANNEL_ID, userId: TARGET_ID }),
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await readJson(response), { ok: false, error: "banned" });
  assert.equal(
    supabaseCallNames().some((name) => name.startsWith("table:")),
    false,
  );
  assert.deepEqual(fetchCalls, []);
});

test("a missing or archived channel is 404 and touches no membership", async () => {
  resetModeration({ channelRow: null });
  const missing = await handler(
    moderationRequest("remove", { channelId: CHANNEL_ID, userId: TARGET_ID }),
  );
  assert.equal(missing.status, 404);
  assert.deepEqual(await readJson(missing), { ok: false, error: "channel_not_found" });

  resetModeration({ archived: true });
  const archived = await handler(
    moderationRequest("force-mute", { channelId: CHANNEL_ID, userId: TARGET_ID, muted: true }),
  );
  assert.equal(archived.status, 404);
  assert.equal(
    supabaseCalls().some((call) => call.name === "chat_members"),
    false,
  );
  assert.deepEqual(fetchCalls, []);
});

test("a database error on a moderation call is 503 and never leaks its message", async () => {
  resetModeration({ rpcError: "is_banned" });
  const response = await handler(
    moderationRequest("remove", { channelId: CHANNEL_ID, userId: TARGET_ID }),
  );
  const raw = await response.text();
  assert.equal(response.status, 503);
  assert.deepEqual(JSON.parse(raw), { ok: false, error: "unavailable" });
  assert.equal(raw.includes("permission denied"), false);
});

test("a body that is not two uuids and a boolean is refused before anything is read", async () => {
  for (
    const body of [
      { channelId: CHANNEL_ID, userId: TARGET_ID },
      { channelId: CHANNEL_ID, userId: TARGET_ID, muted: "true" },
      { channelId: CHANNEL_ID, muted: true },
      { userId: TARGET_ID, muted: true },
      { channelId: "scratch", userId: TARGET_ID, muted: true },
      { channelId: CHANNEL_ID, userId: `${TARGET_ID} or 1=1`, muted: true },
      "{not json",
    ]
  ) {
    resetModeration();
    const response = await handler(moderationRequest("force-mute", body));
    assert.equal(response.status, 400, `accepted ${JSON.stringify(body)}`);
    assert.deepEqual(await readJson(response), { ok: false, error: "invalid_request" });
    assert.deepEqual(supabaseCalls(), [], `${JSON.stringify(body)} reached the database`);
  }
});

test("an unauthenticated or unconfigured moderation call mints nothing", async () => {
  resetModeration();
  const anonymous = await handler(
    moderationRequest(
      "remove",
      { channelId: CHANNEL_ID, userId: TARGET_ID },
      { headers: { authorization: "" } },
    ),
  );
  assert.equal(anonymous.status, 401);
  assert.deepEqual(await readJson(anonymous), { ok: false, error: "unauthorized" });
  assert.deepEqual(fetchCalls, []);

  reset(moderationPlan({ callerId: nextCallerId() }), { LIVEKIT_API_SECRET: undefined });
  const unconfigured = await handler(
    moderationRequest("remove", { channelId: CHANNEL_ID, userId: TARGET_ID }),
  );
  assert.equal(unconfigured.status, 503);
  assert.deepEqual(await readJson(unconfigured), { ok: false, error: "not_configured" });

  reset({
    ...moderationPlan({ callerId: nextCallerId() }),
    getUser: () => ({ data: { user: null }, error: new Error("bad jwt") }),
  });
  const rejected = await handler(
    moderationRequest("remove", { channelId: CHANNEL_ID, userId: TARGET_ID }),
  );
  assert.equal(rejected.status, 401);
  assert.deepEqual(fetchCalls, []);
});

test("both routes refuse anything but POST, and the near misses are 404", async () => {
  for (const action of ["force-mute", "remove"]) {
    resetModeration();
    const wrongMethod = await handler(
      new Request(`${FUNCTION_ORIGIN}/functions/v1/voice-gateway/${action}`, { method: "GET" }),
    );
    assert.equal(wrongMethod.status, 405, `${action} served a GET`);
  }
  for (
    const path of ["/force-mutes", "/mute", "/removes", "/force-mute/extra", "/kick"]
  ) {
    resetModeration();
    const response = await handler(
      new Request(`${FUNCTION_ORIGIN}/functions/v1/voice-gateway${path}`, {
        method: "POST",
        headers: { authorization: "Bearer caller-supabase-jwt" },
        body: JSON.stringify({ channelId: CHANNEL_ID, userId: TARGET_ID, muted: true }),
      }),
    );
    assert.equal(response.status, 404, `route ${path} was served`);
  }
});

test("one caller cannot hold the button down: the limit answers 429", async () => {
  // The limiter is per isolate and keyed on the verified caller, so this test
  // needs a caller of its own and twenty-one attempts.
  const callerId = "dddddddd-3333-4333-8333-333333333333";
  let refused = null;
  for (let attempt = 0; attempt < 21; attempt += 1) {
    resetModeration({ callerId });
    const response = await handler(
      moderationRequest("remove", { channelId: CHANNEL_ID, userId: TARGET_ID }),
    );
    if (response.status === 429) {
      refused = response;
      break;
    }
    assert.equal(response.status, 200, `attempt ${attempt} was ${response.status}`);
  }
  assert.ok(refused, "twenty-one actions in one minute were all allowed");
  assert.deepEqual(await readJson(refused), { ok: false, error: "rate_limited" });
  assert.match(String(refused.headers.get("retry-after")), /^[0-9]+$/);
  // A refusal costs the SFU nothing and the database nothing past the identity.
  assert.deepEqual(fetchCalls, []);
  assert.equal(
    supabaseCallNames().some((name) => name.startsWith("rpc:")),
    false,
    "a rate-limited call still asked the database",
  );
});

// ── slice 5's kill switch, concurrency cap and deployment-wide limit ─────────
//
// Driven through the same handler as everything above, with the environment set
// both ways, because the thing being asserted is that the *route's answer
// changes*. A test that read `VOICE_ENABLED` out of the source, or called
// `readVoiceAdmission` and stopped there, would pass over a switch that was
// never wired into a route — which is the only way this could actually be
// broken.
//
// **Every test below uses a caller of its own**, the way the moderation block
// does and for the same reason: the token route now has a per-isolate limiter
// keyed on the verified caller, that limiter is one object for the life of this
// process, and a block of twenty-odd mints sharing `USER_ID` with the tests
// above would start answering 429 partway down. Anything added here should take
// a caller from `nextTokenCallerId` too.

let tokenCallerSeed = 0;
function nextTokenCallerId() {
  tokenCallerSeed += 1;
  return `eeeeeeee-0000-4000-8000-${String(tokenCallerSeed).padStart(12, "0")}`;
}

/**
 * `reset`, with a fresh caller and an `rpc` override that *composes* with the
 * default plan rather than replacing it. Replacing it is what the plain form
 * does, and a test that overrode one RPC would silently unplan `is_banned`.
 */
function resetToken(plan = {}, overrides = {}) {
  const callerId = plan.callerId ?? nextTokenCallerId();
  const base = defaultPlan();
  const override = plan.rpc;
  reset(
    {
      ...plan,
      getUser: () => ({ data: { user: { id: callerId } }, error: null }),
      rpc: override
        ? (name, args) => override(name, args) ?? base.rpc(name, args)
        : base.rpc,
    },
    overrides,
  );
  return callerId;
}

const rateLimitCalls = () =>
  supabaseCalls().filter((call) => call.kind === "rpc" && call.name === "voice_rate_limit_consume");
const capacityCalls = () =>
  supabaseCalls().filter((call) => call.kind === "rpc" && call.name === "voice_active_participants");

test("VOICE_ENABLED=false turns minting off for everyone, and says so", async () => {
  resetToken({}, { VOICE_ENABLED: "false" });
  const off = await handler(tokenRequest());

  assert.equal(off.status, 503);
  assert.deepEqual(await readJson(off), { ok: false, error: "voice_disabled" });
  // Nothing at all happened behind it: no SFU call, no database call, not even
  // the caller's identity. A switch that still verified a JWT and created a
  // room would not be a kill switch.
  assert.deepEqual(fetchCalls, []);
  assert.deepEqual(supabaseCalls(), []);

  // The same request against the same fixture, the only difference being the
  // value of the variable.
  resetToken({}, { VOICE_ENABLED: "true" });
  const on = await handler(tokenRequest());
  assert.equal(on.status, 200);
  assert.ok((await readJson(on)).token, "the switch stayed off when it was set to true");
});

test("absent and empty leave voice on, and an unrecognised value is never «on»", async () => {
  for (const value of [undefined, ""]) {
    resetToken({}, { VOICE_ENABLED: value });
    assert.equal(
      (await handler(tokenRequest())).status,
      200,
      `VOICE_ENABLED=${JSON.stringify(value)}`,
    );
  }
  // `BOT_CREATION_ENABLED`'s rule: a typo must not quietly open or close the
  // feature. The bot gateway can refuse to boot; an Edge Function reading its
  // environment per request cannot, so it refuses the request with the code it
  // already uses for an unusable environment.
  for (const value of ["FALSE", "False", "0", "no", " false", "true ", "1"]) {
    resetToken({}, { VOICE_ENABLED: value });
    const response = await handler(tokenRequest());
    assert.equal(response.status, 503, `VOICE_ENABLED=${JSON.stringify(value)} was tolerated`);
    assert.deepEqual(await readJson(response), { ok: false, error: "not_configured" });
    assert.deepEqual(fetchCalls, [], `VOICE_ENABLED=${JSON.stringify(value)} still reached the SFU`);
  }
});

test("the switch does not strand the webhook, which would make the mirror lie", async () => {
  // Refusing webhooks while voice is off would drop `participant_left` and
  // `room_finished`, and every chat list in the product would keep showing a
  // call that had ended. Off must mean «no new calls», not «stop listening».
  reset({}, { VOICE_ENABLED: "false" });
  const response = await handler(webhookRequest(participantEvent()));

  assert.equal(response.status, 200);
  assert.deepEqual(await readJson(response), { ok: true, status: "applied" });
});

test("the switch does not take a moderator's levers away mid-drain", async () => {
  // A call already in progress is not ended by the switch — see the note in
  // `admission.mjs` — so somebody being disruptive in one can still be
  // silenced while it drains.
  reset(moderationPlan({ callerId: nextCallerId() }), { VOICE_ENABLED: "false" });
  const response = await handler(
    moderationRequest("force-mute", { channelId: CHANNEL_ID, userId: TARGET_ID, muted: true }),
  );

  assert.equal(response.status, 200);
  assert.ok(twirpCall("UpdateParticipant"), "the SFU was never told");
});

test("the concurrency cap refuses a mint and names a reason that is true", async () => {
  resetToken(
    { rpc: (name) => (name === "voice_active_participants" ? { data: 40, error: null } : undefined) },
    { VOICE_MAX_TOTAL_PARTICIPANTS: "40" },
  );
  const full = await handler(tokenRequest());

  assert.equal(full.status, 503);
  // Not `channel_full`: the fixture channel has two people in it and room for
  // ten. The client maps this onto its own sentence for exactly that reason.
  assert.deepEqual(await readJson(full), { ok: false, error: "voice_at_capacity" });
  assert.equal(createRoomCall(), null, "a room was created for a mint that was refused");
  // And the caller's allowance was not spent, so the truthful answer survives
  // being asked again rather than turning into «слишком много попыток».
  assert.deepEqual(rateLimitCalls(), []);

  // One below the cap is a join. Same fixture, one number different.
  resetToken(
    { rpc: (name) => (name === "voice_active_participants" ? { data: 39, error: null } : undefined) },
    { VOICE_MAX_TOTAL_PARTICIPANTS: "40" },
  );
  assert.equal((await handler(tokenRequest())).status, 200);
});

test("no cap configured asks nothing, and a misconfigured cap refuses", async () => {
  resetToken();
  assert.equal((await handler(tokenRequest())).status, 200);
  assert.deepEqual(capacityCalls(), [], "capacity was asked about with no cap set");

  for (const value of ["0", "-1", "forty", "1.5", " 20", "20 ", "1e3", "0x10", "+5"]) {
    resetToken({}, { VOICE_MAX_TOTAL_PARTICIPANTS: value });
    const response = await handler(tokenRequest());
    assert.equal(response.status, 503, `VOICE_MAX_TOTAL_PARTICIPANTS=${value} was tolerated`);
    assert.deepEqual(await readJson(response), { ok: false, error: "not_configured" });
  }
});

test("the cap is asked with the in-flight window, and not knowing does not stop calls", async () => {
  resetToken({}, { VOICE_MAX_TOTAL_PARTICIPANTS: "40" });
  await handler(tokenRequest());
  assert.deepEqual(capacityCalls().map((call) => call.args), [{ p_in_flight_seconds: 30 }]);

  // Fail open, deliberately: the cap is a capacity control, and every check
  // that decides whether somebody may be in a call at all still fails closed
  // a few lines further down the same function.
  for (
    const answer of [
      { data: null, error: { message: "function does not exist" } },
      { data: null, error: null },
      { data: "many", error: null },
      { data: true, error: null },
      { data: -1, error: null },
    ]
  ) {
    resetToken(
      { rpc: (name) => (name === "voice_active_participants" ? answer : undefined) },
      { VOICE_MAX_TOTAL_PARTICIPANTS: "1" },
    );
    const response = await handler(tokenRequest());
    assert.equal(
      response.status,
      200,
      `an unusable capacity answer (${JSON.stringify(answer)}) refused a join`,
    );
  }
});

test("the deployment-wide limit refuses with the retry-after the database chose", async () => {
  resetToken({
    rpc: (name) =>
      name === "voice_rate_limit_consume"
        ? { data: { ok: false, retry_after_seconds: 37 }, error: null }
        : undefined,
  });
  const response = await handler(tokenRequest());

  assert.equal(response.status, 429);
  assert.deepEqual(await readJson(response), { ok: false, error: "rate_limited" });
  assert.equal(response.headers.get("retry-after"), "37");
  // Refused before anything is authorised and before the SFU is touched.
  assert.equal(createRoomCall(), null);
  assert.deepEqual(
    supabaseCalls().filter((call) => call.kind === "rpc").map((call) => call.name),
    ["voice_rate_limit_consume"],
  );
});

test("the two routes spend separate allowances, with the limits the gateway holds", async () => {
  const minter = resetToken();
  await handler(tokenRequest());
  assert.deepEqual(rateLimitCalls().map((call) => call.args), [
    { p_user_id: minter, p_action: "token_mint", p_limit: 20, p_window_seconds: 60 },
  ]);

  const moderator = nextCallerId();
  reset(moderationPlan({ callerId: moderator }));
  await handler(moderationRequest("remove", { channelId: CHANNEL_ID, userId: TARGET_ID }));
  assert.deepEqual(rateLimitCalls().map((call) => call.args), [
    { p_user_id: moderator, p_action: "moderate", p_limit: 20, p_window_seconds: 60 },
  ]);
});

test("a moderation action the deployment refuses is a 429, not a silent success", async () => {
  // Written because a mutation stayed green: making `moderateParticipant`
  // ignore the limiter's refusal broke nothing, so the two routes were not
  // equally covered. Everything below the limit must be untouched — the
  // channel, the memberships and the SFU.
  reset(
    moderationPlan({
      callerId: nextCallerId(),
      deploymentLimit: { ok: false, retry_after_seconds: 11 },
    }),
  );
  const response = await handler(
    moderationRequest("force-mute", { channelId: CHANNEL_ID, userId: TARGET_ID, muted: true }),
  );

  assert.equal(response.status, 429);
  assert.deepEqual(await readJson(response), { ok: false, error: "rate_limited" });
  assert.equal(response.headers.get("retry-after"), "11");
  assert.deepEqual(fetchCalls, [], "the SFU was asked to mute somebody anyway");
  assert.deepEqual(
    supabaseCallNames().filter((name) => name.startsWith("table:")),
    [],
    "a refused action still read the channel or a membership",
  );
  assert.deepEqual(
    supabaseCalls().filter((call) => call.kind === "rpc").map((call) => call.name),
    ["voice_rate_limit_consume"],
  );
});

test("a limiter that cannot be asked allows, and the isolate layer is still in front", async () => {
  for (
    const answer of [
      { data: null, error: { message: "function public.voice_rate_limit_consume does not exist" } },
      { data: null, error: null },
      { data: { ok: "false" }, error: null },
      { data: "no", error: null },
    ]
  ) {
    resetToken({ rpc: (name) => (name === "voice_rate_limit_consume" ? answer : undefined) });
    assert.equal(
      (await handler(tokenRequest())).status,
      200,
      `an unusable limiter answer (${JSON.stringify(answer)}) refused a join`,
    );
  }

  // The floor under that. With the database saying nothing useful, the
  // per-isolate limiter still stops a loop — which is what makes failing open
  // a degradation rather than an absence.
  const callerId = nextTokenCallerId();
  let refused = null;
  for (let attempt = 0; attempt < 30 && refused === null; attempt += 1) {
    resetToken({
      callerId,
      rpc: (name) => (name === "voice_rate_limit_consume" ? { data: null, error: null } : undefined),
    });
    const response = await handler(tokenRequest());
    if (response.status === 429) refused = response;
    else assert.equal(response.status, 200, `attempt ${attempt} was ${response.status}`);
  }
  assert.ok(refused, "thirty mints with a dead limiter were all allowed");
  assert.deepEqual(await readJson(refused), { ok: false, error: "rate_limited" });
  assert.match(String(refused.headers.get("retry-after")), /^[0-9]+$/);
  // The database was never asked on the refused attempt: the map lookup is in
  // front of the round trip, so a held-down button costs nothing.
  assert.deepEqual(rateLimitCalls(), []);
});
