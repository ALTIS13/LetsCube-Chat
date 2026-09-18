/**
 * How loud one other person is, for this listener alone.
 *
 * Discord's per-user volume. It is **not** moderation and must never be built
 * on moderation's rules: nobody else is told, nothing is written to a table,
 * the person turned down learns nothing, and every participant may do it to
 * every other participant. The gate is therefore a different gate —
 * `voiceModeration.ts` asks whether the reader is an owner or an administrator,
 * and this module never asks that at all.
 *
 * Free of React and of every browser API, so `node --test` reads it directly
 * and `tests/unit/voice-volume.test.mjs` holds every decision below. The two
 * things that are not decisions — reading the string out of `localStorage` and
 * pushing a value into the live room — live in `hooks/useVoiceVolume.ts` and in
 * the seam, and both of them ask this file what the answer is.
 *
 * ## The range is 0..1, and that is a measurement rather than a preference
 *
 * Discord's slider goes to 200%. This one cannot, and the reason is two files
 * down in the SDK: `createLiveKitRoom` builds its `Room` without `webAudioMix`,
 * whose default is `false` (livekit-client 2.22.3, `room/defaults.ts`), so
 * there is no `AudioContext` and no `GainNode` in the path.
 * `RemoteAudioTrack.setVolume` then falls to `el.volume = volume` on each
 * attached element — and `HTMLMediaElement.volume` throws `IndexSizeError`
 * outside 0..1, the same fact `lib/playbackVolume.ts` records for the media
 * player. A value above 1 would therefore not be «louder», it would be an
 * exception thrown in the middle of the loop that applies everybody's volume,
 * taking the deafen re-application down with it.
 *
 * Turning that into 0..200% means turning `webAudioMix` on, which routes the
 * whole call through an `AudioContext` — a suspended context on a page with no
 * gesture yet is a call with no sound at all, and `Room.switchActiveDevice`
 * takes a different branch for the output device under it. That is a change to
 * how the call is heard, not a slider's maximum, and it does not belong in this
 * one.
 *
 * ## What stands in for «is this person in my room»
 *
 * Nothing, on purpose: `voiceVolumeOffer` reads how the room carries their
 * voice, and that reading only exists for the room this client is receiving
 * audio from. A channel-id comparison beside it was redundant **and** less
 * accurate — the note on that function records the mutation that showed it.
 *
 * ## The scope is the person, not the person in this room
 *
 * A volume is chosen because of somebody's microphone, their room, or how they
 * hold their headset — facts about **them**, which follow them from one channel
 * to the next. Keying by room would make a listener redo the same correction in
 * every channel they meet that person in, and would leave a stale entry behind
 * in every room they left. So one value per user id, and it applies wherever
 * they are met.
 */

/**
 * How the room carries one participant's voice, as the SFU reports it.
 *
 * A reading, not a verdict — the verdict is `voiceVolumeOffer` below. Mirrors
 * `VoiceParticipant.audioSource` in `voiceChannel.ts`, which is where the
 * participant shape lives; the component hands one straight to this module, so
 * a value added on that side and not handled here fails the typecheck at the
 * call site rather than silently defaulting.
 */
export type VoiceAudioSource =
  /**
   * Their microphone is on the air **as a microphone**, so a chosen loudness
   * lands: `RemoteParticipant.setVolume` looks up
   * `getTrackPublication(Track.Source.Microphone)`, and this is the state in
   * which that lookup finds something.
   */
  | "microphone"
  /**
   * They are publishing audio the room does not call a microphone.
   *
   * Every build before 2026-09-18 published its capture with
   * `Track.Source.Unknown` — a hand-built `LocalAudioTrack` carries that and
   * `publishTrack` overwrites it only from `opts.source` — so the Android
   * 0.1.7 APK and any browser tab still running the previous bundle arrive in
   * this state. `setVolume` finds no publication for them, stores the value in
   * its own map and returns having changed nothing at all. This is the reading
   * the interface must not paper over.
   */
  | "unnamed"
  /**
   * They carry no audio yet: a listener the gateway refused publication to, or
   * somebody whose track has not arrived.
   *
   * Not a refusal. The SDK keeps a chosen volume per participant and applies it
   * when a microphone track is subscribed (`addSubscribedMediaTrack` reads its
   * own `volumeMap`), so a value chosen now is not lost — it simply has nothing
   * to act on this second.
   */
  | "none";

