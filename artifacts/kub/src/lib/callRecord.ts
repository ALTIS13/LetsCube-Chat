/**
 * The line a one-to-one call leaves in the conversation, as rules.
 *
 * Slice B of `docs/proposals/2026-09-18-one-to-one-calls.md`, client half. The
 * database half is
 * `supabase/migrations/20260918250000_a_call_says_so_in_the_private_chat.sql`,
 * applied and verified on production; everything here reads what that function
 * wrote and decides what each of the two readers sees.
 *
 * This module imports nothing, on purpose. The lesson is in CLAUDE.md and again
 * at the head of `lib/micGate.ts` and `lib/voiceRing.ts`: a decision inside a
 * `"use client"` module is a decision with no test, and moving the decision is
 * cheaper than building a harness around it. `tests/unit/call-record.test.mts`
 * holds all of it.
 *
 * ## The payload is untrusted, and the fallback is not a courtesy
 *
 * `messages.system_payload` is `jsonb`. Nothing a client sends can reach it —
 * the only permissive INSERT on `messages` wants `auth.uid() = user_id` and
 * `messages_sender_shape_check` forbids a `user_id` on a system row — so this
 * is not a defence against a forged payload. It is a defence against **three
 * ordinary futures**:
 *
 *  - a system row that is not a call at all. The group-call line of D-229
 *    carries `system_payload is null` and must keep rendering exactly as it
 *    does, so «not a call record» has to be the cheap, common answer;
 *  - a `kind` this bundle has never heard of, written by a deployment newer
 *    than the browser tab reading it;
 *  - a column whose shape changed under a bundle that is still running.
 *
 * In all three the answer is the same and it is already correct: **fall back to
 * `content`**, which the database wrote as a complete neutral sentence for
 * exactly this reason. So a malformed payload renders «Пропущенный звонок»
 * rather than throwing or drawing half a card — the same thing a bundle from
 * before this feature renders, which is the strongest possible statement that
 * the degradation path is exercised.
 *
 * `kind`, `outcome` and `caller` are the record's **identity**: wrong or absent,
 * and this is not a call record. `duration_ms` is a **detail**: wrong, and it is
 * dropped while the record stands, because losing the direction to save a
 * number would be the worse trade. An `answered` call with no duration is a
 * state the database itself produces — `voice_call_record_line` answers plain
 * «Звонок» for anything under a second — so there is no new shape to draw.
 *
 * ## One row, two readers
 *
 * The same row is read by both people, so no wording may come from the row. It
 * comes from comparing `caller` with whoever is reading, and that comparison is
 * the only reason the payload carries an identity at all: `user_id` is
 * forbidden on a system row, which is what §4 of the proposal means by «the one
 * field that fights the schema».
 *
 * A reader this client cannot name — the store's `currentUser` before it has
 * arrived — is not «outgoing by default». It takes the same exit a malformed
 * payload takes: `content`, which is neutral and true for both sides.
 */

/* ── What the database wrote ──────────────────────────────────────────────── */

/** The only `system_payload.kind` this module claims. */
export const CALL_RECORD_KIND = "call";

/**
 * How a call ended, derived by `voice_call_stop` from the ring's own state and
 * who pressed — never reported by a client, so these four are the four that
 * exist and a fifth means a newer deployment.
 */
export type CallOutcome = "answered" | "missed" | "cancelled" | "declined";

const OUTCOMES: readonly CallOutcome[] = ["answered", "missed", "cancelled", "declined"];

/** Which way the call went, for the person reading this row. */
export type CallDirection = "outgoing" | "incoming";

/** The payload, once it has been shown to be one. */
export interface CallRecord {
  readonly outcome: CallOutcome;
  /** Whoever rang. A uuid, and the only thing direction can be decided from. */
  readonly caller: string;
  /** Milliseconds, for `answered` only. Null everywhere else, and when absent. */
  readonly durationMs: number | null;
}

/**
 * One `system_payload`, read as a call record, or null.
 *
 * Null is the ordinary answer: every group-call line and every future system
 * row lands here first. It must therefore be cheap and it must never throw —
 * `readCallRecord(undefined)`, `readCallRecord("call")` and
 * `readCallRecord([{ kind: "call" }])` are all simply «not a call record».
 */
