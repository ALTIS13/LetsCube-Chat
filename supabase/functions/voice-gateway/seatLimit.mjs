// How many people a voice channel admits, and the one number that means «as
// many as turn up».
//
// This is a separate module for the reason roomName.mjs is: the decision is
// three lines, it is the difference between a call the owner asked for and a
// cap nobody chose, and a decision buried in a request handler cannot be
// mutation-tested. Everything here is pure.
//
// ── Why 0, and not NULL ──────────────────────────────────────────────────────
//
// The owner, 2026-09-20: «изначально ограничения быть не должно». So a group
// channel needs a stored value meaning «no limit», and there were two candidate
// spellings.
//
//   * `0` keeps `voice_channels.max_participants` NOT NULL, so neither guard
//     below acquires three-valued logic, and it is **LiveKit's own spelling** —
//     `livekit.Room.max_participants` is a proto3 uint32 whose zero value the
//     SFU reads as unbounded.
//   * `NULL` was rejected because the meaning is already taken. Every client
//     type in this repository declares `maxParticipants: number | null`, where
//     null means «the row I read did not carry this column», not «unbounded».
//     Overloading it would make «not loaded yet» and «no limit» the same value
//     in the interface, which is how a rail draws ∞ for a channel it has not
//     finished reading.
//
// ── The measurement that decides how 0 reaches the SFU, and the trap in it ───
//
// Taken against the production SFU on 2026-09-20 (livekit/livekit-server
// v1.13.7), by creating throwaway rooms, reading back what the server stored
// and deleting them:
//
//     asked max_participants=0        -> the SFU stored 10
//     field omitted entirely          -> the SFU stored 10
//     asked max_participants=1        -> stored 1
//     asked max_participants=50       -> stored 50
//     asked max_participants=100000   -> stored 100000
//
// **Zero is not «unbounded» on the wire.** It is proto3's zero value, which is
// indistinguishable from an absent field, so the SFU substitutes its config
// default — `room.max_participants` in `livekit.yaml`, which was `10`. An
// explicit number above that default is *not* clamped: 50 and 100000 stood. So
// the YAML never capped our rooms, as was believed; it capped exactly one case,
// the one this change would otherwise have walked straight into. Passing 0
// through while the config still said 10 would have left every guard in this
// repository reporting «no limit» and the eleventh person still refused, by the
// SFU, with no line anywhere saying why.
//
// The fix is therefore two-sided and neither half works alone:
// `livekit.yaml` must carry `room.max_participants: 0`, and then the same
// probe against a server so configured stores 0 for a room asked for 0. That is
// measured too, on an isolated probe instance, not assumed.
//
// `VOICE_SEATS_LIVEKIT_CONFIG_MUST_BE_ZERO` below exists to make that
// dependency greppable from the code rather than only from this comment.

/** The stored value that means «no limit». LiveKit's own spelling. */
export const VOICE_SEATS_UNLIMITED = 0;

/**
 * The SFU only reads 0 as «unbounded» when its own `room.max_participants` is
 * 0, because 0 on the wire is indistinguishable from an absent field and an
 * absent field takes the config default. Deploying this module without that
 * line in `livekit.yaml` reinstates whatever the config says, silently.
 */
export const VOICE_SEATS_LIVEKIT_CONFIG_MUST_BE_ZERO = "room.max_participants: 0";

/**
 * A private chat is two people by definition. A third is a different object —
 * Discord answers this with a group DM, not with a wider DM — so this number is
 * a product definition and not a capacity value, and it is the one seat count
 * that must never be lifted to make room for somebody.
 */
export const VOICE_SEATS_PRIVATE_CHAT = 2;

/**
 * Read `voice_channels.max_participants` as it comes back from PostgREST.
 *
 * Returns `null` for anything that is not a non-negative integer, which the
 * caller must treat as «this deployment cannot tell me the limit» and refuse —
 * the same refusal the column being NOT NULL is supposed to make impossible.
 * A negative number is not folded into 0: it is a broken row, and reading it as
 * «unlimited» would turn corruption into an open door.
 */
export function readSeatLimit(raw) {
  // `Number("")`, `Number(null)` and `Number([])` are all **0**, and 0 is the
  // one value that opens the channel to everybody — so a column that came back
  // empty would have read as «no limit» rather than as «I could not read it».
  // The shape is checked before the conversion for that reason; a test caught
  // this, which is the whole argument for the module having its own tests
  // rather than only an end-to-end one.
  let limit;
  if (typeof raw === "number") {
    limit = raw;
  } else if (typeof raw === "string" && raw.trim() !== "") {
    limit = Number(raw);
  } else {
    return null;
  }
  if (!Number.isInteger(limit)) return null;
  if (limit < 0) return null;
  return limit;
}

/** Whether a seat limit means «no limit». */
export function seatsAreUnlimited(limit) {
  return limit === VOICE_SEATS_UNLIMITED;
}

/**
 * The admission decision, given the limit and the mirror's participant count.
 *
 * Unlimited skips the comparison rather than comparing against a large number:
 * a sentinel that is merely big is still a cap, and it would be the kind that
 * is discovered by somebody being refused rather than by reading this file.
 *
 * A participant count that is not a number is treated as «not known», and an
 * unknown count admits. That is the shipped behaviour and it is deliberate:
 * `participant_count` is the SFU's mirror, it lags a join by one webhook, and a
 * deployment that cannot read it must not stop taking calls. The hard
 * enforcement is the SFU's own per-room cap.
 */
export function voiceChannelIsFull({ limit, participantCount }) {
  if (limit === null) return false;
  if (seatsAreUnlimited(limit)) return false;
  const count = Number(participantCount);
  if (!Number.isFinite(count)) return false;
  return count >= limit;
}

/**
 * What to put in the `CreateRoom` body. Passed through unchanged, including 0 —
 * see the measurement above for why that is only correct alongside
 * `room.max_participants: 0` in `livekit.yaml`.
 */
export function liveKitMaxParticipants(limit) {
  return limit;
}
