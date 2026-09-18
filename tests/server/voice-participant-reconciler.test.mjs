// The participant list stays true when a client disappears without leaving
// (section 3.6 of docs/proposals/2026-09-13-voice-channels.md).
//
// Everything here drives the real tick body against a stubbed LiveKit and a
// stubbed PostgREST, because the contract is not in any one helper: it is in
// what the tick writes, and — much more importantly — what it refuses to write.
//
// The rule the suite exists to pin: an error from LiveKit means "I do not
// know", never "the room is empty". A reconciler that answered a 500 with an
// empty set would hang up every live call in the product the first time the SFU
// hiccuped, and it would do it silently, looking exactly like success.
//
// The stub throws on any path it was not given, so a reconciler that starts
// calling something else fails here rather than passing on a fixture that
// answers everything.

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test, { afterEach } from "node:test";

import { createClient } from "@supabase/supabase-js";

process.env["NODE_ENV"] = "production";
process.env["LOG_LEVEL"] = process.env.KUB_TEST_LOG ?? "silent";

// The signalling URL carries a WebSocket scheme; the twirp API is HTTP on the
// same origin. Keeping the ws:// form here is what proves the translation.
process.env["LIVEKIT_URL"] = "ws://voice.internal:7880";
process.env["LIVEKIT_API_KEY"] = "APIstubkey";
process.env["LIVEKIT_API_SECRET"] = "a-stub-secret-that-is-not-a-real-one";

const reconciler = await import("../../artifacts/api-server/dist/workers/voiceReconciler.mjs");

const SUPABASE_URL = "https://postgrest.invalid";
const CHANNEL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHANNEL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_1 = "11111111-1111-4111-8111-111111111111";
const USER_2 = "22222222-2222-4222-8222-222222222222";
const USER_3 = "33333333-3333-4333-8333-333333333333";

const NOW = new Date("2026-09-13T12:00:00.000Z");
const FIVE_MINUTES_AGO = "2026-09-13T11:55:00.000Z";
const ONE_DAY_AGO = "2026-09-12T12:00:00.000Z";
const TEN_MINUTES_AGO = "2026-09-13T11:50:00.000Z";

const room = (channelId) => `vc_${channelId}`;
const participant = (identity, state = "ACTIVE") => ({ sid: `PA_${identity}`, identity, state });

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * LiveKit's twirp API and PostgREST, as far as this worker uses them.
 *
 * `livekit` maps a room name to one of:
 *   { participants: [...] }  a 200 with that body
 *   { status: 500 }          a refusal
 *   "throw"                  a connection that never opened
 * A room with no entry throws, so a reconciler asking about a channel it was
 * not given fails loudly.
 *
 * `rooms` is what `ListRooms` answers: a list of room names, a `{ status }`
 * refusal, or "throw". It defaults to the empty list, so every test that does
 * not care about SFU-side discovery measures the table-driven sweep alone.
 */
