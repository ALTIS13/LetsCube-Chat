// Layer 3 and layer 4 of section 3.6 of docs/proposals/2026-09-13-voice-channels.md.
//
// The SFU owns the truth about who is in a call; `public.voice_participants` is
// a mirror of it, for everyone *outside* the call (the chat list badge, the
// channel row, the group panel). The people in the call render from the LiveKit
// SDK and never read this table, which is why a stale row here is a cosmetic
// defect outside rather than a broken call inside.
//
// The mirror goes wrong when a client disappears without leaving -- a lift, a
// killed tab, a force-quit, a suspended PWA. LiveKit notices (its ICE/DTLS and
// signalling connections die, which is the only mechanism in the stack that
// asks the client to *stop* rather than to *do*) and fires `participant_left`,
// but LiveKit itself documents that webhook delivery has no guarantees. A
// dropped `left` leaves a ghost that nothing in the webhook path will ever
// notice.
//
// So every tick this worker asks LiveKit for the complete membership of every
// room the table believes is live and writes that whole set in one statement.
// A ghost therefore lives at most one reconciliation period, whatever made it.
//
// The one rule that matters more than the rest: AN ERROR IS NOT AN EMPTY ROOM.
// A timeout, a refused connection, a 5xx or a body that does not parse all mean
// "I do not know", and the correct action on not knowing is to write nothing
// and ask again in thirty seconds. Writing an empty set on a failed call would
// hang up every live call in the product the first time the SFU hiccuped.

import { createHmac } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../lib/logger";

/**
 * Thirty seconds, because section 3.6 states the bound it buys and the product
 * is held to it: a ghost is visible outside the call for at most one
 * reconciliation period in the normal case, and at most the reaper's threshold
 * in the pathological one. Shortening it buys a tighter bound at a linear cost
 * in requests; lengthening it makes the honest sentence in the proposal false.
 */
const DEFAULT_TICK_MS = 30_000;
/**
 * Layer 4. A row not confirmed for five minutes was not there five minutes ago.
 *
 * **This number is now half of a promise, and the other half lives in the
 * client.** Queue item 35 of `docs/PRODUCTION_PRIORITY_TRACKER.md` puts
 * somebody back into the channel they dropped out of, within a window; that
 * window and this one govern the two sides of the same fact. This one decides
 * how long *everybody else* still sees the person in the channel; the client's
 * decides how long the person may come back to it.
 *
 * So they have to be equal, and the error is asymmetric in an instructive way.
 * A client window **longer** than this returns somebody to a channel whose row
 * was already reaped: they are back, and nobody outside the call can see them.
 * A client window **shorter** leaves the row standing after the person has
 * given up, which is the ghost this reaper exists to remove. Neither may drift
 * alone.
 *
 * They cannot be one constant — different deployables — so each names the
 * other, the way `RATE_LIMIT_RETENTION_MS` below already names the gateway's.
 * What the server imposes on a return, measured rather than assumed, is in
 * `docs/operations/voice.md` under «Coming back after a drop»: LiveKit retains
 * no participant at all, so this five minutes is not a constraint the SFU hands
 * us, it is a promise we chose.
 */
const DEFAULT_STALE_MS = 5 * 60_000;
/** Webhook idempotency keys are worthless once no webhook can still be retried. */
const DEFAULT_WEBHOOK_RETENTION_MS = 24 * 60 * 60_000;
/**
 * Rate-limit signals are worthless once they have aged out of the gateway's
 * window, which is sixty seconds today. Ten minutes rather than ninety seconds
 * on purpose: that constant lives in a different deployable
 * (`supabase/functions/voice-gateway/admission.mjs`) and can be widened without
 * this worker changing, and a table whose size is already bounded by the limit
 * gains nothing from a tight sweep. Deleting a signal the gateway still wanted
 * would silently widen somebody's allowance, which is the one error worth
 * spending disk to avoid.
 */