/** What the interface may do about one person's loudness. */
export type VoiceVolumeOffer =
  /** Draw the slider. */
  | "adjustable"
  /** Draw it sunk, and say why: nothing this listener chooses can reach them. */
  | "unreachable"
  /** Draw nothing. */
  | "not_offered";

export const VOICE_VOLUME_STORAGE_KEY = "kub:voice-volume:v1";
/** What `hooks/useVoiceVolume.ts` dispatches so every open slider agrees. */
export const VOICE_VOLUME_EVENT = "kub:voice-volume-change";
export const DEFAULT_VOICE_VOLUME = 1;
/** Twenty stops under a keyboard's arrow keys, which is finer than a finger needs. */
export const VOICE_VOLUME_STEP = 0.05;

/**
 * A stored number, or null where there is none.
 *
 * `Number()` alone will not do, for the reason `lib/playbackVolume.ts` states:
 * it reads `null` and `""` as zero, and zero is a volume — silence — so a key
 * nobody ever wrote would arrive as somebody having muted a person.
 */
function storedNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** 0..1, because above 1 the element's own volume setter throws. See the header. */
export function normalizeVoiceVolume(value: unknown): number {
  const volume = storedNumber(value);
  if (volume === null) return DEFAULT_VOICE_VOLUME;
  if (volume < 0) return 0;
  if (volume > 1) return 1;
  return volume;
}

function parseObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // Storage can hold anything, including half of something. Defaults apply.
    return null;
  }
}

/**
 * Every loudness this listener has chosen, by user id.
 *
 * Takes the raw string rather than reading storage itself, which is
 * `readStoredPlayback`'s arrangement and for the same reason: the decision is
 * then testable and the browser call has exactly one home.
 *
 * An entry that normalizes to the default is dropped rather than kept, so a
 * record read back is only the people who were actually turned down — the same
 * shape `voiceVolumesAfter` writes.
 */
export function readStoredVoiceVolumes(raw: string | null | undefined): Map<string, number> {
  const chosen = new Map<string, number>();
  const stored = parseObject(raw);
  if (!stored) return chosen;
  for (const [userId, value] of Object.entries(stored)) {
    if (!userId.trim()) continue;
    const number = storedNumber(value);
    if (number === null) continue;
    const volume = normalizeVoiceVolume(number);
    if (volume === DEFAULT_VOICE_VOLUME) continue;
    chosen.set(userId, volume);
  }
  return chosen;
}

/**
 * The record to store after one person's loudness is chosen.
 *
 * A value back at the default **removes** the entry instead of writing 1. Both
 * read the same afterwards, and the difference is that this record does not
 * grow by one line for every person a listener ever touched and put back.
 */
export function voiceVolumesAfter(
  raw: string | null | undefined,
  userId: string,
  volume: number,
): Record<string, number> {
  const chosen = readStoredVoiceVolumes(raw);
  const next = normalizeVoiceVolume(volume);
  if (next === DEFAULT_VOICE_VOLUME) chosen.delete(userId);
  else chosen.set(userId, next);
  return Object.fromEntries(chosen);
}

/** One person's chosen loudness, or the default for somebody never touched. */
export function chosenVoiceVolume(
  chosen: ReadonlyMap<string, number> | undefined,
  userId: string | null,
): number {
  if (!chosen || !userId) return DEFAULT_VOICE_VOLUME;
  const volume = chosen.get(userId);
  return volume === undefined ? DEFAULT_VOICE_VOLUME : normalizeVoiceVolume(volume);
}

/**
 * The number beside the slider.
 *
 * Zero gets a word rather than «0%»: it is a per-person silence, which is what
 * a listener reaches for the slider to do, and a row of zeroes reads as a
 * control that has lost its value rather than as somebody deliberately muted.
 */
export function voiceVolumeLabel(volume: number): string {
  const normalized = normalizeVoiceVolume(volume);
  if (normalized === 0) return "Выключен";
  return `${Math.round(normalized * 100)}%`;
}

/** One occupant, as much of them as this decision reads. */
export interface VoiceVolumeTarget {
  readonly userId: string;
  /** `VoiceParticipant.audioSource`: `null` when nobody here knows. */
  readonly audioSource: VoiceAudioSource | null;
}