function createBackend({ channels = [CHANNEL_A], livekit = {}, rooms = [], missing = [] } = {}) {
  const requests = [];
  const livekitCalls = [];
  const replaced = [];
  const reaped = [];
  const purged = [];
  const pruned = [];

  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const absent = (fn) =>
    json({ code: "42883", message: `function public.${fn} does not exist` }, 404);

  const fetchStub = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    requests.push({ method, origin: url.origin, path: url.pathname, params: url.searchParams });
    // Parsed where it is needed, never up front: the LiveKit call and the RPCs
    // carry JSON, the channel read carries nothing at all, and parsing eagerly
    // turns a missing body into a stub bug that reads like a worker bug.
    const body = () => JSON.parse(init.body);

    // Found anywhere in the path, not only at its start: an SFU published
    // behind a path prefix answers at `<prefix>/twirp/...`, and a stub that
    // only matched the bare path would make that arrangement look like a
    // worker that never called LiveKit at all.
    const twirp = url.pathname.indexOf("/twirp/livekit.RoomService/");
    if (twirp >= 0) {
      const rpc = url.pathname.slice(twirp + "/twirp/livekit.RoomService/".length);
      const headers = init.headers ?? {};
      const wanted = body().room;
      livekitCalls.push({
        rpc,
        room: wanted,
        // The base the worker appended `/twirp/...` to, prefix included.
        origin: url.origin + url.pathname.slice(0, twirp),
        authorization: headers.authorization ?? headers.Authorization,
      });

      if (rpc === "ListRooms") {
        if (rooms === "throw") throw new TypeError("fetch failed");
        if (rooms.status >= 400) return json({ code: 13, msg: "internal" }, rooms.status);
        // `{}` for no rooms is the defensive case, not the observed one:
        // LiveKit 1.8.4 was measured answering `{"participants":[]}` for an
        // empty room rather than omitting the field. A proto3 JSON encoder is
        // permitted to omit an empty repeated field, so the worker accepts
        // both, and this stub exercises the shape that is easier to get wrong.
        return json(
          rooms.length === 0 ? {} : { rooms: rooms.map((name) => ({ sid: `RM_${name}`, name })) },
        );
      }
      if (rpc !== "ListParticipants") throw new Error(`unstubbed twirp ${rpc}`);

      const answer = livekit[wanted];
      if (answer === undefined) throw new Error(`unstubbed room ${wanted}`);
      if (answer === "throw") throw new TypeError("fetch failed");
      if (answer.status && answer.status >= 400) return json({ code: 13, msg: "internal" }, answer.status);
      return json(answer);
    }

    if (url.pathname === "/rest/v1/voice_channels") {
      if (missing.includes("voice_channels")) {
        return json({ code: "42P01", message: "relation does not exist" }, 404);
      }
      return json(channels.map((id) => ({ id })));
    }

    if (url.pathname === "/rest/v1/rpc/voice_participants_replace") {
      if (missing.includes("voice_participants_replace")) return absent("voice_participants_replace");
      const call = body();
      replaced.push({
        channelId: call.p_channel_id,
        userIds: [...call.p_user_ids].sort(),
        observedAt: call.p_observed_at,
      });
      // `voice_participants_replace` returns void, so PostgREST answers 204
      // with no body. Stubbing a value here would let a reconciler that started
      // depending on a return value pass in a test and fail in production.
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/rest/v1/rpc/voice_participants_reap") {
      if (missing.includes("voice_participants_reap")) return absent("voice_participants_reap");
      reaped.push(body().p_older_than);
      return json(0);
    }
    if (url.pathname === "/rest/v1/rpc/voice_webhook_events_purge") {
      if (missing.includes("voice_webhook_events_purge")) return absent("voice_webhook_events_purge");
      purged.push(body().p_older_than);
      return json(0);
    }
    if (url.pathname === "/rest/v1/rpc/voice_rate_limit_prune") {
      if (missing.includes("voice_rate_limit_prune")) return absent("voice_rate_limit_prune");
      pruned.push(body().p_older_than);
      return json(0);
    }

    throw new Error(`unstubbed ${method} ${url.pathname}`);
  };

  globalThis.fetch = fetchStub;

  return {
    supabase: createClient(SUPABASE_URL, "anon-key-for-a-stubbed-fetch", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchStub },
    }),
    requests,
    livekitCalls,
    replaced,
    reaped,
    purged,
    pruned,
    channelRead: () => requests.find((r) => r.path === "/rest/v1/voice_channels"),
    participantCalls: () => livekitCalls.filter((c) => c.rpc === "ListParticipants"),
    roomListCalls: () => livekitCalls.filter((c) => c.rpc === "ListRooms"),
  };
}

const tick = (backend) => reconciler.runVoiceReconcilerTick(backend.supabase, { now: () => NOW });

test("a live room's participants are written as the full set", async () => {
  const backend = createBackend({
    livekit: {
      [room(CHANNEL_A)]: {
        participants: [participant(USER_1), participant(USER_2), participant(USER_3)],
      },
    },
  });

  await tick(backend);

  assert.deepEqual(backend.replaced, [
    {
      channelId: CHANNEL_A,
      userIds: [USER_1, USER_2, USER_3].sort(),
      observedAt: NOW.toISOString(),
    },
  ]);
  // The whole membership in one statement, never a diff: one call, three ids.
  assert.equal(backend.replaced.length, 1);
  assert.equal(backend.participantCalls().length, 1);
  assert.equal(backend.participantCalls()[0].room, room(CHANNEL_A));
  // ws:// in, http:// out, same origin. A reconciler that posted twirp to a
  // WebSocket scheme would fail at the socket, not here.
  assert.equal(backend.participantCalls()[0].origin, "http://voice.internal:7880");
});

test("an error from LiveKit writes nothing at all", async () => {
  // The single most important assertion in this file. A 500 is not an empty
  // room; it is the absence of knowledge, and the only correct response to the
  // absence of knowledge is to leave the table exactly as it was.
  const backend = createBackend({ livekit: { [room(CHANNEL_A)]: { status: 500 } } });

  await tick(backend);

  assert.deepEqual(backend.replaced, [], "a failed lookup wrote no participant set");
  assert.deepEqual(
    backend.reaped,
    [],
    "and it did not reap either: rows unconfirmed because we could not ask are not stale rows",
  );
  assert.deepEqual(
    backend.purged,
    [ONE_DAY_AGO],
    "the webhook log does not depend on the SFU, so it is still trimmed",
  );
});