const RATE_LIMIT_RETENTION_MS = 10 * 60_000;
/**
 * A hung SFU must not hold a tick open. Failing fast is not a loss: a channel
 * skipped this tick is asked again in thirty seconds, and layer 4 covers a
 * channel skipped for long enough to matter.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
/**
 * Channels looked at per tick. The lookups are sequential, so this is also the
 * bound on how long a tick can run when the SFU is slow rather than dead.
 * Slice 2 allows one voice channel per group and only *live* ones are asked
 * about, so the real number is small.
 */
const DEFAULT_CHANNEL_LIMIT = 64;
/** The admin token is minted, used within the same tick, and thrown away. */
const ADMIN_TOKEN_TTL_SECONDS = 60;
/** The room name is derived from the channel id, here and in the gateway, never taken from a client. */
const ROOM_PREFIX = "vc_";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface LiveKitCredentials {
  base: string;
  apiKey: string;
  apiSecret: string;
}

interface LiveChannel {
  id: string;
}

/** What one minted token is allowed to do. Scoped as narrowly as each call needs. */
interface TokenGrants {
  room?: string;
  roomAdmin?: boolean;
  roomList?: boolean;
}

export interface VoiceReconcilerTickOptions {
  /** A seam, so a test can pin the reap and purge thresholds it asserts on. */
  now?: () => Date;
}

let started = false;
/**
 * So a database that has not had the migration yet, or a LiveKit that has not
 * been configured yet, says so once rather than once every thirty seconds. The
 * worker and the migration deploy separately, in either order.
 */
const warnedOnce = new Set<string>();

