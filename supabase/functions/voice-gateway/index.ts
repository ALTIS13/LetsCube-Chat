// The voice gateway: LiveKit token minting and webhook receipt.
//
// Slice 2 of `docs/proposals/2026-09-13-voice-channels.md`, section 3.4. It
// follows `phone-verification-gateway` for the caller's Supabase JWT and the
// service-role client, and `support-gateway` for route parsing and the response
// shape. Nothing new was invented here.
//
// Deploy with `--no-verify-jwt`, as the other gateways are: this function does
// its own verification, and the webhook route's `Authorization` header carries
// a LiveKit-signed JWT that Kong would otherwise reject before it arrived.
//
// Environment: LIVEKIT_URL (the signalling URL clients dial, `wss://…`),
// LIVEKIT_API_URL (optional — where *this* function reaches the twirp API, for a
// deployment that keeps that API off the internet), LIVEKIT_API_KEY,
// LIVEKIT_API_SECRET, plus the SUPABASE_* triple every gateway here already has.
// On the SFU, `webhook.api_key` must name the same key and `webhook.urls` must
// point at `<functions host>/voice-gateway/webhook`.
//
// Two optional names added with slice 5's limits, both read per request rather
// than captured once, so changing either needs no function deploy —
// `VOICE_ENABLED=false` is the kill switch and `VOICE_MAX_TOTAL_PARTICIPANTS`
// is this deployment's concurrency cap. `admission.mjs` holds what each value
// means and what the switch does and does not reach.
//
// One thing to check at deploy rather than assume: LiveKit sends no `apikey`
// header, so the webhook URL has to reach this function without one. If the
// Kong route in front of the functions runtime demands it, put it in the URL's
// query string — the webhook signature, not that header, is what authorizes
// the call either way.
//
// What a real delivery looks like, captured from LiveKit 1.8.4 on the probe on
// 2026-09-13 rather than taken from the documentation:
//   content-type: application/webhook+json
//   authorization: <compact JWS>          (no `Bearer`, no scheme)
//   claims:        iss, exp, nbf, sha256  (sha256 in *standard* base64)
//   body:          {createdAt, event, id, room[, participant]}, camelCase,
//                  id like `EV_x9k2…`, participant.joinedAt a decimal string
// Six events arrive for one call: room_started, participant_joined,
// track_published, track_unpublished, participant_left, room_finished.
//
// Everything that decides *what* is true — the grants in a token, the room name,
// the body hash, the event routing — lives in the four `.mjs` modules beside
// this file and is covered by `tests/unit/voice-gateway-*.test.mjs`. What is
// left here is transport: HTTP, environment, Supabase and one call to the SFU.
//
// No secret, token or request body is ever logged, and no error string from the
// database or from LiveKit is ever put in a response.
import { createClient } from "npm:@supabase/supabase-js@2.105.1";

import {
  readVoiceActiveParticipants,
  readVoiceAdmission,
  readVoiceConcurrencyCap,
  readVoiceRateLimitAnswer,
  VOICE_IN_FLIGHT_SECONDS,
  VOICE_RATE_LIMITS,
} from "./admission.mjs";
import {
  canPublishInVoiceChannel,
  livekitHttpOrigin,
  mintVoiceAccessToken,
  mintVoiceAdminToken,
} from "./livekitToken.mjs";
import {
  buildRemoveParticipantPayload,
  buildUpdateParticipantPayload,
  moderationRefusal,
  readModerationRequest,
  readTwirpCode,
} from "./moderation.mjs";
import { createVoiceModerationRateLimiter } from "./moderationRateLimit.mjs";
import { readUuid, voiceRoomName } from "./roomName.mjs";
import {
  liveKitMaxParticipants,
  readSeatLimit,
  voiceChannelIsFull,
} from "./seatLimit.mjs";
import {
  readBearerToken,
  readWebhookAuthToken,
  verifyLiveKitWebhookToken,
  webhookEventKey,
} from "./webhookAuth.mjs";
import { routeVoiceWebhookEvent } from "./webhookEvents.mjs";

const MAX_TOKEN_REQUEST_BYTES = 4_000;
const MAX_MODERATION_REQUEST_BYTES = 4_000;
const MAX_WEBHOOK_REQUEST_BYTES = 64 * 1_024;
// Eight seconds, which the moderation routes measured a reason for: an
// `UpdateParticipant` aimed at a room the SFU is not hosting answers 503 after
// its own internal RPC timeout, measured at 3.06s on 2026-09-18, so a shorter
// value here would turn that refusal into an abort and report the wrong thing.
const LIVEKIT_REQUEST_TIMEOUT_MS = 8_000;
// How long LiveKit keeps a room alive with nobody in it, matching the slice 1
// probe configuration. A shorter value makes a momentary reconnect look like
// the end of the call.
const ROOM_EMPTY_TIMEOUT_SECONDS = 60;