test("a connection that never opened is the same as an error", async () => {
  const backend = createBackend({ livekit: { [room(CHANNEL_A)]: "throw" } });

  await tick(backend);

  assert.deepEqual(backend.replaced, []);
  assert.deepEqual(backend.reaped, []);
});

test("a room that has really emptied is written as an empty set", async () => {
  // proto3 JSON omits empty repeated fields, so `{}` — not `{"participants":[]}`
  // — is how LiveKit says "nobody is in this room". Reading that as unknown
  // would mean an emptied room was never cleared and its badge never went out.
  const backend = createBackend({ livekit: { [room(CHANNEL_A)]: {} } });

  await tick(backend);

  assert.deepEqual(backend.replaced, [
    { channelId: CHANNEL_A, userIds: [], observedAt: NOW.toISOString() },
  ]);
});

test("the reaper is called with the five-minute threshold", async () => {
  const backend = createBackend({
    livekit: { [room(CHANNEL_A)]: { participants: [participant(USER_1)] } },
  });

  await tick(backend);

  assert.deepEqual(backend.reaped, [FIVE_MINUTES_AGO]);
});

test("one room answering is enough to reap; the skip is for total blindness only", async () => {
  // The narrowness matters. If a single unreachable room suppressed the reaper,
  // one permanently broken channel would protect every ghost in the product.
  const backend = createBackend({
    channels: [CHANNEL_A, CHANNEL_B],
    livekit: {
      [room(CHANNEL_A)]: { participants: [participant(USER_1)] },
      [room(CHANNEL_B)]: { status: 503 },
    },
  });

  await tick(backend);

  assert.deepEqual(backend.replaced.map((r) => r.channelId), [CHANNEL_A]);
  assert.deepEqual(backend.reaped, [FIVE_MINUTES_AGO]);
});

test("webhook idempotency keys older than a day are purged", async () => {
  const backend = createBackend({
    livekit: { [room(CHANNEL_A)]: { participants: [participant(USER_1)] } },
  });

  await tick(backend);

  assert.deepEqual(backend.purged, [ONE_DAY_AGO]);
});

test("rate limit signals older than ten minutes are pruned in the same tick", async () => {
  // The sweep the migration's own comment names. It is in the tick beside the
  // webhook purge rather than on a timer of its own, because both are
  // retention on a private table and neither depends on the SFU.
  const backend = createBackend({
    livekit: { [room(CHANNEL_A)]: { participants: [participant(USER_1)] } },
  });

  await tick(backend);

  assert.deepEqual(backend.pruned, [TEN_MINUTES_AGO]);
});

test("the prune runs when the SFU cannot be reached at all", async () => {
  // The blindness rule bounds *writes derived from LiveKit*. A rate limit
  // signal is derived from nothing LiveKit knows, so a tick that learned
  // nothing about any room must still trim it -- otherwise an SFU outage would
  // quietly stop the only thing that bounds that table.
  const backend = createBackend({ livekit: { [room(CHANNEL_A)]: { status: 503 } } });

  await tick(backend);

  assert.deepEqual(backend.replaced, []);
  assert.deepEqual(backend.reaped, []);
  assert.deepEqual(backend.pruned, [TEN_MINUTES_AGO]);
});

test("a database without the prune function is a warning, not a failed tick", async () => {
  // The migration and the worker deploy separately, in either order. A worker
  // that threw here would stop reconciling participants -- a real defect --
  // over a retention sweep on a table that cannot grow large anyway.
  const backend = createBackend({
    livekit: { [room(CHANNEL_A)]: { participants: [participant(USER_1)] } },
    missing: ["voice_rate_limit_prune"],
  });

  await tick(backend);

  assert.deepEqual(backend.pruned, [], "the stub answered 404, so nothing was recorded");
  assert.deepEqual(
    backend.replaced,
    [{ channelId: CHANNEL_A, userIds: [USER_1], observedAt: NOW.toISOString() }],
    "the participant set was still written",
  );
  assert.deepEqual(backend.purged, [ONE_DAY_AGO], "and the webhook log was still trimmed");
});