export function readCallRecord(payload: unknown): CallRecord | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (record.kind !== CALL_RECORD_KIND) return null;

  const outcome = OUTCOMES.find((candidate) => candidate === record.outcome);
  if (!outcome) return null;

  // Trimmed before it is judged: a uuid with a stray space is still that
  // person, and an identity of whitespace is no identity at all.
  const caller = typeof record.caller === "string" ? record.caller.trim() : "";
  if (caller.length === 0) return null;

  return { outcome, caller, durationMs: readDuration(record.duration_ms, outcome) };
}

/**
 * The duration, clamped to what a duration can be.
 *
 * Only `answered` has one — that is the database's rule, and it is re-applied
 * here rather than trusted, so a payload that carries a duration beside
 * «Пропущенный звонок» cannot put «3 мин 12 с» under the words «missed call».
 * Everything else is dropped to null: a string, a NaN, an infinity, a negative
 * (which `greatest(0, ...)` already rules out server-side) and a fraction of a
 * second all reach the same place, which is the same place «no duration» does.
 */
function readDuration(value: unknown, outcome: CallOutcome): number | null {
  if (outcome !== "answered") return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

/* ── Which way it went ────────────────────────────────────────────────────── */

/**
 * `outgoing` when this reader is the one who rang.
 *
 * Null when there is nobody to compare against, which is a real state rather
 * than a paranoid one: `MessageList` renders before the store's `currentUser`
 * has necessarily arrived, and a row that guessed would say «Исходящий» about
 * somebody else's call for one frame.
 */
export function callDirection(record: CallRecord, viewerId: string | null | undefined): CallDirection | null {
  const viewer = typeof viewerId === "string" ? viewerId.trim() : "";
  if (viewer.length === 0) return null;
  return record.caller === viewer ? "outgoing" : "incoming";
}

/* ── The words ────────────────────────────────────────────────────────────── */

/**
 * The eight sentences, as a table, because the shape is the argument.
 *
 * Read down a column and it is one person's call log. Read across a row and it
 * is the same call from both ends, which is the whole reason a payload exists
 * instead of a sentence.
 *
 *   outcome    | outgoing (I rang)     | incoming (they rang)
 *   -----------+-----------------------+-----------------------
 *   answered   | Исходящий звонок      | Входящий звонок
 *   missed     | Звонок без ответа     | Пропущенный звонок
 *   cancelled  | Отменённый звонок     | Пропущенный звонок
 *   declined   | Звонок отклонён       | Вы отклонили звонок
 *
 * **`cancelled` and `missed` deliberately collapse for the callee.** The caller
 * hanging up after four seconds and the ring running out after forty-five are
 * two different facts about the caller and exactly one fact about the person
 * being called: somebody rang and you did not take it. Telegram collapses them
 * the same way. The distinction is not lost — it is still in the payload, and
 * the caller's own side reads it — it is simply not the callee's business.
 *
 * The neutral sentences the database wrote into `content` are **not** among
 * these: «Пропущенный звонок» happens to coincide, and «Звонок, 3 мин 12 с»
 * does not. That is by design, and it is what the fallback path renders.
 */
const HEADLINES: Record<CallOutcome, Record<CallDirection, string>> = {
  answered: { outgoing: "Исходящий звонок", incoming: "Входящий звонок" },
  missed: { outgoing: "Звонок без ответа", incoming: "Пропущенный звонок" },
  cancelled: { outgoing: "Отменённый звонок", incoming: "Пропущенный звонок" },
  declined: { outgoing: "Звонок отклонён", incoming: "Вы отклонили звонок" },
};

/**
 * Whether this reader missed a call they never had a chance to act on.
 *
 * The one cell that earns a colour, and it is a rule rather than a list of four
 * cases: a call is «missed» for the person reading when it came **to** them and
 * they neither answered nor refused it. A call you declined is not a call you
 * missed, and a call you cancelled yourself is not a failure of any kind.
 *
 * It lines up exactly with the wording — the two cells that say «Пропущенный
 * звонок» are these two — and that is not a coincidence to be maintained by
 * hand: the test asserts the two agree for all eight cells.
 */
export function callWasMissed(outcome: CallOutcome, direction: CallDirection): boolean {
  if (direction !== "incoming") return false;
  return outcome === "missed" || outcome === "cancelled";
}

/* ── How long it lasted ───────────────────────────────────────────────────── */

/**
 * Russian plural agreement, in the shape `lib/voicePresence.ts` already uses.
 *
 * Followed rather than re-derived, down to the order of the branches: 11 to 14
 * are tested **before** the last digit, because they take the many-form against
 * what their last digit would say. «11 минут», not «11 минута»; «12 секунд»,
 * not «12 секунды». That module's own note records the first version of it
 * getting this wrong, and `tests/unit/voice-presence.test.mjs` walks 1 to 125
 * to catch it; this one walks the same range.
 *
 * `Intl.PluralRules` would answer the same question, and is not used for the
 * same reason it is not used there: it would be a dependency in a module whose
 * point is importing nothing.
 */
function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = count % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/**
 * What the row shows: the database's own units, character for character.
 *
 * «3 мин 12 с», «45 с», «1 мин 0 с». Abbreviated, and therefore with no
 * agreement to get wrong — which is `voice_call_record_line`'s choice, not
 * mine, and it is followed rather than improved on **because the two strings
 * are read side by side**. A bundle that predates the payload renders
 * `content`; this one renders the card; and a person who has both open should
 * not see two different lengths for one call.
 *
 * Under a second answers null rather than «0 с», for the reason the function's
 * own comment gives: a call answered and hung up inside a second is still a
 * call that happened, so the fact is the line and the duration is the detail.
 *
 * **An hour drops its seconds, and a round hour drops its minutes too** —
 * «1 ч 2 мин», «1 ч». At that scale the seconds are noise: somebody reading a
 * call log wants to know it was about an hour, and the extra tokens cost width
 * in the widest row in the conversation. The round-minute case keeps its «0 с»
 * because there is a second form for it to be level with; there is no hour
 * form for a round hour to be level with, so it stops.
 *
 * This arm did not exist until `20260918270000_a_call_over_an_hour_says_hours`,
 * where an hour read «Звонок, 60 мин 0 с». The two are changed together, always:
 * a card and the `content` under it are read side by side, and one call showing
 * two different lengths is worse than either wording.
 */
export function callDurationShort(durationMs: number | null): string | null {
  const parts = splitDuration(durationMs);
  if (!parts) return null;
  if (parts.hours > 0) {
    return parts.minutes === 0 ? `${parts.hours} ч` : `${parts.hours} ч ${parts.minutes} мин`;
  }
  if (parts.minutes === 0) return `${parts.seconds} с`;
  return `${parts.minutes} мин ${parts.seconds} с`;
}

/**
 * The same length said out loud, for the accessible name.
 *
 * «3 минуты 12 секунд», «45 секунд», «1 минута». This is where the agreement
 * above is actually spent: a screen reader saying «три мин двенадцать с» is the
 * reason the abbreviated form cannot be the only form, and it is the reason
 * this module carries a plural rule at all.
 *
 * A round minute drops its seconds — «1 минута», not «1 минута 0 секунд» —
 * where the short form keeps «1 мин 0 с» to stay level with `content`. The two
 * diverge exactly there and nowhere else, and each is right for its medium.
 */
export function callDurationSpoken(durationMs: number | null): string | null {
  const parts = splitDuration(durationMs);
  if (!parts) return null;
  const minutes = `${parts.minutes} ${plural(parts.minutes, "минута", "минуты", "минут")}`;
  // Hours follow the short form exactly — no seconds, and none of «0 минут» on
  // a round hour — so that what is read out and what is on screen are the same
  // fact. «час/часа/часов» is the third agreement this module carries, and 11
  // hours is «11 часов» by the same 11–14 rule as everything else.
  if (parts.hours > 0) {
    const hours = `${parts.hours} ${plural(parts.hours, "час", "часа", "часов")}`;
    return parts.minutes === 0 ? hours : `${hours} ${minutes}`;
  }
  const seconds = `${parts.seconds} ${plural(parts.seconds, "секунда", "секунды", "секунд")}`;
  if (parts.minutes === 0) return seconds;
  return parts.seconds === 0 ? minutes : `${minutes} ${seconds}`;
}

function splitDuration(
  durationMs: number | null,
): { hours: number; minutes: number; seconds: number } | null {
  if (durationMs === null || !Number.isFinite(durationMs)) return null;
  const total = Math.floor(Math.max(durationMs, 0) / 1000);
  if (total < 1) return null;
  // Minutes are the remainder within the hour, not the total, or «1 ч 62 мин»
  // would be the reading of a 62-minute call.
  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

/* ── The row ──────────────────────────────────────────────────────────────── */

/** Everything a call row draws, decided here so the component decides nothing. */
export interface CallRecordView {
  readonly outcome: CallOutcome;
  readonly direction: CallDirection;
  /** «Входящий звонок». Never `content`, and never the same for both readers. */
  readonly headline: string;
  /** «3 мин 12 с», or null when there is no length to show. */
  readonly duration: string | null;
  /** True only for a call that came to this reader and got no answer from them. */
  readonly missed: boolean;
  /**
   * The glyph, by name.
   *
   * Direction is the arrow and the outcome is the colour — Telegram's language,
   * and the reason there are two icons here rather than eight. A name rather
   * than a component, so this module still imports nothing.
   */
  readonly icon: "phoneIncoming" | "phoneOutgoing";
  /** The whole row as one sentence, for `aria-label` and the hover title. */
  readonly spoken: string;
}

/**
 * One system row, read as a call, or null for «this is not a call record».
 *
 * Null is the fallback signal, and every caller has the same answer for it:
 * render `content`. There is deliberately no second shape between «a call card»
 * and «the sentence the database wrote».
 */
export function callRecordView(payload: unknown, viewerId: string | null | undefined): CallRecordView | null {
  const record = readCallRecord(payload);
  if (!record) return null;
  const direction = callDirection(record, viewerId);
  if (!direction) return null;

  const headline = HEADLINES[record.outcome][direction];
  const duration = callDurationShort(record.durationMs);
  const spokenDuration = callDurationSpoken(record.durationMs);
  return {
    outcome: record.outcome,
    direction,
    headline,
    duration,
    missed: callWasMissed(record.outcome, direction),
    icon: direction === "incoming" ? "phoneIncoming" : "phoneOutgoing",
    spoken: spokenDuration ? `${headline}, ${spokenDuration}` : headline,
  };
}

/**
 * What a conversation's row in the chat list says when its last message was a
 * call.
 *
 * The headline and not the duration, which is Telegram's choice and the right
 * one for a line that is already competing with a name, a time and a badge.
 *
 * Null means «not a call record», and the list then does what it has always
 * done with a system row: prints `content`. That is what keeps the group-call
 * line of D-229 untouched by this whole slice.
 */
export function callRecordPreview(payload: unknown, viewerId: string | null | undefined): string | null {
  return callRecordView(payload, viewerId)?.headline ?? null;
}

/* ── Calling back ─────────────────────────────────────────────────────────── */

/**
 * A member row, as `chat_members` joined to `profiles` arrives.
 *
 * Structural rather than imported, so this module keeps its promise. The field
 * names are the database's, not a translation of them, so the caller hands over
 * what it already has instead of mapping it into a private shape.
 */
export interface CallBackMemberRow {
  readonly user_id?: string | null;
  readonly profile?: { readonly full_name?: string | null; readonly username?: string | null } | null;
}

/**
 * The one refusal this surface owns, and the reason it is not
 * `voiceRingRefusalText`'s.
 *
 * Every other way a call back can fail is raised by `voice_call_ring` and
 * already has a sentence: a ring already going in this chat, somebody already
 * talking in it, a person who blocked you, a chat you have left. This one is
 * **not** raised by the database at all: `voice_call_ring` refuses a room with
 * people in it, which is a fact about this conversation's room and says nothing
 * about a call this client is holding in some other chat.
 *
 * That call matters, and the proposal says why: joining a new room is what ends
 * the old one, so a press that went through would hang up a conversation
 * without having said it was going to. `voiceCallOffer` keeps the header's
 * control hidden for exactly this; a record in the conversation is not hidden,
 * so it says it instead. The words are `voiceCapsuleState`'s, which declines
 * the same press with the same fact.
 */
export const CALL_BACK_BUSY_TEXT = "Вы в другом голосовом чате.";

/**
 * Whether a call this client is already holding stands in the way.
 *
 * **`channelId` alone is not «in a call», and believing it was is a defect this
 * module caught in its own first draft.** `useVoiceCall` publishes a failure as
 * `{ ...IDLE, phase: "failed", channelId }` — the room is kept so the interface
 * can say which call was refused — so a single microphone prompt that somebody
 * dismissed would have made every call back in the product answer «Вы в другом
 * голосовом чате» until the page was reloaded.
 *
 * The predicate is `voiceCapsuleState`'s, which decides the same thing for the
 * capsule's own press: a channel, and a phase that is neither `idle` nor
 * `failed`. It is here rather than beside it because a rule inside a
 * `"use client"` module is a rule with no test, and this one has five states to
 * walk.
 *
 * `joining` counts. The microphone has been asked for or the token has, and a
 * second room joined underneath that is the same duplicate identity the
 * finished case would be.
 */
export function callBackBlockedByCall(call: {
  readonly channelId: string | null;
  readonly phase: string;
}): boolean {
  if (call.channelId === null) return false;
  return call.phase !== "idle" && call.phase !== "failed";
}

/** Who a call record offers to call back, or null when nobody can be named. */
export interface CallBackPerson {
  readonly id: string;
  /** What the call bar will print while the call runs. Never blank. */
  readonly name: string;
}

/**
 * The other participant of a private chat, from the member list the
 * conversation already holds.
 *
 * The same derivation `useChats` makes for `other_user` — the member who is not
 * you, named `full_name` then `username` — written here so it is a rule rather
 * than a line inside a component, and so the fallback name is asserted rather
 * than discovered on the day somebody's profile has no name.
 *
 * **This is not a second `voiceCallOffer`, and the difference is the point.**
 * That function answers «should the header draw a call control right now», and
 * so it consults the live state: a call already running, a ring already going,
 * a person this reader has blocked. This one answers «is there somebody at the
 * other end of this conversation», which is a permanent fact about the chat.
 *
 * A record in the conversation is not a control that appears and disappears —
 * it is a row that will still be there tomorrow — so its tap must not blink out
 * because a call started in another chat. The live refusals stay where slice A
 * put them: `voice_call_ring` raises them and `voiceRingRefusalText` says them,
 * one sentence per reason, on the press.
 *
 * Refused for anything but a private chat, for «Избранное» (whose only member
 * is the reader), for a bot conversation (no second member at all), and — the
 * case worth naming — for a member list with more than one other person in it.
 * A private chat cannot have three members; if one arrives, calling whichever
 * happened to be first would be calling a stranger.
 */
export function callBackPerson(input: {
  readonly chatType: string | null | undefined;
  readonly selfId: string | null | undefined;
  readonly members: readonly CallBackMemberRow[] | null | undefined;
}): CallBackPerson | null {
  if (input.chatType !== "private") return null;
  const self = typeof input.selfId === "string" ? input.selfId.trim() : "";
  if (self.length === 0) return null;
  if (!Array.isArray(input.members)) return null;

  const others = input.members.filter((member) => {
    const id = typeof member?.user_id === "string" ? member.user_id.trim() : "";
    return id.length > 0 && id !== self;
  });
  if (others.length !== 1) return null;

  const person = others[0];
  const id = (person.user_id as string).trim();
  const named = (person.profile?.full_name ?? person.profile?.username ?? "").trim();
  // «Звонок» is the room's own name in the database, and it is what the bar
  // would print with nothing better. A blank is never carried through.
  return { id, name: named.length > 0 ? named : "Звонок" };
}