// Per isolate, on support-gateway's pattern. See moderationRateLimit.mjs for
// what that does and does not bound.
//
// Two instances rather than one map with namespaced keys, so the two routes
// keep separate allowances: a moderator clearing a raid must not spend the
// allowance they need to rejoin the call themselves.
//
// Both are now the *first* of two layers. The second — `voice_rate_limit_consume`
// below — binds the whole deployment rather than one isolate, which is what
// moderationRateLimit.mjs's own header said the real thing needed. This layer
// stays in front of it because it costs a map lookup and no round trip, so a
// loop inside one isolate is refused without touching the database at all.
const moderationLimiter = createVoiceModerationRateLimiter();
const tokenLimiter = createVoiceModerationRateLimiter();

// **The degraded state is deliberately not logged**, and that cost an argument
// worth recording. Both limits fail open, and failing open silently is the
// version of that decision nobody can operate — so the first draft of this
// file warned once per isolate when the RPC could not be reached.
// `voice-gateway-token.test.mjs` refuses any `console.*` in this gateway at
// all, a blanket rule rather than a judgement about which strings are safe,
// and narrowing a security guard to fit a convenience is the wrong way round.
//
// So it is observable by asking instead, which is where an operator already is
// when they apply the migration:
//
//   * `select count(*) from private.voice_rate_limit_signals where action =
//     'token_mint'` is non-zero after a join if the limiter is live — and it is
//     also the only way to tell a 429 from this layer apart from a 429 from the
//     per-isolate one, since both answer `rate_limited`;
//   * `select public.voice_active_participants(30)` answering a number proves
//     the cap has something to compare against.

type Environment = {
  supabaseUrl: string;
  publicKey: string;
  serviceRoleKey: string;
  livekitUrl: string;
  livekitOrigin: string;
  livekitApiKey: string;
  livekitApiSecret: string;
};

Deno.serve(async (request: Request) => {
  try {
    return await handleRequest(request);
  } catch {
    return jsonResponse(request, { ok: false, error: "unavailable" }, 503);
  }
});

async function handleRequest(request: Request): Promise<Response> {
  const route = parseRoute(request);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (route === null) {
    return jsonResponse(request, { ok: false, error: "not_found" }, 404);
  }
  if (request.method !== "POST") {
    return jsonResponse(request, { ok: false, error: "method_not_allowed" }, 405);
  }

  if (route === "webhook") return receiveWebhook(request);
  if (route === "force-mute" || route === "remove") {
    return moderateParticipant(request, route);
  }
  return mintToken(request);
}

// ── POST /voice-gateway/token ────────────────────────────────────────────────