export function startVoiceReconciler(): void {
  if (started) return;
  if (process.env["VOICE_RECONCILER_ENABLED"] === "0") {
    logger.info("voiceReconciler disabled by VOICE_RECONCILER_ENABLED=0");
    return;
  }

  const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
  const serviceKey =
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? process.env["SELFHOST_SERVICE_ROLE_KEY"];
  if (!url || !serviceKey) {
    logger.warn("voiceReconciler disabled: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
    return;
  }

  // A worker with no way to ask the SFU anything must not run its reaper
  // either: without a single confirmation it would delete every participant row
  // five minutes after start-up, which is the failure this whole file exists to
  // prevent, reached by a different door. So it sleeps rather than half-runs.
  if (!livekitCredentials()) {
    logger.warn("voiceReconciler disabled: LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET missing");
    return;
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  started = true;
  logger.info({ tickMs: tickEveryMs() }, "voiceReconciler started");
  void loop(supabase);
}

async function loop(supabase: SupabaseClient): Promise<void> {
  const tickMs = tickEveryMs();
  while (true) {
    try {
      await tick(supabase, {});
    } catch (err) {
      logger.error({ err: safeFailure(err) }, "voiceReconciler tick failed");
    }
    // Sleeping after the tick rather than on a fixed schedule, so two ticks can
    // never overlap and race each other's `replace` for the same channel.
    await sleep(tickMs);
  }
}

/**
 * One pass, exported with an explicit options argument so a test can drive the
 * real body rather than a paraphrase of it.
 *
 * The contract worth testing is not any single helper: it is what the tick does
 * and does *not* write when LiveKit answers, when LiveKit fails, and when a
 * room has genuinely emptied. Only the whole body holds that.
 */
export async function runVoiceReconcilerTick(
  supabase: SupabaseClient,
  options: VoiceReconcilerTickOptions = {},
): Promise<void> {
  await tick(supabase, options);
}

async function tick(
  supabase: SupabaseClient,
  options: VoiceReconcilerTickOptions,
): Promise<void> {
  const now = options.now ?? (() => new Date());
  const credentials = livekitCredentials();
  if (!credentials) {
    warnOnce("livekit-config", "voiceReconciler has no LiveKit credentials; nothing was reconciled");
    return;
  }

  const channels = await channelsToReconcile(supabase, credentials);
  let reconciled = 0;
  let unknown = 0;

  for (const channelId of channels) {
    const identities = await listRoomParticipants(credentials, channelId);
    if (identities === null) {
      // "I do not know." Not a write, not a guess, not an empty set.
      unknown += 1;
      continue;
    }
    const wrote = await replaceParticipants(
      supabase,
      channelId,
      identities,
      now().toISOString(),
    );
    if (wrote) reconciled += 1;
  }

  // The same rule applied to layer 4. A reap is a write, and a reap driven by
  // rows that went unconfirmed only because this worker could not reach the SFU
  // is the same mistake as writing an empty set -- it just takes five minutes
  // instead of thirty seconds. So: if there was something to ask about and
  // every single question failed, this tick learned nothing and deletes
  // nothing. One room answering is enough to prove the SFU is reachable and
  // that the failures are per-room, which is a fact worth acting on.
  const blind = unknown > 0 && reconciled === 0;
  const reaped = blind ? null : await reapStaleParticipants(supabase, now());
  if (blind) {
    warnOnce(
      "livekit-blind",
      "voiceReconciler could not reach LiveKit for any live channel; nothing written, nothing reaped",
    );
  }

  // Unrelated to the SFU, so they run whatever LiveKit said.
  await purgeWebhookEvents(supabase, now());
  await pruneRateLimitSignals(supabase, now());

  if (reconciled > 0 || unknown > 0 || (reaped ?? 0) > 0) {
    logger.info({ reconciled, unknown, reaped }, "voiceReconciler pass");
  }
}

/**
 * Every channel that has a live room, asked of both sides.
 *
 * Section 3.6 describes the sweep as "every channel the table believes is
 * non-empty", and taken alone that makes layer 3 inherit layer 2's failure
 * instead of covering it: if the `room_started` and the first `participant_joined`
 * webhook are both lost -- which is one outage, not two coincidences, since
 * they travel the same path to the same endpoint -- the table believes nothing
 * about that channel, so nothing ever asks about it, and a real call stays
 * invisible to everyone outside it for its whole duration. Slice 2's own gate
 * forces exactly that outage ("the webhook endpoint deliberately returning
 * 500").
 *
 * So the SFU is asked which rooms it actually has, and the two sets are unioned.
 * That is also what `roomList` in the admin token is for. `ListRooms` failing is
 * not fatal: the table's own set is still swept, which is the degraded case
 * section 3.6 describes rather than a new one.
 */
async function channelsToReconcile(
  supabase: SupabaseClient,
  credentials: LiveKitCredentials,
): Promise<string[]> {
  const believed = await loadLiveChannels(supabase);
  const channels = new Set(believed.map((row) => row.id.toLowerCase()));
  const observed = await listActiveRoomChannels(credentials);
  if (observed) for (const id of observed) channels.add(id);
  return [...channels].slice(0, channelLimit());
}

/**
 * The channels the table believes have somebody in them, plus the ones a
 * `room_started` webhook marked active.
 *
 * Both halves are needed, and the union is what makes a dropped webhook
 * survivable in either direction. `participant_count` is recomputed from
 * `voice_participants` by every RPC that touches it, so it cannot drift: any
 * channel holding a row is necessarily in this set, which is what lets the
 * reaper below be a residue sweep rather than a second scan.
 */
async function loadLiveChannels(supabase: SupabaseClient): Promise<LiveChannel[]> {
  const { data, error } = await supabase
    .from("voice_channels")
    .select("id")
    .or("participant_count.gt.0,active_since.not.is.null")
    .order("id", { ascending: true })
    .limit(channelLimit());
  if (error) {
    warnOnce(
      "voice-channels-read",
      "voiceReconciler cannot read voice_channels; the migration may not be applied yet",
      error,
    );
    return [];
  }
  return ((data ?? []) as LiveChannel[]).filter((row) => typeof row.id === "string" && row.id);
}

/**
 * The complete membership of one room, or `null` for "I do not know".
 *
 * `null` is returned for every failure without exception: a refused connection,
 * a timeout, any non-2xx status (a twirp `not_found` included -- a room LiveKit
 * cannot name is a room this worker will not clear; layer 4's reaper is what
 * covers that residue, which is exactly the job section 3.6 gives it), a body
 * that is not JSON, and a `participants` field that is present but not a list.
 *
 * An empty room reads as an empty list, not as unknown. LiveKit 1.8.4 was
 * measured on the probe answering `{"participants":[]}` for a room with nobody
 * in it -- it does *not* omit the field, as was assumed when this was written.
 * The absent case is still accepted, because a proto3 JSON encoder is permitted
 * to drop an empty repeated field and a later version may; reading either shape
 * as unknown would mean an emptied room was never cleared.
 */
async function listRoomParticipants(
  credentials: LiveKitCredentials,
  channelId: string,
): Promise<string[] | null> {
  const room = ROOM_PREFIX + channelId;
  const payload = await twirpCall(
    credentials,
    "ListParticipants",
    { room },
    // LiveKit's admin check compares the token's own `room` claim against the
    // room being administered, so a single unscoped admin token lists nothing.
    { room, roomAdmin: true, roomList: true },
    { channelId },
  );
  if (!payload) return null;

  const raw = payload.participants;
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    logger.warn({ channelId }, "voiceReconciler got an unrecognised participant list");
    return null;
  }

  const identities = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const participant = entry as { identity?: unknown; state?: unknown };
    // A participant LiveKit has already declared gone is not in the room; it
    // lingers in the list for a moment after the connection dies.
    if (participant.state === "DISCONNECTED") continue;
    const identity = participant.identity;
    // Identity is the Supabase user id. Anything else -- a load-test bot, an
    // egress recorder, a future ingress -- is not a person and must never reach
    // a `uuid[]` parameter, where one bad element would fail the whole set.
    if (typeof identity === "string" && UUID_PATTERN.test(identity)) {
      identities.add(identity.toLowerCase());
    }
  }
  return [...identities];
}

