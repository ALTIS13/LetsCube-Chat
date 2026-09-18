// Whether this deployment will serve voice at all, and how much of it.
//
// Slice 5's three remaining server-side items
// (`docs/proposals/2026-09-13-voice-channels.md:1162-1176`), as pure functions,
// for the same reason everything else that *decides* something in this gateway
// is a `.mjs` module: `index.ts` is Deno and its transport cannot be unit
// tested, while these can be driven with every value a deployment might hold.
//
// **The kill switch follows `BOT_CREATION_ENABLED` rather than inventing a
// second mechanism.** `artifacts/api-server/src/bot/managementRoutes.ts:74-83`
// is the whole of that pattern: one pure function, the environment passed in as
// an object, `"false"` closes the feature, absent and `""` and `"true"` all
// leave it open, and anything else is a configuration error rather than an
// implicit «on» — so a typo cannot quietly open the feature.
//
// One thing is deliberately different, and it is a difference of venue rather
// than of policy. The bot gateway is a long-lived Node process, so it resolves
// admission once at construction and an unrecognised value stops it booting
// (`botGatewayIndex.ts:90`). An Edge Function has no boot to fail: it reads its
// environment per request. So an unrecognised value here refuses the request
// with `not_configured` — the code this gateway already sends when its
// environment is unusable — which the client maps onto the same
// «Голосовые чаты сейчас отключены.» that a deliberate `false` produces, while
// still being distinguishable from it on the wire for whoever is probing the
// route. Loud in the only way an environment read per request can be: never
// «on».
//
// What the switch does and does not reach is worth stating here rather than
// leaving to be inferred:
//
//   * it gates `/token`, so nobody can start or re-join a call;
//   * it does **not** gate `/webhook`, because refusing those would strand
//     `participant_left` and `room_finished` and leave the mirror showing calls
//     that have ended — the interface lying rather than saying it is off;
//   * it does **not** gate `/force-mute` or `/remove`, because a call already
//     in progress drains rather than ending, and taking a moderator's levers
//     away during that drain is the opposite of what switching voice off is
//     for.

// The refusal shape is `moderationRefusal`'s in `moderation.mjs` — the wire
// code and its status together, so `index.ts` need not know which status
// belongs to which reason — and each one is written out as a literal rather
// than built by a helper. That is not style: `voice-gateway-client.test.mts`
// scans the gateway's sources for `error: "…", status: …` pairs and fails when
// the client cannot name one of them, and a helper would hide these two codes
// from the guard exactly the way the moderation refusals were hidden from it
// until 2026-09-18.

/**
 * Is voice switched on for this deployment.
 *
 * `environment` is an object, never `Deno.env` — the caller reads the name and
 * hands the value over, which is what makes this testable and is exactly how
 * `resolveBotCreationAdmission` takes it.
 */
export function readVoiceAdmission(environment) {
  const enabled = environment?.VOICE_ENABLED;
  if (enabled === "false") return { ok: false, error: "voice_disabled", status: 503 };
  if (enabled !== undefined && enabled !== null && enabled !== "" && enabled !== "true") {
    return { ok: false, error: "not_configured", status: 503 };
  }
  return { ok: true };
}

/**
 * The largest cap that is a configuration rather than a typo.
 *
 * Not a policy — the operator picks the number — but a bound that turns a
 * stray digit into a refusal instead of into a cap that can never bind. The
 * proposal's own egress table puts one room of fifty at 117.6 Mbps worst case
 * (section 2.3), so ten thousand simultaneous participants is several orders of
 * magnitude past anything this host could carry, and a value above it means
 * somebody's finger slipped. It also catches a number too large to survive
 * being parsed: `"9007199254740993"` is a safe integer once rounded and would
 * otherwise be accepted as a value it does not equal.
 */
const VOICE_CAP_CEILING = 10_000;

/**
 * How many people this deployment will carry at once, across every room.
 *
 * **The number cannot be derived, only chosen.** Section 1.6 of the proposal
 * says so in as many words: this repository records no `nproc`, no `free -h`
 * and no traffic allowance for the production host, and the "8 cores, 12 GB" in
 * the infrastructure documents are planning targets that were never a reading.
 * The arithmetic that *is* measured is the egress table in section 2.3 — worst
 * case 18.2 Mbps for one room of 20, 117.6 Mbps for one of 50 — and it is
 * per-room and quadratic, so no single participant total bounds it exactly. So
 * the code's job is to enforce whatever number the deployment sets, and the
 * number belongs in the environment beside `LIVEKIT_API_KEY`.
 *
 * Absent or empty is no cap, which is today's behaviour and cannot take voice
 * down by surprise. Anything that is not a plain positive integer is a
 * configuration error rather than «unlimited», because reading a typo as no
 * limit is the one mistake that matters here. `0` is refused too: turning voice
 * off is the kill switch's job, and a second way to do it is a second thing to
 * remember.
 */