async function mintToken(request: Request): Promise<Response> {
  // Before the body, before the JWT, before anything: a deployment that has
  // switched voice off answers the same way whatever was asked of it, and a
  // deployment whose switch or cap is misspelled refuses rather than guessing.
  // Neither answer needs an identity, and neither is a secret.
  const gate = voiceEnvironmentGate();
  if (!gate.ok) {
    return jsonResponse(request, { ok: false, error: gate.error }, gate.status);
  }

  const raw = await request.text();
  if (!raw || new TextEncoder().encode(raw).byteLength > MAX_TOKEN_REQUEST_BYTES) {
    return jsonResponse(request, { ok: false, error: "invalid_request" }, 400);
  }
  let body: { channelId?: unknown };
  try {
    body = JSON.parse(raw) as { channelId?: unknown };
  } catch {
    return jsonResponse(request, { ok: false, error: "invalid_request" }, 400);
  }
  const channelId = readUuid(body?.channelId);
  if (!channelId) {
    return jsonResponse(request, { ok: false, error: "invalid_request" }, 400);
  }

  const accessToken = readBearerToken(request.headers.get("authorization"));
  if (!accessToken) {
    return jsonResponse(request, { ok: false, error: "unauthorized" }, 401);
  }
  const environment = readEnvironment();
  if (!environment) {
    return jsonResponse(request, { ok: false, error: "not_configured" }, 503);
  }

  // 1. The caller's Supabase JWT, verified the way phone-verification-gateway
  //    verifies it. `sub` is the user id and the only identity used below.
  const authClient = createClient(environment.supabaseUrl, environment.publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(
    accessToken,
  );
  const userId = authError ? null : readUuid(authData?.user?.id);
  if (!userId) {
    return jsonResponse(request, { ok: false, error: "unauthorized" }, 401);
  }

  // 1a. The per-isolate limiter, keyed on the verified caller, before any
  //     database work at all: a loop inside one isolate costs one map lookup.
  const isolateLimit = tokenLimiter.check(userId);
  if (!isolateLimit.ok) {
    return jsonResponse(request, { ok: false, error: "rate_limited" }, 429, {
      "retry-after": String(isolateLimit.retryAfterSeconds),
    });
  }

  const admin = createClient(environment.supabaseUrl, environment.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1b. This deployment's concurrency cap, asked *before* the allowance is
  //     spent. A deployment at capacity therefore writes nothing and keeps
  //     answering the truthful reason however often it is asked, while the
  //     per-isolate limiter above bounds the asking. Spending the allowance
  //     first would turn the twenty-first retry into «слишком много попыток»,
  //     which is a false statement about a server that is simply full.
  if (gate.cap !== null) {
    // `null` is «I could not count», and a deployment that cannot count its
    // participants must not stop taking calls — the same fail-open choice as
    // the limiter below, for the same reason.
    const active = readVoiceActiveParticipants(
      await countActiveVoiceParticipants(admin),
    );
    if (active !== null && active >= gate.cap) {
      return jsonResponse(request, { ok: false, error: "voice_at_capacity" }, 503);
    }
  }

  // 1c. The deployment-wide limiter. One row per allowed mint and nothing at
  //     all for a refusal, so the row cost per caller per window is the limit
  //     itself however hard the caller hammers.
  const deploymentLimit = await consumeVoiceRateLimit(admin, userId, "token_mint");
  if (!deploymentLimit.allowed) {
    return jsonResponse(request, { ok: false, error: "rate_limited" }, 429, {
      "retry-after": String(deploymentLimit.retryAfterSeconds),
    });
  }

  // 2. A banned caller gets no token at all (section 3.7).
  const banned = await admin.rpc("is_banned", { uid: userId });
  if (banned.error) {
    return jsonResponse(request, { ok: false, error: "unavailable" }, 503);
  }
  if (banned.data === true) {
    return jsonResponse(request, { ok: false, error: "banned" }, 403);
  }

  // 3. The channel and the caller's membership row, read with the service role.
  const channel = await admin
    .from("voice_channels")
    .select("id, chat_id, max_participants, speak_role, participant_count, archived")
    .eq("id", channelId)
    .maybeSingle();
  if (channel.error) {
    return jsonResponse(request, { ok: false, error: "unavailable" }, 503);
  }
  const channelRow = channel.data as
    | {
      chat_id: string;
      max_participants: number;
      speak_role: string;
      participant_count: number;
      archived: boolean;
    }
    | null;
  if (!channelRow || channelRow.archived === true) {
    return jsonResponse(request, { ok: false, error: "channel_not_found" }, 404);
  }

  const membership = await admin
    .from("chat_members")
    .select("role")
    .eq("chat_id", channelRow.chat_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (membership.error) {
    return jsonResponse(request, { ok: false, error: "unavailable" }, 503);
  }
  const memberRole = (membership.data as { role?: string } | null)?.role ?? null;
  if (!memberRole) {
    return jsonResponse(request, { ok: false, error: "not_a_member" }, 403);
  }

  // 4. The cap, read from the table. Step 5 asks the SFU to enforce the same
  //    number, which is the enforcement that actually binds.
  //
  //    0 means «no limit» — the owner's «изначально ограничения быть не
  //    должно» — and it is the column's default since
  //    `20260920130000_a_group_voice_channel_has_no_seat_limit.sql`. Both the
  //    refusal below and the comparison after it are in `seatLimit.mjs`, which
  //    also records the measurement that says why 0 only reaches the SFU as
  //    «unbounded» while `livekit.yaml` carries `room.max_participants: 0`.
  const maxParticipants = readSeatLimit(channelRow.max_participants);
  if (maxParticipants === null) {
    return jsonResponse(request, { ok: false, error: "unavailable" }, 503);
  }
  if (
    voiceChannelIsFull({
      limit: maxParticipants,
      participantCount: channelRow.participant_count,
    })
  ) {
    return jsonResponse(request, { ok: false, error: "channel_full" }, 409);
  }

  const muted = await admin.rpc("is_muted", {
    uid: userId,
    cid: channelRow.chat_id,
  });
  if (muted.error) {
    return jsonResponse(request, { ok: false, error: "unavailable" }, 503);
  }
  const canPublish = canPublishInVoiceChannel({
    memberRole,
    speakRole: channelRow.speak_role,
    muted: muted.data === true,
  });

  // The display name is cosmetic: a missing profile row must not stop a call.
  // `full_name` then `username` is what `chatDisplay.ts` and every other reader
  // in this repository uses; there is no `display_name` column, and asking for
  // one made this an always-failing round trip whose error the fallback hid.
  const profile = await admin
    .from("profiles")
    .select("full_name, username")
    .eq("id", userId)
    .maybeSingle();
  const profileRow = profile.error
    ? null
    : (profile.data as { full_name?: string | null; username?: string | null } | null);
  const displayName = profileRow?.full_name || profileRow?.username || "";

  // 5. `auto_create: false` on the SFU means a token cannot conjure a room —
  //    measured in slice 1 — so the room is created deliberately, with the cap.
  const room = await createLiveKitRoom(environment, channelId, maxParticipants);
  if (!room.ok) {
    return jsonResponse(request, { ok: false, error: "voice_unavailable" }, 503);
  }

  // 6. The client token. `roomAdmin` and `roomCreate` are literals inside
  //    buildVoiceAccessTokenClaims and cannot be reached from here.
  const minted = await mintVoiceAccessToken({
    apiKey: environment.livekitApiKey,
    apiSecret: environment.livekitApiSecret,
    identity: userId,
    displayName,
    channelId,
    canPublish,
    nowSeconds: Date.now() / 1_000,
  });
  if (!minted.ok) {
    return jsonResponse(request, { ok: false, error: "unavailable" }, 503);
  }

  return jsonResponse(
    request,
    {
      ok: true,
      url: environment.livekitUrl,
      room: minted.room,
      identity: userId,
      token: minted.token,
      expiresAt: minted.expiresAt,
      canPublish: minted.canPublish,
      maxParticipants,
    },
    200,
  );
}

async function createLiveKitRoom(
  environment: Environment,
  channelId: string,
  maxParticipants: number,
): Promise<{ ok: boolean }> {
  // Minted here, used once, never returned to anyone. It carries roomCreate and
  // roomAdmin, which is exactly why it does not leave this function.
  const adminToken = await mintVoiceAdminToken({
    apiKey: environment.livekitApiKey,
    apiSecret: environment.livekitApiSecret,
    channelId,
    nowSeconds: Date.now() / 1_000,
  });
  if (!adminToken.ok) return { ok: false };

  let response: Response;
  try {
    response = await fetch(
      `${environment.livekitOrigin}/twirp/livekit.RoomService/CreateRoom`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${adminToken.token}`,
          "content-type": "application/json",
        },
        // `maxParticipants` goes across unchanged, 0 included — and 0 is only
        // «unbounded» to an SFU whose own `room.max_participants` is 0, because
        // 0 is proto3's zero value and an absent field takes the config
        // default. Measured on 2026-09-20: against the production config of 10,
        // a room asked for 0 came back holding 10. `seatLimit.mjs` carries the
        // whole measurement and the constant that makes this dependency
        // greppable.
        body: JSON.stringify({
          name: voiceRoomName(channelId),
          maxParticipants: liveKitMaxParticipants(maxParticipants),
          emptyTimeout: ROOM_EMPTY_TIMEOUT_SECONDS,
        }),
        signal: AbortSignal.timeout(LIVEKIT_REQUEST_TIMEOUT_MS),
      },
    );
  } catch {
    return { ok: false };
  }
  // Drained and discarded: CreateRoom on an existing room returns that room,
  // and nothing in the body is needed or safe to echo.
  await response.text().catch(() => "");
  return { ok: response.ok };
}

// ── the two limits, and the switch ──────────────────────────────────────────

/**
 * The switch and the cap, read from the environment on this request.
 *
 * Both names are read here and nowhere else, and neither is captured in a
 * module-level constant — which is the whole point of a kill switch. An Edge
 * Function's `Deno.env.get` answers from the container's process environment,
 * so a new value needs that container restarted; what it does **not** need is
 * this function rebuilt or redeployed. `BOT_CREATION_ENABLED` has exactly the
 * same requirement on the bot gateway, which resolves admission once at
 * construction (`botGatewayIndex.ts:90`).
 */
function voiceEnvironmentGate():
  | { ok: true; cap: number | null }
  | { ok: false; error: string; status: number } {
  const admission = readVoiceAdmission({ VOICE_ENABLED: Deno.env.get("VOICE_ENABLED") });
  if (!admission.ok) return admission;
  return readVoiceConcurrencyCap({
    VOICE_MAX_TOTAL_PARTICIPANTS: Deno.env.get("VOICE_MAX_TOTAL_PARTICIPANTS"),
  });
}

/**
 * One caller's allowance, spent against the whole deployment rather than one
 * isolate.
 *
 * `support_rate_limit_signals` is the pattern this follows, named by
 * `moderationRateLimit.mjs`'s own header as what the real thing would need: a
 * table nobody outside the database can see, and one SECURITY DEFINER function
 * that both counts the window and records the attempt in one transaction, so
 * two isolates asking at the same instant cannot both be told yes.
 *
 * An error, or an answer this code does not recognise, allows — see
 * `readVoiceRateLimitAnswer` for why, and note that «the migration has not been
 * applied here yet» is the same case.
 */
async function consumeVoiceRateLimit(
  admin: ReturnType<typeof createClient>,
  userId: string,
  action: "token_mint" | "moderate",
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  const plan = VOICE_RATE_LIMITS[action];
  const answer = await admin.rpc("voice_rate_limit_consume", {
    p_user_id: userId,
    p_action: action,
    p_limit: plan.limit,
    p_window_seconds: plan.windowSeconds,
  });
  // `read.degraded` says «this answer was unusable, so the caller was allowed
  // without being counted». It is not logged here; see the note beside the two
  // limiter instances above for why, and for how to observe it instead.
  return readVoiceRateLimitAnswer(answer.error ? null : answer.data);
}

/** How many people this deployment is carrying, connected plus in flight. */
async function countActiveVoiceParticipants(
  admin: ReturnType<typeof createClient>,
): Promise<unknown> {
  const answer = await admin.rpc("voice_active_participants", {
    p_in_flight_seconds: VOICE_IN_FLIGHT_SECONDS,
  });
  return answer.error ? null : answer.data;
}

// ── POST /voice-gateway/force-mute, POST /voice-gateway/remove ───────────────

/**
 * Silencing or removing somebody who is connected right now.
 *
 * Slice 5's two moderation actions. Until these existed the only lever was
 * `canPublish` at mint, which is evaluated once and never again: a person being
 * disruptive could not be stopped until they chose to reconnect, which is the
 * one thing they had no reason to do.
 *
 * The order below is the authorisation, and every step reads the database
 * rather than the request:
 *
 *   1. the body — two uuids and, for a mute, a real boolean;
 *   2. the caller's Supabase JWT, verified as the token route verifies it;
 *   3. the rate limit, keyed on the caller, before any database work — then
 *      again against the whole deployment, which costs one round trip and one
 *      row per action and is why the caveat in `moderationRateLimit.mjs`'s
 *      header no longer applies to these two routes;
 *   4. `is_banned` on the caller;
 *   5. the channel row, which is where `chat_id` comes from — never the client;
 *   6. the caller's `chat_members` row for that chat, and the target's;
 *   7. `moderationRefusal`, which holds the whole matrix as a pure function.
 *
 * Nothing about the target is decided before the caller's own standing is, so
 * this route cannot be used to discover who owns a chat.
 */
async function moderateParticipant(
  request: Request,
  action: "force-mute" | "remove",
): Promise<Response> {
  const raw = await request.text();
  if (
    !raw ||
    new TextEncoder().encode(raw).byteLength > MAX_MODERATION_REQUEST_BYTES
  ) {
    return jsonResponse(request, { ok: false, error: "invalid_request" }, 400);
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonResponse(request, { ok: false, error: "invalid_request" }, 400);
  }
  const parsed = readModerationRequest(action, body);
  if (!parsed.ok) {
    // `not_found` is the module refusing an action it does not have, which
    // `parseRoute` makes unreachable from here; it keeps its own status rather
    // than being flattened into 400, so the two never have to agree by luck.
    const status = parsed.error === "not_found" ? 404 : 400;
    return jsonResponse(request, { ok: false, error: parsed.error }, status);
  }
  const { channelId, userId, muted } = parsed.value as {
    channelId: string;
    userId: string;
    muted: boolean | null;
  };

  const accessToken = readBearerToken(request.headers.get("authorization"));
  if (!accessToken) {
    return jsonResponse(request, { ok: false, error: "unauthorized" }, 401);
  }
  const environment = readEnvironment();
  if (!environment) {
    return jsonResponse(request, { ok: false, error: "not_configured" }, 503);
  }

  const authClient = createClient(environment.supabaseUrl, environment.publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(
    accessToken,
  );
  const callerId = authError ? null : readUuid(authData?.user?.id);
  if (!callerId) {
    return jsonResponse(request, { ok: false, error: "unauthorized" }, 401);
  }

  // Keyed on the verified caller, so nobody can spend somebody else's
  // allowance, and placed before the database so a loop costs one map lookup.
  const limit = moderationLimiter.check(callerId);
  if (!limit.ok) {
    return jsonResponse(request, { ok: false, error: "rate_limited" }, 429, {
      "retry-after": String(limit.retryAfterSeconds),
    });
  }

  const admin = createClient(environment.supabaseUrl, environment.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // The same allowance, spent against the deployment rather than this isolate.
  // It sits behind the map lookup above, so a held-down button still costs no
  // round trip, and in front of every read below, so a loop cannot walk the
  // authorisation path at all.
  const deploymentLimit = await consumeVoiceRateLimit(admin, callerId, "moderate");
  if (!deploymentLimit.allowed) {
    return jsonResponse(request, { ok: false, error: "rate_limited" }, 429, {
      "retry-after": String(deploymentLimit.retryAfterSeconds),
    });
  }

  const banned = await admin.rpc("is_banned", { uid: callerId });
  if (banned.error) {
    return jsonResponse(request, { ok: false, error: "unavailable" }, 503);
  }
  if (banned.data === true) {
    return jsonResponse(request, { ok: false, error: "banned" }, 403);
  }

  const channel = await admin
    .from("voice_channels")
    .select("id, chat_id, speak_role, archived")
    .eq("id", channelId)
    .maybeSingle();
  if (channel.error) {
    return jsonResponse(request, { ok: false, error: "unavailable" }, 503);
  }
  const channelRow = channel.data as
    | { chat_id: string; speak_role: string; archived: boolean }
    | null;
  if (!channelRow || channelRow.archived === true) {
    return jsonResponse(request, { ok: false, error: "channel_not_found" }, 404);
  }

  const callerRole = await readChatRole(admin, channelRow.chat_id, callerId);
  if (!callerRole.ok) {
    return jsonResponse(request, { ok: false, error: "unavailable" }, 503);
  }
  const targetRole = await readChatRole(admin, channelRow.chat_id, userId);
  if (!targetRole.ok) {
    return jsonResponse(request, { ok: false, error: "unavailable" }, 503);
  }

  const refusal = moderationRefusal({
    action,
    callerId,
    callerRole: callerRole.role,
    targetId: userId,
    targetRole: targetRole.role,
  });
  if (refusal) {
    return jsonResponse(request, { ok: false, error: refusal.error }, refusal.status);
  }

  const room = voiceRoomName(channelId);
  if (room === null) {
    return jsonResponse(request, { ok: false, error: "invalid_request" }, 400);
  }

  if (action === "remove") {
    const removed = await callLiveKitRoomService(
      environment,
      channelId,
      "RemoveParticipant",
      buildRemoveParticipantPayload({ room, identity: userId }),
    );
    if (!removed.ok) {
      return jsonResponse(request, { ok: false, error: removed.error }, removed.status);
    }
    return jsonResponse(request, { ok: true, channelId, userId }, 200);
  }

  // Lifting a force-mute restores **the policy answer**, never an
  // unconditional yes. Without that, an administrator below a channel's
  // `speak_role`, or one carrying a staff mute from `public.mutes`, could
  // unmute themselves past both — which is why this asks the same function the
  // token route asks and why acting on yourself is refused as well.
  let canPublish = false;
  if (muted === false) {
    const staffMuted = await admin.rpc("is_muted", {
      uid: userId,
      cid: channelRow.chat_id,
    });
    if (staffMuted.error) {
      return jsonResponse(request, { ok: false, error: "unavailable" }, 503);
    }
    canPublish = canPublishInVoiceChannel({
      memberRole: targetRole.role,
      speakRole: channelRow.speak_role,
      muted: staffMuted.data === true,
    });
  }

  const updated = await callLiveKitRoomService(
    environment,
    channelId,
    "UpdateParticipant",
    buildUpdateParticipantPayload({ room, identity: userId, canPublish }),
  );
  if (!updated.ok) {
    return jsonResponse(request, { ok: false, error: updated.error }, updated.status);
  }
  return jsonResponse(
    request,
    { ok: true, channelId, userId, muted: muted === true, canPublish },
    200,
  );
}

/**
 * One membership row, read with the service role for a named user.
 *
 * `is_chat_admin(cid)` is the predicate every voice policy uses and it is
 * deliberately not called here: it takes no user and reads `auth.uid()`, which
 * is null on a service-role connection, so from this gateway it would refuse
 * everybody. The token route already establishes the caller this way — verify
 * the JWT, then read the row for that `sub` — and `moderationRefusal` applies
 * the comparison `is_chat_admin` makes to the row this returns.
 *
 * A missing row is `{ ok: true, role: null }`, which is a fact. Only a failed
 * read is `{ ok: false }`, because «I could not ask» must never be read as
 * «they are not a member».
 */
async function readChatRole(
  admin: ReturnType<typeof createClient>,
  chatId: string,
  userId: string,
): Promise<{ ok: true; role: string | null } | { ok: false }> {
  const membership = await admin
    .from("chat_members")
    .select("role")
    .eq("chat_id", chatId)
    .eq("user_id", userId)
    .maybeSingle();
  if (membership.error) return { ok: false };
  const role = (membership.data as { role?: string } | null)?.role ?? null;
  return { ok: true, role };
}

/**
 * One administrative twirp call against the SFU.
 *
 * The token is minted per call and scoped to this room, which is not a
 * formality: measured on 2026-09-18, an admin token naming no room is refused
 * `UpdateParticipant` with 401, because LiveKit compares the token's own `room`
 * claim against the room being administered. A single unscoped admin token
 * administers nothing.
 *
 * Failure is reported, never swallowed. The two 404s this server produces mean
 * opposite things and are told apart by the body's twirp code: `not_found` is
 * «that person is not in the room», while `bad_route` is «this method does not
 * exist on this build» and is an outage, not an empty room.
 */
async function callLiveKitRoomService(
  environment: Environment,
  channelId: string,
  method: "UpdateParticipant" | "RemoveParticipant",
  payload: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const adminToken = await mintVoiceAdminToken({
    apiKey: environment.livekitApiKey,
    apiSecret: environment.livekitApiSecret,
    channelId,
    nowSeconds: Date.now() / 1_000,
  });
  if (!adminToken.ok) return { ok: false, error: "unavailable", status: 503 };

  let response: Response;
  try {
    response = await fetch(
      `${environment.livekitOrigin}/twirp/livekit.RoomService/${method}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${adminToken.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(LIVEKIT_REQUEST_TIMEOUT_MS),
      },
    );
  } catch {
    return { ok: false, error: "voice_unavailable", status: 503 };
  }

  const text = await response.text().catch(() => "");
  if (response.ok) return { ok: true };
  if (response.status === 404 && readTwirpCode(text) === "not_found") {
    return { ok: false, error: "participant_not_in_room", status: 404 };
  }
  return { ok: false, error: "voice_unavailable", status: 503 };
}

// ── POST /voice-gateway/webhook ──────────────────────────────────────────────

async function receiveWebhook(request: Request): Promise<Response> {
  // The raw bytes, not `request.text()` re-encoded: the hash has to be over
  // what arrived.
  const bodyBytes = new Uint8Array(await request.arrayBuffer());
  if (
    bodyBytes.byteLength === 0 ||
    bodyBytes.byteLength > MAX_WEBHOOK_REQUEST_BYTES
  ) {
    return plainJson({ ok: false, error: "invalid_request" }, 400);
  }

  const environment = readEnvironment();
  if (!environment) return plainJson({ ok: false, error: "not_configured" }, 503);

  // Not `readBearerToken`: LiveKit 1.8.4 sends the token with no scheme at all.
  const token = readWebhookAuthToken(request.headers.get("authorization"));
  const verified = token
    ? await verifyLiveKitWebhookToken(token, {
      apiKey: environment.livekitApiKey,
      apiSecret: environment.livekitApiSecret,
      bodyBytes,
      nowSeconds: Date.now() / 1_000,
    })
    : { ok: false, error: "missing_token" };
  if (!verified.ok) {
    // Which of the checks failed is never disclosed: the gateway must not be an
    // oracle for whether a signature was right but a body hash wrong.
    return plainJson({ ok: false, error: "unauthorized" }, 401);
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(new TextDecoder().decode(bodyBytes)) as Record<
      string,
      unknown
    >;
  } catch {
    return plainJson({ ok: false, error: "invalid_request" }, 400);
  }

  // Routed before the database is touched. LiveKit sends far more event types
  // than the four that matter, and recording every `track_published` in the
  // idempotency table would fill it with events nothing acts on.
  const routed = routeVoiceWebhookEvent(event, {
    receivedAt: new Date().toISOString(),
  });
  if (!routed.ok) return plainJson({ ok: false, error: "invalid_request" }, 400);
  if (routed.action === "ignore") {
    return plainJson({ ok: true, status: "ignored" }, 200);
  }

  const admin = createClient(environment.supabaseUrl, environment.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const seen = await admin.rpc("voice_webhook_event_seen", {
    p_event_id: await webhookEventKey(event.id, bodyBytes),
  });
  if (seen.error) return plainJson({ ok: false, error: "unavailable" }, 503);
  if (seen.data === false) return plainJson({ ok: true, status: "duplicate" }, 200);
  if (seen.data !== true) return plainJson({ ok: false, error: "unavailable" }, 503);

  // The window this leaves: if the RPC below fails after the event id was
  // recorded, LiveKit's redelivery is dropped as a duplicate and that event is
  // lost. All four RPCs are idempotent, so the order could be flipped; it is
  // this way because section 3.4 specifies it, and because layer 3 — the
  // reconciler — exists precisely to repair a lost event.
  const applied = await admin.rpc(routed.rpc, routed.args);
  if (applied.error) return plainJson({ ok: false, error: "unavailable" }, 503);
  return plainJson({ ok: true, status: "applied" }, 200);
}

// ── transport ────────────────────────────────────────────────────────────────

type Route = "token" | "webhook" | "force-mute" | "remove";

function parseRoute(request: Request): Route | null {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  const gatewayIndex = segments.lastIndexOf("voice-gateway");
  const path = gatewayIndex >= 0 ? segments.slice(gatewayIndex + 1) : segments;
  if (path.length !== 1) return null;
  if (path[0] === "token") return "token";
  if (path[0] === "webhook") return "webhook";
  if (path[0] === "force-mute") return "force-mute";
  if (path[0] === "remove") return "remove";
  return null;
}

function readEnvironment(): Environment | null {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const livekitUrl = Deno.env.get("LIVEKIT_URL");
  const livekitApiKey = Deno.env.get("LIVEKIT_API_KEY");
  const livekitApiSecret = Deno.env.get("LIVEKIT_API_SECRET");
  // Two URLs, because here they are different things. `LIVEKIT_URL` is what a
  // browser dials and goes in the response; `LIVEKIT_API_URL` is where this
  // function reaches the twirp API, which is the container on the internal
  // network -- so the administrative API is never published at all. Where the
  // SFU owns a hostname the second is unset and the first serves for both.
  const livekitOrigin = livekitHttpOrigin(
    Deno.env.get("LIVEKIT_API_URL") || livekitUrl,
  );
  if (
    !supabaseUrl ||
    !publicKey ||
    !serviceRoleKey ||
    !livekitUrl ||
    !livekitOrigin ||
    !livekitApiKey ||
    !livekitApiSecret
  ) {
    return null;
  }
  return {
    supabaseUrl,
    publicKey,
    serviceRoleKey,
    livekitUrl,
    livekitOrigin,
    livekitApiKey,
    livekitApiSecret,
  };
}

/**
 * The allowlist decides which origin is echoed back, and nothing else — a
 * request from an unlisted origin is not refused. This is
 * phone-verification-gateway's behaviour rather than support-gateway's, on
 * purpose: the Windows and Android shells send an origin of their own
 * (`tauri.localhost`, `https://localhost`) that no allowlist written for the
 * browser would contain, and refusing them would take voice out of two of the
 * three shells. Authorization here is the caller's Supabase JWT.
 */
function allowedCorsOrigin(origin: string | null): string | null {
  if (!origin) return null;
  const configured = (Deno.env.get("KUB_PUBLIC_ORIGINS") ?? "https://app.letscube.ru")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return configured.includes(origin) ? origin : null;
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    vary: "Origin",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, apikey",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  const origin = allowedCorsOrigin(request.headers.get("origin"));
  if (origin) headers.set("access-control-allow-origin", origin);
  return headers;
}

function jsonResponse(
  request: Request,
  body: unknown,
  status: number,
  // Only the moderation routes use this, and only for `retry-after` on a 429.
  extra?: Record<string, string>,
): Response {
  const headers = corsHeaders(request);
  headers.set("content-type", "application/json; charset=utf-8");
  for (const [name, value] of Object.entries(extra ?? {})) headers.set(name, value);
  return new Response(JSON.stringify(body), { status, headers });
}

function plainJson(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
