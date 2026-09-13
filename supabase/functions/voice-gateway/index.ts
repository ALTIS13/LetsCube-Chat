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
// LIVEKIT_API_KEY, LIVEKIT_API_SECRET, plus the SUPABASE_* triple every gateway
// here already has. On the SFU, `webhook.api_key` must name the same key and
// `webhook.urls` must point at `<functions host>/voice-gateway/webhook`.
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
  canPublishInVoiceChannel,
  livekitHttpOrigin,
  mintVoiceAccessToken,
  mintVoiceAdminToken,
} from "./livekitToken.mjs";
import { readUuid, voiceRoomName } from "./roomName.mjs";
import {
  readBearerToken,
  readWebhookAuthToken,
  verifyLiveKitWebhookToken,
  webhookEventKey,
} from "./webhookAuth.mjs";
import { routeVoiceWebhookEvent } from "./webhookEvents.mjs";

const MAX_TOKEN_REQUEST_BYTES = 4_000;
const MAX_WEBHOOK_REQUEST_BYTES = 64 * 1_024;
const LIVEKIT_REQUEST_TIMEOUT_MS = 8_000;
// How long LiveKit keeps a room alive with nobody in it, matching the slice 1
// probe configuration. A shorter value makes a momentary reconnect look like
// the end of the call.
const ROOM_EMPTY_TIMEOUT_SECONDS = 60;

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
  return mintToken(request);
}

// ── POST /voice-gateway/token ────────────────────────────────────────────────

async function mintToken(request: Request): Promise<Response> {
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

  const admin = createClient(environment.supabaseUrl, environment.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

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
  const maxParticipants = Number(channelRow.max_participants);
  const participantCount = Number(channelRow.participant_count);
  if (!Number.isFinite(maxParticipants) || maxParticipants < 1) {
    return jsonResponse(request, { ok: false, error: "unavailable" }, 503);
  }
  if (Number.isFinite(participantCount) && participantCount >= maxParticipants) {
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
        body: JSON.stringify({
          name: voiceRoomName(channelId),
          maxParticipants,
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

function parseRoute(request: Request): "token" | "webhook" | null {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  const gatewayIndex = segments.lastIndexOf("voice-gateway");
  const path = gatewayIndex >= 0 ? segments.slice(gatewayIndex + 1) : segments;
  if (path.length !== 1) return null;
  if (path[0] === "token") return "token";
  if (path[0] === "webhook") return "webhook";
  return null;
}

function readEnvironment(): Environment | null {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const livekitUrl = Deno.env.get("LIVEKIT_URL");
  const livekitApiKey = Deno.env.get("LIVEKIT_API_KEY");
  const livekitApiSecret = Deno.env.get("LIVEKIT_API_SECRET");
  const livekitOrigin = livekitHttpOrigin(livekitUrl);
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

function jsonResponse(request: Request, body: unknown, status: number): Response {
  const headers = corsHeaders(request);
  headers.set("content-type", "application/json; charset=utf-8");
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