export function readVoiceConcurrencyCap(environment) {
  const raw = environment?.VOICE_MAX_TOTAL_PARTICIPANTS;
  if (raw === undefined || raw === null || raw === "") return { ok: true, cap: null };
  const cap = typeof raw === "string" && /^[0-9]+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(cap) || cap < 1 || cap > VOICE_CAP_CEILING) {
    return { ok: false, error: "not_configured", status: 503 };
  }
  return { ok: true, cap };
}

/**
 * The limits the deployment-wide limiter asks the database to apply.
 *
 * Constants rather than environment values, and the split is deliberate: the
 * concurrency cap above depends on hardware the code cannot know, while these
 * are a statement about human behaviour that the code can reason about. Twenty
 * in sixty seconds is `moderationRateLimit.mjs`'s number and its reasoning —
 * above any hand, below any script. For a mint that reasoning is if anything
 * stronger: a join costs a microphone prompt, a `CreateRoom` and a WebRTC
 * handshake, so twenty of them in a minute is one every three seconds, which
 * nobody achieves while actually joining a call.
 *
 * The two actions keep separate allowances on purpose. A moderator clearing a
 * raid must not spend the allowance they need to rejoin the call themselves.
 */
export const VOICE_RATE_LIMITS = Object.freeze({
  token_mint: Object.freeze({ limit: 20, windowSeconds: 60 }),
  moderate: Object.freeze({ limit: 20, windowSeconds: 60 }),
});

/**
 * How long a minted token counts against the concurrency cap before the
 * participant row it should have produced is expected to exist.
 *
 * The cap is enforced against the mirror, and the mirror lags: a token is
 * minted, then LiveKit accepts the connection, then `participant_joined`
 * arrives and the row appears. Without this window a rush of simultaneous
 * joins all read the same pre-rush count and all pass, which is precisely the
 * situation the cap exists for. Thirty seconds is longer than that whole path
 * by an order of magnitude and shorter than any call; its error is
 * conservative — somebody who mints and never connects occupies a notional
 * seat for half a minute.
 */
export const VOICE_IN_FLIGHT_SECONDS = 30;

/**
 * What the database said about one caller's allowance.
 *
 * `{ allowed: false }` only when the answer positively says so. Anything else
 * — an error, a missing function because the migration has not been applied
 * here yet, a shape this code does not recognise — is `degraded`, and
 * `degraded` **allows**.
 *
 * That is a decision and not an oversight, so here is the whole of it. This
 * limiter is an abuse control, not an authorisation control: every check that
 * decides whether somebody may be in a call at all — `is_banned`, the
 * membership row, the per-channel cap — already fails closed in `index.ts`, so
 * a broken limiter cannot let an unauthorised person in. It can only let an
 * authorised member mint faster than intended, and the per-isolate limiter in
 * front of it still bounds that. Failing closed instead would convert a slow
 * table, a bloated index or an unapplied migration into a total voice outage,
 * which is a strictly worse trade for a control whose only job is to stop a
 * loop. The degradation is therefore not «no limit» but «the limit this
 * gateway had before the migration existed», and it is why the migration and
 * the function can be deployed or rolled back in either order.
 */
export function readVoiceRateLimitAnswer(data) {
  if (!data || typeof data !== "object") return { allowed: true, degraded: true };
  if (data.ok === true) return { allowed: true };
  if (data.ok !== false) return { allowed: true, degraded: true };
  const seconds = Number(data.retry_after_seconds);
  return {
    allowed: false,
    retryAfterSeconds: Number.isFinite(seconds) && seconds >= 1 ? Math.ceil(seconds) : 1,
  };
}

/**
 * How many people this deployment is carrying, as the database counts them.
 *
 * `null` is «I do not know», and the caller treats not knowing the same way
 * `readVoiceRateLimitAnswer` treats it: allow, for the same reasons. A
 * deployment that cannot count its participants must not stop taking calls.
 *
 * Two things this refuses that a plain `Number(data)` would not, and the first
 * of them was found by a mutation rather than by reading:
 *
 * **Only a number or a string is even converted.** `Number(true)` is `1`, so a
 * deployment whose RPC answered the wrong type would report one participant and
 * a cap of 1 would refuse every join. An earlier draft had a separate
 * `typeof data === "boolean"` guard in front of this for exactly that reason;
 * deleting it turned nothing red, because the conversion below never runs on a
 * boolean anyway. A line no test can distinguish is a line claiming to do
 * something it does not, so the guard is the `typeof` on the conversion itself
 * and there is only one of them.
 *
 * **An empty string is not zero.** `Number("")` is 0, and reading an empty
 * answer as «nobody is in a call» is the mistake `voiceReconciler.ts` opens
 * with in capitals: an error is not an empty room.
 */
export function readVoiceActiveParticipants(data) {
  if (typeof data === "string" && data.trim() === "") return null;
  const value = typeof data === "number" || typeof data === "string"
    ? Number(data)
    : Number.NaN;
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}