test("an identity that is not a user id never reaches a uuid[] parameter", async () => {
  // Identity is the Supabase user id. A load-test bot, an egress recorder or a
  // future ingress is not a person, and one bad element would fail the whole
  // set — turning a room with real people in it into a write that never lands.
  const backend = createBackend({
    livekit: {
      [room(CHANNEL_A)]: {
        participants: [
          participant("sub_0"),
          participant(USER_1),
          participant("EG_recorder"),
          participant(""),
        ],
      },
    },
  });

  await tick(backend);

  assert.deepEqual(backend.replaced, [
    { channelId: CHANNEL_A, userIds: [USER_1], observedAt: NOW.toISOString() },
  ]);
});

test("a participant LiveKit has already disconnected is not in the set", async () => {
  const backend = createBackend({
    livekit: {
      [room(CHANNEL_A)]: {
        participants: [participant(USER_1), participant(USER_2, "DISCONNECTED")],
      },
    },
  });

  await tick(backend);

  assert.deepEqual(backend.replaced[0].userIds, [USER_1]);
});

test("the admin token names the room it administers, and is really signed", async () => {
  // LiveKit compares the token's own `room` claim against the room being
  // administered, so an admin token that names no room can list nothing. This
  // is proved by decoding the header the worker sent, not by reading the code.
  const backend = createBackend({
    livekit: { [room(CHANNEL_A)]: { participants: [] } },
  });

  await tick(backend);

  const authorization = backend.participantCalls()[0].authorization;
  assert.match(authorization, /^Bearer /);
  const token = authorization.slice("Bearer ".length);
  const [header, payload, signature] = token.split(".");
  assert.equal(JSON.parse(Buffer.from(header, "base64url").toString("utf8")).alg, "HS256");

  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  assert.equal(claims.video.room, room(CHANNEL_A), "the token is scoped to this room");
  assert.equal(claims.video.roomAdmin, true);
  assert.equal(claims.iss, process.env["LIVEKIT_API_KEY"]);
  assert.ok(claims.exp > claims.nbf, "it expires");
  assert.ok(claims.exp - claims.nbf <= 600, "and soon: an admin token is used within one tick");

  const expected = createHmac("sha256", process.env["LIVEKIT_API_SECRET"])
    .update(`${header}.${payload}`)
    .digest("base64url");
  assert.equal(signature, expected, "the signature verifies against the secret");
  assert.ok(!token.includes(process.env["LIVEKIT_API_SECRET"]), "the secret is not in the token");
});

test("LIVEKIT_API_URL is where the worker calls, path and all", async () => {
  // In production the SFU is published as a path on a shared hostname, so that
  // it needs no DNS record and no certificate of its own -- and its twirp API
  // is not published at all. This worker runs inside the same docker host, so
  // it is given the container address instead, and a deployment where the SFU
  // owns a hostname sets neither and keeps using `LIVEKIT_URL`.
  //
  // A path must survive: `new URL(...).origin` drops it, and the call would
  // then go to whatever else answers for that hostname.
  const previous = process.env["LIVEKIT_API_URL"];
  process.env["LIVEKIT_API_URL"] = "http://letscube-voice:7880/voice";
  try {
    const backend = createBackend({
      channels: [CHANNEL_A],
      livekit: { [room(CHANNEL_A)]: { participants: [] } },
    });
    await tick(backend);
    assert.equal(
      backend.participantCalls()[0].origin,
      "http://letscube-voice:7880/voice",
    );
  } finally {
    if (previous === undefined) delete process.env["LIVEKIT_API_URL"];
    else process.env["LIVEKIT_API_URL"] = previous;
  }

  // And with it gone the public URL is what is used again.
  const fallback = createBackend({
    channels: [CHANNEL_A],
    livekit: { [room(CHANNEL_A)]: { participants: [] } },
  });
  await tick(fallback);
  assert.equal(fallback.participantCalls()[0].origin, "http://voice.internal:7880");
});

test("only the channels the table believes are live are asked about", async () => {
  const backend = createBackend({
    livekit: { [room(CHANNEL_A)]: { participants: [participant(USER_1)] } },
  });

  await tick(backend);

  const read = backend.channelRead();
  assert.ok(read, "the live set was read from voice_channels");
  assert.equal(
    read.params.get("or"),
    "(participant_count.gt.0,active_since.not.is.null)",
    "a channel with a row and a channel a room_started marked active, and nothing else",
  );
  assert.ok(Number(read.params.get("limit")) > 0, "the per-tick sweep is bounded");
});