/**
 * The channels the SFU actually has rooms for, or `null` for "I do not know".
 *
 * Room names are derived from channel ids and never taken from a client, so the
 * mapping back is exact: anything not `vc_<uuid>` belongs to something else and
 * is ignored rather than guessed at.
 */
async function listActiveRoomChannels(
  credentials: LiveKitCredentials,
): Promise<string[] | null> {
  const payload = await twirpCall(credentials, "ListRooms", {}, { roomList: true }, {});
  if (!payload) return null;

  const raw = payload.rooms;
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    logger.warn("voiceReconciler got an unrecognised room list");
    return null;
  }

  const channels: string[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const name = (entry as { name?: unknown }).name;
    if (typeof name !== "string" || !name.startsWith(ROOM_PREFIX)) continue;
    const channelId = name.slice(ROOM_PREFIX.length).toLowerCase();
    if (UUID_PATTERN.test(channelId)) channels.push(channelId);
  }
  return channels;
}

/**
 * One twirp call, and the whole of this worker's "I do not know" rule.
 *
 * `null` is returned for every failure without exception: a refused connection,
 * a timeout, any non-2xx status (a twirp `not_found` included -- a room LiveKit
 * cannot name is a room this worker will not clear; layer 4's reaper is what
 * covers that residue, which is exactly the job section 3.6 gives it), and a
 * body that is not a JSON object.
 *
 * Only the fields read from the result matter for compatibility, and they were
 * chosen to be casing-invariant: `participants`, `rooms`, `identity`, `state`
 * and `name` are single words, so a twirp server emitting proto3 lowerCamelCase
 * and one emitting original snake_case field names agree on all of them.
 */