/**
 * Whether this listener may set how loud one participant is, and what to draw.
 *
 * Two refusals, and they are not one:
 *
 *  - **Yourself.** Your own voice is not carried back to you, so the control
 *    would have nothing to act on; the slider that changes how loud *you* are
 *    to others is a microphone gain and lives in the sound settings.
 *  - **`audioSource === null`,** which is «nobody here knows». Never read as a
 *    refusal about the person; it is a statement about the reader's own
 *    information, the same rule `canSpeak` follows.
 *
 * **There is deliberately no «am I in this room» parameter,** and that is a
 * correction rather than an omission. The first version took one, the rail
 * passed `callChannelId === channel.id`, and a mutation setting it to `true`
 * left every test green — so it was either redundant or unreachable. It was
 * redundant, and it was also the *less* accurate of the two questions.
 * `ChatWindow.occupantsOf` hands the rail the SDK's roster for the room this
 * client is connected to **and only while the phase is connected or
 * reconnecting**; every other row, and that room during a join, comes from
 * `voice_participants`, where `audioSource` is `null` because a table knows
 * nothing about publications. So the reading already answers «is this somebody
 * whose audio I am actually receiving», which is the question `setVolume` cares
 * about, while a channel-id comparison would have answered yes during a join
 * that has not connected yet.
 *
 * `unreachable` is the answer that had to be invented rather than borrowed:
 * their audio is on the air under no name the SFU calls a microphone, so
 * `setVolume` will find nothing for them however many times it is called. The
 * interface says so — see `voiceVolumeNotice` — instead of offering a slider
 * that moves and does nothing.
 */
export function voiceVolumeOffer(input: {
  readonly selfId: string | null;
  readonly target: VoiceVolumeTarget;
}): VoiceVolumeOffer {
  // An unknown reader cannot be told apart from the target, and «I am not sure
  // whether this is you» must fail closed here as it does in `voiceModeration`.
  if (!input.selfId) return "not_offered";
  if (input.selfId === input.target.userId) return "not_offered";
  if (input.target.audioSource === "unnamed") return "unreachable";
  if (input.target.audioSource === "microphone" || input.target.audioSource === "none") {
    return "adjustable";
  }
  // `null`, and anything a future build reports that this one has not been
  // taught. Named readings only, and the rest fails closed — the rule
  // `MODERATABLE_ROLES` follows in `voiceModeration.ts`, for the same reason:
  // the type makes an unknown value impossible today and will not tomorrow, and
  // the wrong way to fail is by offering a control.
  //
  // It is not hypothetical. A stand-in transport that reports a roster without
  // this field hands `undefined` to this function, and a version that asked
  // `=== null` read that as a reading and offered the slider.
  return "not_offered";
}

/**
 * The sentence under the slider, or null when there is nothing to say.
 *
 * Both cases are «this control will not do what it looks like it does right
 * now», which is the only thing worth a line of prose in a menu this small.
 * The unreachable one wins: it is about the person and permanent for the length
 * of their session, where deafening is this listener's own and one press away
 * from being over.
 */
export function voiceVolumeNotice(offer: VoiceVolumeOffer, deafened: boolean): string | null {
  if (offer === "unreachable") {
    // Not «Громкость недоступна…», which was the first wording: it stands
    // directly under the word «Громкость», and photographed at 390 the
    // repetition read as a stutter rather than as an explanation.
    return "Изменить нельзя: участник подключился из старой версии приложения.";
  }
  if (offer === "adjustable" && deafened) {
    return "Вы не слушаете канал — громкость применится, когда включите звук.";
  }
  return null;
}

/**
 * Whether pressing this occupant's row opens anything at all.
 *
 * A row that opens an empty menu is the same defect as a control that does
 * nothing, so the row is not a button when the answer is no — which is why this
 * is one decision in one place rather than a condition written twice, once on
 * the row and once on the menu. `unreachable` counts as something: the surface
 * then carries the sentence that explains it, and a reader who can see why is
 * better off than one whose row simply does not respond.
 */
export function occupantMenuOffersSomething(
  volume: VoiceVolumeOffer,
  moderationActionCount: number,
): boolean {
  return volume !== "not_offered" || moderationActionCount > 0;
}