test("a database without the voice objects is quiet, not a crash", async () => {
  // The worker and the migration deploy separately, in either order.
  const beforeTheTable = createBackend({ missing: ["voice_channels"] });
  await tick(beforeTheTable);
  assert.deepEqual(
    beforeTheTable.participantCalls(),
    [],
    "with no channels and no rooms, no room is asked about",
  );

  const beforeTheRpcs = createBackend({
    livekit: { [room(CHANNEL_A)]: { participants: [participant(USER_1)] } },
    missing: [
      "voice_participants_replace",
      "voice_participants_reap",
      "voice_webhook_events_purge",
    ],
  });
  await tick(beforeTheRpcs);
  assert.equal(beforeTheRpcs.participantCalls().length, 1, "the pass still ran end to end");
});

test("a call the webhooks never reported is found by asking the SFU which rooms it has", async () => {
  // Section 3.6 sweeps "every channel the table believes is non-empty", and on
  // its own that makes layer 3 inherit layer 2's failure rather than cover it:
  // lose `room_started` and the first `participant_joined` in one webhook
  // outage — one outage, not two coincidences, since they take the same path to
  // the same endpoint — and the table believes nothing, so nothing asks, and a
  // real call stays invisible outside itself for its whole duration.
  const backend = createBackend({
    channels: [],
    rooms: [room(CHANNEL_A)],
    livekit: { [room(CHANNEL_A)]: { participants: [participant(USER_1), participant(USER_2)] } },
  });

  await tick(backend);

  assert.deepEqual(backend.replaced, [
    { channelId: CHANNEL_A, userIds: [USER_1, USER_2].sort(), observedAt: NOW.toISOString() },
  ]);
});

test("a room on the SFU that is not one of ours is left alone", async () => {
  const backend = createBackend({
    channels: [],
    // A room named for something else, a room of ours with a name that is not a
    // channel id, and a bare uuid belonging to another project on this SFU.
    rooms: ["some-other-projects-room", "vc_not-a-uuid", CHANNEL_B, room(CHANNEL_A)],
    livekit: { [room(CHANNEL_A)]: { participants: [participant(USER_1)] } },
  });

  await tick(backend);

  // The stub throws on a room it was not given, so asking about either of the
  // first two would fail here rather than quietly reaching a uuid parameter.
  assert.deepEqual(backend.participantCalls().map((c) => c.room), [room(CHANNEL_A)]);
});

test("ListRooms failing still sweeps what the table believes", async () => {
  // Not knowing the full room list is a degraded sweep, not a blind one: the
  // table's own set is exactly what section 3.6 asks for, so it still runs.
  const backend = createBackend({
    rooms: { status: 500 },
    livekit: { [room(CHANNEL_A)]: { participants: [participant(USER_1)] } },
  });

  await tick(backend);

  assert.deepEqual(backend.replaced.map((r) => r.channelId), [CHANNEL_A]);
  assert.deepEqual(backend.reaped, [FIVE_MINUTES_AGO]);
});

test("the ListRooms token is not room-scoped, because that call is not", async () => {
  // LiveKit checks the two differently: ListRooms wants `roomList` and no room,
  // ListParticipants compares the token's own `room` claim to the room asked
  // about. One token shape cannot be assumed to serve both.
  const backend = createBackend({ channels: [], rooms: [], livekit: {} });

  await tick(backend);

  const call = backend.roomListCalls()[0];
  assert.ok(call, "the SFU was asked which rooms it has");
  const claims = JSON.parse(
    Buffer.from(call.authorization.slice("Bearer ".length).split(".")[1], "base64url").toString("utf8"),
  );
  assert.equal(claims.video.roomList, true);
  assert.equal(claims.video.room, undefined, "a list call names no room");
});

test("a channel whose write fails does not stop the next one", async () => {
  const backend = createBackend({
    channels: [CHANNEL_A, CHANNEL_B],
    livekit: {
      [room(CHANNEL_A)]: { participants: [participant(USER_1)] },
      [room(CHANNEL_B)]: { participants: [participant(USER_2)] },
    },
  });
  const supabase = backend.supabase;
  const original = supabase.rpc.bind(supabase);
  supabase.rpc = async (name, args) =>
    name === "voice_participants_replace" && args.p_channel_id === CHANNEL_A
      ? { data: null, error: { message: "deadlock detected", code: "40P01" } }
      : original(name, args);

  await reconciler.runVoiceReconcilerTick(supabase, { now: () => NOW });

  assert.deepEqual(backend.replaced.map((r) => r.channelId), [CHANNEL_B]);
  assert.deepEqual(backend.reaped, [FIVE_MINUTES_AGO], "one channel's failure is not blindness");
});