async function twirpCall(
  credentials: LiveKitCredentials,
  method: string,
  payload: Record<string, unknown>,
  grants: TokenGrants,
  context: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  let response: Response;
  try {
    response = await fetch(`${credentials.base}/twirp/livekit.RoomService/${method}`, {
      method: "POST",
      headers: {
        // Minted for this call, used in this call, never logged or stored.
        authorization: `Bearer ${mintAdminToken(credentials, grants)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(requestTimeoutMs()),
    });
  } catch (err) {
    logger.warn({ ...context, method, err: safeFailure(err) }, "voiceReconciler could not reach LiveKit");
    return null;
  }

  if (!response.ok) {
    logger.warn({ ...context, method, status: response.status }, "voiceReconciler got a refusal from LiveKit");
    return null;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    logger.warn({ ...context, method }, "voiceReconciler could not parse a LiveKit response");
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    logger.warn({ ...context, method }, "voiceReconciler got an unrecognised LiveKit response");
    return null;
  }
  return body as Record<string, unknown>;
}

/** The whole membership in one statement. Never a diff. */
async function replaceParticipants(
  supabase: SupabaseClient,
  channelId: string,
  userIds: string[],
  observedAt: string,
): Promise<boolean> {
  const { error } = await supabase.rpc("voice_participants_replace", {
    p_channel_id: channelId,
    p_user_ids: userIds,
    p_observed_at: observedAt,
  });
  if (error) {
    warnOnce(
      "voice-participants-replace",
      "voiceReconciler cannot write the participant set",
      error,
    );
    return false;
  }
  return true;
}

/**
 * Layer 4: the residue. A channel whose room LiveKit no longer lists at all, or
 * a row written during a window this worker was down for.
 */
async function reapStaleParticipants(supabase: SupabaseClient, now: Date): Promise<number> {
  const olderThan = new Date(now.getTime() - staleMs()).toISOString();
  const { data, error } = await supabase.rpc("voice_participants_reap", {
    p_older_than: olderThan,
  });
  if (error) {
    warnOnce("voice-participants-reap", "voiceReconciler cannot reap stale participants", error);
    return 0;
  }
  return typeof data === "number" && Number.isSafeInteger(data) && data > 0 ? data : 0;
}

/**
 * `private.voice_webhook_events` holds one row per webhook the gateway has
 * already acted on, so a redelivery is dropped rather than replayed. A key is
 * worthless once no delivery can still carry it, and the table is nobody's
 * business but the worker's -- `private` is not exposed through PostgREST, so
 * this is an RPC and not a DELETE.
 */
async function purgeWebhookEvents(supabase: SupabaseClient, now: Date): Promise<void> {
  const olderThan = new Date(now.getTime() - webhookRetentionMs()).toISOString();
  const { error } = await supabase.rpc("voice_webhook_events_purge", {
    p_older_than: olderThan,
  });
  if (error) {
    warnOnce("voice-webhook-purge", "voiceReconciler cannot purge webhook events", error);
  }
}

/**
 * `private.voice_rate_limit_signals` holds one row per voice action the gateway
 * allowed, so its rate limit binds the deployment instead of one Edge Function
 * isolate. A signal is worthless once it has aged out of the gateway's window,
 * and this is the retention sweep the migration's own comment names -- the
 * `support_email_retention_cleanup` arrangement, and the same shape as the
 * purge above, in the same place for the same reason: it is unrelated to the
 * SFU, so it runs whatever LiveKit said this tick.
 *
 * The table cannot grow large even if this never ran: the gateway records
 * nothing for a refusal, so the bound is (limit x callers) per window rather
 * than anything proportional to an attack rate. So a failure here is a warning
 * and not an escalation, exactly like the purge.
 */
async function pruneRateLimitSignals(supabase: SupabaseClient, now: Date): Promise<void> {
  const olderThan = new Date(now.getTime() - RATE_LIMIT_RETENTION_MS).toISOString();
  const { error } = await supabase.rpc("voice_rate_limit_prune", {
    p_older_than: olderThan,
  });
  if (error) {
    warnOnce("voice-rate-limit-prune", "voiceReconciler cannot prune voice rate limit signals", error);
  }
}

/**
 * An HS256 JWT carrying exactly the grants one call needs.
 *
 * LiveKit checks the two differently: `ListRooms` wants `roomList` and is not
 * room-scoped, while `ListParticipants` compares the token's own `room` claim
 * against the room being administered -- so an "admin token" that names no room
 * can list the rooms but read none of them. Passing the grants in rather than
 * assuming one shape is what keeps both calls working.
 *
 * The token is a bearer credential for the whole SFU: it is built here, put in
 * one header, and never logged, never returned, never stored.
 */
function mintAdminToken(credentials: LiveKitCredentials, grants: TokenGrants): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: credentials.apiKey,
      sub: credentials.apiKey,
      nbf: issuedAt - 10,
      exp: issuedAt + ADMIN_TOKEN_TTL_SECONDS,
      video: { ...grants },
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = createHmac("sha256", credentials.apiSecret)
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

/**
 * The credentials, or null when any of the three is absent.
 *
 * Two URLs, not one, because in this deployment they are genuinely different
 * things. `LIVEKIT_URL` is the signalling URL a *browser* dials, and here that
 * is a path on a shared hostname (`wss://api.letscube.ru/voice`) so the SFU
 * needs no DNS record and no certificate of its own. `LIVEKIT_API_URL` is where
 * *this process* reaches the twirp API, which is the container on the internal
 * network -- so the administrative API is never published to the internet at
 * all.
 *
 * Deriving one from the other is what the first draft did, and it is wrong in
 * exactly this arrangement: `new URL(...).origin` drops the path, so a twirp
 * call built from the public URL would land on whatever else answers for that
 * hostname. `LIVEKIT_API_URL` therefore wins when it is set, and `LIVEKIT_URL`
 * is the fallback for a deployment where the SFU does own its hostname.
 */
function livekitCredentials(): LiveKitCredentials | null {
  const apiUrl = process.env["LIVEKIT_API_URL"]?.trim();
  const rawUrl = apiUrl || process.env["LIVEKIT_URL"]?.trim();
  const apiKey = process.env["LIVEKIT_API_KEY"]?.trim();
  const apiSecret = process.env["LIVEKIT_API_SECRET"]?.trim();
  if (!rawUrl || !apiKey || !apiSecret) return null;

  const base = httpBase(rawUrl);
  if (!base) return null;
  return { base, apiKey, apiSecret };
}

/**
 * The base every twirp path is appended to. The **path is kept**: an SFU behind
 * a path prefix answers at `<origin><prefix>/twirp/...`, and `origin` alone
 * would silently address a different service.
 */
function httpBase(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol === "ws:") parsed.protocol = "http:";
  else if (parsed.protocol === "wss:") parsed.protocol = "https:";
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const path = parsed.pathname.replace(/\/+$/, "");
  return parsed.origin + path;
}

function warnOnce(key: string, message: string, err?: unknown): void {
  if (warnedOnce.has(key)) return;
  warnedOnce.add(key);
  logger.warn({ err: err === undefined ? undefined : safeFailure(err) }, message);
}

/** A code and a message, never a token, a key or a row. */
function safeFailure(err: unknown): { code?: string; message?: string } {
  if (!err || typeof err !== "object") return { message: typeof err === "string" ? err : "unknown" };
  const candidate = err as { code?: unknown; message?: unknown; name?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code : undefined;
  const name = typeof candidate.name === "string" ? candidate.name : undefined;
  const message = typeof candidate.message === "string" ? candidate.message.slice(0, 200) : undefined;
  return { code: code ?? name, message };
}

function tickEveryMs(): number {
  return positiveInteger(process.env["VOICE_RECONCILER_TICK_MS"], DEFAULT_TICK_MS);
}

function staleMs(): number {
  return positiveInteger(process.env["VOICE_RECONCILER_STALE_MS"], DEFAULT_STALE_MS);
}

function webhookRetentionMs(): number {
  return positiveInteger(
    process.env["VOICE_WEBHOOK_RETENTION_MS"],
    DEFAULT_WEBHOOK_RETENTION_MS,
  );
}

function requestTimeoutMs(): number {
  return positiveInteger(
    process.env["VOICE_RECONCILER_REQUEST_TIMEOUT_MS"],
    DEFAULT_REQUEST_TIMEOUT_MS,
  );
}

function channelLimit(): number {
  return positiveInteger(process.env["VOICE_RECONCILER_CHANNEL_LIMIT"], DEFAULT_CHANNEL_LIMIT);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
