/**
 * Coming back to the voice channel you were in, and the rule for when.
 *
 * ## What the owner asked for, and the boundary that falls out of it
 *
 * «Даже в случае обрыва от канала я гарантировано вернусь в него по возврату
 * связи в течении 5 минут, также с обновлениями которые в случае если
 * происходят насильно то возвращают сразу в голосовой где я и был.»
 *
 * He named **two** cases and only two: a connection drop, and an update applied
 * to him without his asking. Both are interruptions the product caused. He did
 * not ask to be put back into a voice channel after pressing F5 himself — and a
 * person who reloads deliberately has made a choice the product should not
 * quietly undo.
 *
 * So the split here is not a compromise between his request and the risk of
 * switching a microphone on unasked; it is **the shape of the request**, and
 * the offer path covers only what he never mentioned. That matters, because a
 * rule that merely happens to match a request is weaker than one derived from
 * it: the first has to be re-argued every time somebody asks «why not always?»,
 * and the second answers by quoting the sentence.
 *
 * The risk is real as well. Returning somebody unmuted into a room they did not
 * choose to rejoin publishes a room nobody agreed to, and switching on a
 * microphone without saying so is D-281 with a larger blast radius. Hence: the
 * microphone's state travels in the record, and a return is only ever silent,
 * never invisible — `VoiceCallShell` wraps every authenticated route, so the
 * call bar is on screen wherever a return can happen.
 *
 * ## Five minutes is ours, and it is one relationship rather than two numbers
 *
 * Measured read-only against production on 2026-09-20 and written up in
 * `docs/operations/voice.md` under «Coming back after a drop»: **LiveKit
 * retains no participant at all.** There is no server-side window, so nothing
 * could have made five minutes a lie — and nothing hands us a number either.
 * The window is a product decision.
 *
 * It has to equal the reconciler's `DEFAULT_STALE_MS`
 * (`artifacts/api-server/src/workers/voiceReconciler.ts`), which decides how
 * long *everybody else* still sees the person in the channel. Longer here and
 * somebody returns to a channel whose row was already reaped, so nobody outside
 * the call can see them; shorter and the row outlives their intention to
 * return, which is the ghost that reaper exists to remove. The two constants
 * live in different deployables and cannot be one; each names the other.
 *
 * And one thing a user-facing sentence must never imply: this is a promise
 * about **our** behaviour, not about what the server holds. «Вернём вас в канал,
 * если связь появится в течение пяти минут» is safe; anything phrased as a
 * server guarantee is not, because `departure_timeout`'s default in
 * `livekit-server` v1.13.7 is recorded as *not established*.
 *
 * ## A return is «join again», not «reconnect»
 *
 * `empty_timeout: 60` with `auto_create: false`: somebody who was alone loses
 * the room a minute after dropping, and no client token can bring it back. The
 * return therefore goes through the ordinary join path, whose `CreateRoom` is
 * idempotent — so nothing here may assume a live room to reattach to.
 *
 * Free of React and of every browser API, so `node --test` reads it directly.
 */

/** How long a return stays available. The reconciler's reaper is the same span. */
export const VOICE_RESUME_WINDOW_MS = 5 * 60 * 1000;

/**
 * How often the record's timestamp is refreshed while the call is up.
 *
 * A minute, which is also what Discord's `SelectedChannelStore` uses for the
 * same job. It bounds how stale the stored time can be when the page dies
 * without warning: a drop is at most this much older than it looks, so the
 * effective window is between four and five minutes rather than exactly five.
 * Stated rather than hidden, because «five minutes» in copy has to survive
 * somebody measuring it.
 */
export const VOICE_RESUME_HEARTBEAT_MS = 60 * 1000;

/** Where the record lives. Per browser, not per tab: a crashed tab is the case. */
export const VOICE_RESUME_KEY = "letscube:voice:resume";

/**
 * Why the call ended.
 *
 * `interrupted` is stamped by the product at the moment it takes the page away
 * from somebody — today that is the update restart in `AppUpdateBanner` — and
 * by the transport when a connected call closes under it. `unplanned` is the
 * default the record is written with, and it is what survives a manual reload
 * or a crash: we do not know why the page went away, so we do not act.
 */
export type VoiceResumeCause = "interrupted" | "unplanned";

export type VoiceResumeRecord = {
  channelId: string;
  chatId: string;
  channelName: string;
  /** The microphone as it was. Somebody who dropped muted comes back muted. */
  micMuted: boolean;
  /** When the call was last known to be up. */
  at: number;
  cause: VoiceResumeCause;
};

export type VoiceResumeDecision =
  /** Nothing to return to, or too late, or not ours to decide. */
  | { kind: "none" }
  /** The product took the call away; the product puts it back. */
  | { kind: "return"; record: VoiceResumeRecord }
  /** Something else took it away; one press returns. */
  | { kind: "offer"; record: VoiceResumeRecord };

const CAUSES: readonly VoiceResumeCause[] = ["interrupted", "unplanned"];

/** A record read back from storage, or `null` for anything unusable. */
export function parseVoiceResumeRecord(raw: string | null): VoiceResumeRecord | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const { channelId, chatId, channelName, micMuted, at, cause } = record;
  if (typeof channelId !== "string" || channelId === "") return null;
  if (typeof chatId !== "string" || chatId === "") return null;
  if (typeof channelName !== "string") return null;
  if (typeof micMuted !== "boolean") return null;
  if (!Number.isSafeInteger(at) || (at as number) <= 0) return null;
  if (typeof cause !== "string" || !CAUSES.includes(cause as VoiceResumeCause)) return null;
  return {
    channelId,
    chatId,
    channelName,
    micMuted,
    at: at as number,
    cause: cause as VoiceResumeCause,
  };
}

export function serializeVoiceResumeRecord(record: VoiceResumeRecord): string {
  return JSON.stringify(record);
}

/**
 * What to do about a call this browser was in, now that a page has booted.
 *
 * The safe direction is «do nothing»: every uncertainty here resolves towards
 * not switching on a microphone. A clock that has gone backwards leaves a
 * record stamped in the future, and that is not read as «very recent» — it is
 * read as unusable, which is the opposite of how `shouldShowUpdateNotice`
 * treats the same situation and for the opposite reason.
 */
export function decideVoiceResume({
  record,
  now,
}: {
  record: VoiceResumeRecord | null;
  now: number;
}): VoiceResumeDecision {
  if (!record) return { kind: "none" };
  if (record.at > now) return { kind: "none" };
  if (now - record.at >= VOICE_RESUME_WINDOW_MS) return { kind: "none" };
  return record.cause === "interrupted" ? { kind: "return", record } : { kind: "offer", record };
}
