/**
 * Every decision a voice channel's interface makes that can be stated without
 * React, without a browser and without a network.
 *
 * This module imports nothing on purpose. The lesson the project already paid
 * for is written in CLAUDE.md: a check that cannot be reached from a test is
 * not a gap in the suite, it is a gap in the module boundary. A rule about what
 * the capsule says, or about whether a row is offered, is a rule — so it lives
 * where `node --test` can load it, and `tests/unit/voice-channel.test.mts`
 * holds it.
 *
 * Slice 2 of docs/proposals/2026-09-13-voice-channels.md. Who is speaking is
 * deliberately absent: that is slice 4, and section 3.1 explains why it is not
 * a column and not a rule here either.
 *
 * The first import below is a **type** and erases at build, so this module
 * still pulls nothing into a `node --test` process and nothing into a bundle.
 * The union it names belongs beside the decisions that read it, in
 * `lib/voiceVolume.ts`, rather than being written out twice.
 *
 * The second is not a type, and it is the one exception: two words, from a
 * sibling that itself imports nothing — the same shape `voicePresence.ts` has.
 * They are the sentence the capsule says when this person is already in the
 * room on another device, and the bar and the rail say the same sentence from
 * the same constant. A word written out twice is two surfaces that can drift,
 * which is the thing this product refuses more firmly than it refuses an
 * import.
 */

import type { VoiceAudioSource } from "./voiceVolume";
import { VOICE_ELSEWHERE_DETAIL, VOICE_ELSEWHERE_MOVE } from "./voiceElsewhere.ts";

/** Where the call is, from the interface's point of view. */
export type VoiceCallPhase =
  /** Not in a call. */
  | "idle"
  /** The microphone has been asked for, or the token has, or the room is connecting. */
  | "joining"
  /** Connected and publishing. */
  | "connected"
  /** The transport dropped and the SDK is putting it back. */
  | "reconnecting"
  /** The join was refused, or the call ended in a way a person must be told about. */
  | "failed";

/**
 * A voice channel as everything **outside** the call reads it.
 *
 * Section 3.1: a person who is in the call does not read this — their SDK
 * connection already knows who is present. So this shape carries membership
 * and nothing that changes many times a second.
 */
export interface VoiceChannelSummary {
  id: string;
  name: string;
  /** The denormalised count on the channel row, which the client never writes. */
  participantCount: number;
  maxParticipants: number;
}

/** One person in the call, as the capsule and the panel draw them. */
export interface VoiceParticipant {
  userId: string;
  name: string;
  /** Self-mute, as the SFU reports it. Not a database column — section 3.1. */
  muted: boolean;
  /**
   * Whether the SFU currently lets this person publish, or `null` when nobody
   * here knows.
   *
   * Kept apart from `muted` because the two look identical and are not the same
   * fact. `muted` is `!isMicrophoneEnabled`, which is true for somebody who
   * pressed their own microphone button **and** for somebody a moderator
   * silenced — and the moderation menu has to tell those apart, or it offers
   * «Разрешить говорить» to a person who muted themselves and restores a
   * permission they never lost. That control would do nothing, which is the
   * defect D-221 exists to close rather than to add.
   *
   * `null` is «unknown» and must never be read as «silenced»: outside a call
   * the table carries no permissions at all, and a participant whose token
   * simply granted publish may carry no explicit value either. Same distinction
   * `lossBetween` makes in `lib/voiceConnectionHealth.ts`, where a missing
   * counter answers `null` rather than a confident zero.
   */
  canSpeak: boolean | null;
  /**
   * How the room carries this person's voice, or `null` when nobody here knows.
   *
   * Read by the per-person volume control and by nothing else, and it exists
   * because the honest answer to «can I turn this person down» is not always
   * yes: `RemoteParticipant.setVolume` finds its publication by source, and a
   * participant running a build from before 2026-09-18 publishes their
   * microphone as `Unknown`. For them the call changes nothing and reports no
   * error — so the fact has to arrive here, where a surface can say it, rather
   * than be discovered by a listener dragging a slider that does nothing.
   *
   * `null` is «unknown» on the same terms as `canSpeak`: outside a call the
   * table carries presence and no publications at all. Never read as «cannot».
   * `lib/voiceVolume.ts` turns this reading into what the interface draws.
   */
  audioSource: VoiceAudioSource | null;
}

/** Why a microphone could not be captured. Mirrors `classifyMicError`'s codes. */
export type MicrophoneRefusalCode =
  | "permission_denied"
  | "no_device"
  | "unsupported"
  | "unknown";

/**
 * The same mapping `useVoiceRecorder.ts:44-57` makes, restated here rather than
 * imported.
 *
 * That function lives inside a `"use client"` module that imports React, so a
 * `node --test` process cannot load it, and a rule that cannot be tested is the
 * thing this file exists to avoid. The two are small, identical and both about
 * `getUserMedia`; if the DOM ever renames one of these errors, both change.
 */
export function classifyMicrophoneError(error: unknown): MicrophoneRefusalCode {
  // `unsupported` is not reachable from a thrown error — a browser with no
  // `getUserMedia` throws nothing, it simply has no method to call. The caller
  // decides that one before it asks; this function only reads what came back.
  if (!(error instanceof Error)) return "unknown";
  const name = error.name;
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return "permission_denied";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "no_device";
  if (name === "NotReadableError" || name === "TrackStartError") return "no_device";
  return "unknown";
}

/**
 * What a microphone refusal means to a person.
 *
 * A denied microphone is a state the interface has words for, never a silent
 * failure: the join stops, the capsule says this, and the join control comes
 * back so the person can try again after changing their mind. The second half
 * of each sentence is deliberately shell-agnostic here — the caller appends
 * `microphonePermissionHelp()`, which already knows whether it is Windows,
 * Android or a browser.
 */
export function microphoneRefusalText(code: MicrophoneRefusalCode): string {
  switch (code) {
    case "permission_denied":
      return "Нет доступа к микрофону.";
    case "no_device":
      return "Микрофон не найден или занят другим приложением.";
    case "unsupported":
      return "Этот браузер не умеет записывать звук.";
    default:
      return "Не удалось включить микрофон.";
  }
}

/**
 * The people in the call, named from a directory the caller already has.
 *
 * `voice_participants` stores user ids and nothing else — section 3.1 keeps
 * everything that is not membership out of that table — so a name has to come
 * from somewhere the interface already loaded, which is the chat's own member
 * list. Someone who joined and is not in that list gets «Участник» rather than
 * an empty row: it happens for a moment after somebody is added to a group, and
 * a blank line reads as a defect where a placeholder reads as a person whose
 * name has not arrived yet.
 */
export function resolveVoiceParticipants(
  userIds: readonly string[],
  directory: ReadonlyMap<string, string>,
): VoiceParticipant[] {
  return userIds.map((userId) => ({
    userId,
    name: directory.get(userId)?.trim() || "Участник",
    // Mute is the SFU's to report and is not in the table. Outside the call
    // nobody is drawn as muted, because nothing out here knows.
    muted: false,
    // And `null` rather than `true` for the same reason, one step further: the
    // table knows who is in the room and nothing else, so whether they may
    // speak is unknown here. `true` would be a claim, and it is the claim that
    // would put «Заглушить» on somebody already silenced.
    canSpeak: null,
    // `null` for the third time, and this one is load-bearing in a different
    // way: a volume control offered from out here would store a number and
    // move no audio, because nothing is subscribed to a room this client is
    // not in. The rule that refuses it reads exactly this.
    audioSource: null,
  }));
}

/**
 * The SDK's list, renamed from the chat's own member list.
 *
 * A LiveKit participant carries whatever display name the gateway baked into
 * the token at mint time. That is a snapshot: somebody who changed their name
 * ten minutes ago is still the old name to everyone whose token predates the
 * change, and two people in one call can see different names for the same
 * third person. The chat's member list is current, so it wins wherever it has
 * an entry; the token's name is the fallback for somebody the reader has not
 * loaded a profile for, and «Участник» is the fallback for both being empty.
 */
export function renameVoiceParticipants(
  participants: readonly VoiceParticipant[],
  directory: ReadonlyMap<string, string>,
): VoiceParticipant[] {
  return participants.map((participant) => ({
    ...participant,
    name: directory.get(participant.userId)?.trim() || participant.name.trim() || "Участник",
  }));
}

/** Why no voice row is drawn. Each is a different sentence, or no row at all. */
export type VoiceRowRefusal = "not_a_group" | "not_a_member" | "no_channel";

export type VoiceRowVerdict =
  | { offered: true; channel: VoiceChannelSummary; full: boolean }
  | { offered: false; reason: VoiceRowRefusal };

/**
 * Whether the group information panel offers a voice channel at all.
 *
 * Three refusals, and they are not interchangeable. `not_a_group` is the
 * product's own boundary for slice 2 — section 4.1 says «Голосовой канал»
 * belongs to `type = 'group'` only, and D-169 is the register entry for what
 * happens when this panel calls a channel a group. `not_a_member` is RLS
 * stated in the interface: a non-member cannot read the channel and must not be
 * shown a control that would be refused. `no_channel` is the ordinary case of a
 * group nobody has made one in.
 *
 * `full` is separated from `offered` deliberately: a full channel still shows
 * its row and its people. Hiding it would tell someone who wants to wait
 * nothing at all.
 */
export function voiceChannelRowOffer(input: {
  chatType: string;
  myRole: "owner" | "admin" | "member" | null;
  channel: VoiceChannelSummary | null;
}): VoiceRowVerdict {
  if (input.chatType !== "group") return { offered: false, reason: "not_a_group" };
  if (input.myRole === null) return { offered: false, reason: "not_a_member" };
  if (!input.channel) return { offered: false, reason: "no_channel" };
  return {
    offered: true,
    channel: input.channel,
    full: voiceSeatsExhausted(input.channel),
  };
}

/**
 * The seat count that means «as many as turn up», and the two rules that read
 * it.
 *
 * The owner, 2026-09-20: «изначально ограничения быть не должно». 0 is the
 * column's default since
 * `20260920130000_a_group_voice_channel_has_no_seat_limit.sql` and it is
 * LiveKit's own spelling for an unbounded room.
 *
 * The constant is written out here rather than imported because this module
 * imports nothing (see the header), and the same zero appears in
 * `serverChannelVocabulary.ts`, `serverChannels.ts`, `channelRail.ts` and
 * `supabase/functions/voice-gateway/seatLimit.mjs`. `voice-channel.test.mts`
 * pins them equal, so the copies cannot drift apart without a test going red —
 * which is what the four *disagreeing* readings of this column before today
 * cost: `voiceJoinVerdict` read 0 as unbounded, `seatLabel` as «print nothing»,
 * `useVoiceChannel` rewrote it to 1, and the gateway called it a 503.
 */
export const VOICE_SEATS_UNLIMITED = 0;

/**
 * Whether this channel has run out of room.
 *
 * Unlimited skips the comparison rather than comparing against a large number.
 * A negative or fractional limit is treated as a limit of zero, i.e. unbounded,
 * because every writer of this column now floors at zero and a broken value
 * must not turn into «nobody may join».
 */
export function voiceSeatsExhausted(input: {
  participantCount: number;
  maxParticipants: number;
}): boolean {
  const limit = Math.floor(input.maxParticipants);
  if (!Number.isFinite(limit) || limit <= VOICE_SEATS_UNLIMITED) return false;
  return input.participantCount >= limit;
}

/**
 * How many are in, as the row says it.
 *
 * The maximum is always printed, because the number that decides whether a
 * person can join is the pair and not the count. «3 из 10» beside an empty
 * channel would read as a defect, so zero gets its own sentence.
 *
 * A room with no limit has no pair to print and says only the count: «3 из 0»
 * would read as a full room, which is the opposite of what it is.
 */
export function voiceOccupancyLabel(count: number, max: number): string {
  const present = Math.max(0, Math.floor(count));
  if (present === 0) return "Никого нет";
  const limit = Math.floor(max);
  if (!Number.isFinite(limit) || limit <= VOICE_SEATS_UNLIMITED) {
    // «3 в канале», and «1 в канале» for one — grammatical at every count, so
    // this module keeps its promise of importing nothing rather than growing a
    // second copy of the vocabulary's pluralizer.
    return `${present} в канале`;
  }
  return `${present} из ${Math.max(present, limit)}`;
}

/**
 * How many the row says are in, given that the count and the list come from two
 * different places.
 *
 * Outside the call both come from the database and agree. Inside it the list is
 * the SDK's — a live connection to every participant — while the counter is
 * still the table's, which lags by a webhook round trip. Photographed while
 * this was written: «1 из 10» printed directly above a list of two people, which
 * reads as a defect and is one.
 *
 * So the count follows whatever list is on screen beneath it. The table's
 * counter is still what is shown **before** joining, deliberately: that is the
 * number the gateway compares against `max_participants` when it decides
 * whether to mint (section 3.4, step 4), so it is the number the reader's next
 * press will be judged on. Once they are in, nothing is going to refuse them
 * and the SDK is simply more correct.
 */
export function voiceOccupancy(input: { inCall: boolean; rowCount: number; listed: number }): number {
  return input.inCall ? input.listed : input.rowCount;
}

/**
 * The participant list's order: you first, then everyone else by name.
 *
 * You first because the list answers «кто здесь» and the reader already knows
 * about themselves — finding your own name eighth in an alphabet is a second
 * search. The rest are ordered with a Russian collator rather than by code
 * point: `localeCompare` without a locale puts «Ё» after «Я» in some engines
 * and between «Е» and «Ж» in others, and a list that reorders itself between
 * a phone and a desktop reads as a bug. Ties break on the user id so the order
 * is total and a re-render cannot shuffle two people with the same name.
 */
export function orderVoiceParticipants(
  participants: readonly VoiceParticipant[],
  selfId: string | null,
): VoiceParticipant[] {
  const collator = new Intl.Collator("ru-RU", { sensitivity: "base" });
  return [...participants].sort((a, b) => {
    if (selfId) {
      if (a.userId === selfId) return b.userId === selfId ? 0 : -1;
      if (b.userId === selfId) return 1;
    }
    const byName = collator.compare(a.name, b.name);
    return byName !== 0 ? byName : a.userId.localeCompare(b.userId);
  });
}

/**
 * The people in the call, in one line, for a capsule that has room for one.
 *
 * Two names and a remainder: the capsule is narrow at 360 CSS pixels, and the
 * full list is a press away in the information panel. You are «Вы» — the same
 * reason the ordering puts you first.
 */
export function voiceParticipantsLine(
  participants: readonly VoiceParticipant[],
  selfId: string | null,
): string {
  const ordered = orderVoiceParticipants(participants, selfId);
  if (ordered.length === 0) return "Никого нет";
  const named = ordered.slice(0, 2).map((p) => (p.userId === selfId ? "Вы" : p.name));
  const rest = ordered.length - named.length;
  if (rest <= 0) return named.join(", ");
  return `${named.join(", ")} и ещё ${rest}`;
}

/** What the capsule under the chat header draws, for one state. */
export interface VoiceCapsuleView {
  /** False when there is nothing to say and the capsule is not rendered at all. */
  visible: boolean;
  title: string;
  detail: string;
  /**
   * The primary control, or null when the capsule offers none in this state.
   *
   * `move` is a join with its consequence said out loud: this person is
   * already in this room on another device, so the press takes the conversation
   * off that device. It replaces the plain join rather than standing beside it
   * — see `lib/voiceElsewhere.ts`.
   */
  action: "join" | "leave" | "cancel" | "move" | null;
  actionLabel: string | null;
  /** Whether the mute control is drawn, and how it reads. */
  mute: boolean;
  muted: boolean;
  /**
   * Whether this person has stopped hearing the room, and whether the control
   * is drawn at all.
   *
   * Drawn whenever the capsule is a live call, including for somebody whose
   * token may not publish: deafening is about their own ears and does not need
   * permission to speak. That is why it is not gated on `canPublish` the way
   * `mute` is.
   */
  deafen: boolean;
  deafened: boolean;
  /** Set while something is in flight, so the control can say so and refuse a second press. */
  busy: boolean;
  /**
   * The browser would not send this call's audio to the chosen output device.
   *
   * Only ever set on a call that is running **here**: a refusal is a fact about
   * a live connection, and a capsule offering the way in has no audio to have
   * failed to move. It exists so the interface can decline to claim a success
   * it did not have — a headset selected in settings, and the call still coming
   * out of the laptop speaker, is the state this is here to make visible.
   */
  outputRefused: boolean;
  tone: "neutral" | "live" | "danger";
}

const HIDDEN: VoiceCapsuleView = {
  visible: false,
  title: "",
  detail: "",
  action: null,
  actionLabel: null,
  mute: false,
  muted: false,
  deafen: false,
  deafened: false,
  busy: false,
  outputRefused: false,
  tone: "neutral",
};

/**
 * What the capsule says, for every state it can be in.
 *
 * The one case worth reading twice is the last branch: the call is running in
 * **another** chat's channel. Slice 2 does not have the bar that outlives a
 * conversation (that is slice 3), so the honest thing for this chat's capsule
 * to do is say where the call actually is and offer no control — rather than a
 * «Присоединиться» that would kick the person out of the call they are in,
 * which is what a second join does (section 3.6's duplicate identity).
 */
export function voiceCapsuleState(input: {
  /** This chat's voice channel, or null when it has none. */
  channel: VoiceChannelSummary | null;
  phase: VoiceCallPhase;
  /** The channel the call is in, which need not be this chat's. */
  callChannelId: string | null;
  /** The people in the call, from the SDK while connected. */
  participants: readonly VoiceParticipant[];
  selfId: string | null;
  micMuted: boolean;
  /**
   * Whether this client's token may publish. The gateway decides it from the
   * member's role against the channel's `speak_role` and from whether they are
   * muted, and the SFU enforces it — so a mute control over a token that cannot
   * publish would be a control with nothing behind it.
   */
  canPublish: boolean;
  /** A sentence, already in Russian, when the last attempt was refused. */
  refusal: string | null;
  /**
   * Whether the browser refused to move this call's audio to the device the
   * person chose. Required rather than optional: a caller that stops passing it
   * is a capsule that has quietly gone back to claiming a success it never had,
   * and that has to be a type error rather than a silent `undefined`.
   */
  outputDeviceRefused: boolean;
  /**
   * Whether this person has stopped hearing the room. Required rather than
   * optional, for the reason `outputDeviceRefused` is: a caller that stops
   * passing it draws a control whose state it no longer knows, and that has to
   * be a type error rather than a silent `false`.
   */
  deafened: boolean;
  /**
   * Whether this person is already in **this** room on another of their
   * devices, as `voiceJoinIsAMove` answers it.
   *
   * Required rather than optional, for the reason `deafened` is: a caller that
   * stops passing it goes back to offering a plain «Присоединиться» to somebody
   * whose press would take the conversation off their computer without saying
   * so, and that has to be a type error rather than a silent `false`.
   */
  elsewhere: boolean;
}): VoiceCapsuleView {
  const {
    channel,
    phase,
    callChannelId,
    participants,
    selfId,
    micMuted,
    canPublish,
    refusal,
    outputDeviceRefused,
    deafened,
  } = input;
  const here = channel !== null && callChannelId === channel.id;

  if (here && (phase === "connected" || phase === "reconnecting")) {
    const line = voiceParticipantsLine(participants, selfId);
    return {
      visible: true,
      title: channel.name,
      detail:
        phase === "reconnecting"
          ? "Связь потеряна, восстанавливаем…"
          : canPublish
            ? line
            : `Только слушаете · ${line}`,
      action: "leave",
      actionLabel: "Выйти",
      mute: canPublish,
      // Not gated on `canPublish`: deafening is about this person's own ears
      // and needs no permission to speak.
      deafen: true,
      deafened,
      muted: micMuted,
      busy: phase === "reconnecting",
      outputRefused: outputDeviceRefused,
      tone: phase === "reconnecting" ? "danger" : "live",
    };
  }

  if (here && phase === "joining") {
    return {
      visible: true,
      title: channel.name,
      detail: "Подключаемся…",
      // A join that hangs has to be escapable, or the only way out is a reload.
      action: "cancel",
      actionLabel: "Отмена",
      mute: false,
      deafen: false,
      deafened,
      muted: micMuted,
      busy: true,
      outputRefused: false,
      tone: "neutral",
    };
  }

  if (!channel) return HIDDEN;

  // A call in some other chat's channel. Say so, offer nothing.
  if (callChannelId !== null && phase !== "idle" && phase !== "failed") {
    return {
      visible: true,
      title: channel.name,
      detail: "Вы в другом голосовом чате",
      action: null,
      actionLabel: null,
      mute: false,
      deafen: false,
      deafened,
      muted: micMuted,
      busy: false,
      outputRefused: false,
      tone: "neutral",
    };
  }

  /**
   * Already in this room, on another of this person's devices.
   *
   * Before the failed-join branch and before the seat count, and both are
   * deliberate. A room that is «full» is full **of this person among others**,
   * so «Мест больше нет» would refuse somebody a seat they are already sitting
   * in; and a refusal from an earlier attempt on this device says nothing about
   * a connection that is up on another one.
   */
  if (input.elsewhere) {
    return {
      visible: true,
      title: channel.name,
      detail: VOICE_ELSEWHERE_DETAIL,
      action: "move",
      actionLabel: VOICE_ELSEWHERE_MOVE,
      mute: false,
      deafen: false,
      deafened,
      muted: false,
      busy: false,
      outputRefused: false,
      tone: "neutral",
    };
  }

  const full = voiceSeatsExhausted(channel);

  if (phase === "failed" && refusal) {
    return {
      visible: true,
      title: channel.name,
      detail: refusal,
      action: "join",
      actionLabel: "Повторить",
      mute: false,
      deafen: false,
      deafened,
      muted: false,
      busy: false,
      outputRefused: false,
      tone: "danger",
    };
  }

  return {
    visible: true,
    title: channel.name,
    detail: full
      ? "Мест больше нет"
      : voiceOccupancyLabel(channel.participantCount, channel.maxParticipants),
    action: full ? null : "join",
    actionLabel: full ? null : "Присоединиться",
    mute: false,
    deafen: false,
    deafened,
    muted: false,
    busy: false,
    outputRefused: false,
    tone: "neutral",
  };
}

/**
 * What an administrator may do to the channel **itself**, as opposed to to the
 * call in it.
 *
 * Telegram's mechanic, which is the one this follows: in a group an
 * administrator starts a voice chat, everybody else joins the thing that now
 * exists, and an administrator can end it for everyone. Nobody else is offered
 * either control — not a member, and certainly not an onlooker.
 *
 * The two halves of the rule are not decorative. `is_chat_admin(chat_id)` is
 * the USING and the WITH CHECK of the one policy that lets a client write this
 * table at all, so an offer to a member is an offer the database will refuse;
 * and slice 2 is group-only, so a channel chat gets nothing here for the same
 * reason `voiceChannelRowOffer` refuses it (D-169).
 *
 * `supported` and `ready` are the two states where the honest answer is «not
 * yet, and I do not know». A deployment whose voice tables are absent answers
 * `supported: false` and must offer nothing rather than a control that ends in
 * a Postgres error; and until the first read has come back, «this group has no
 * channel» is indistinguishable from «I have not looked», so offering to start
 * one would flash a control that is about to be wrong.
 */
export type VoiceChannelControl = "start" | "end" | null;

export function voiceChannelControl(input: {
  chatType: string;
  myRole: "owner" | "admin" | "member" | null;
  hasChannel: boolean;
  /** False where this deployment has no voice tables at all. */
  supported: boolean;
  /** False until the first read of the channel has come back. */
  ready: boolean;
}): VoiceChannelControl {
  if (!input.supported || !input.ready) return null;
  if (input.chatType !== "group") return null;
  if (input.myRole !== "owner" && input.myRole !== "admin") return null;
  return input.hasChannel ? "end" : "start";
}

/** The row an administrator's press inserts, minus the ids the caller holds. */
export interface VoiceChannelDraft {
  name: string;
  maxParticipants: number;
}

/**
 * What a new channel is called, and how many it holds.
 *
 * There is no dialog before the insert, because Telegram has none: the press
 * starts the thing, and a form in front of it would turn a one-tap mechanic
 * into a configuration screen for two values almost nobody would change.
 *
 * **The ten that used to be here was wrong about why it was here.** It said:
 * «It is what `livekit.yaml` on the production SFU already limits a room to …
 * so a client that asked for more would be writing a number the server will not
 * honour.» Measured against that SFU on 2026-09-20, with throwaway rooms
 * created, read back and deleted: `CreateRoom` asking for 50 stored 50, and
 * asking for 100000 stored 100000. `auto_create: false` means every room here
 * comes from the gateway's own `CreateRoom`, which passes this column — so the
 * config value never clamped anything, and the cap was this number all along.
 *
 * It is 0 now, «no limit», which is the owner's «изначально ограничения быть не
 * должно» and the column's own default. An administrator who wants a smaller
 * room says so in the channel's settings; nobody has to undo a cap they never
 * asked for.
 */
export function newVoiceChannelDraft(): VoiceChannelDraft {
  return { name: "Общий голос", maxParticipants: VOICE_SEATS_UNLIMITED };
}

/**
 * Why a start or an end did not happen.
 *
 * Deliberately not the Postgres code: `42501` on the screen is a number the
 * reader can do nothing with, and the raw message behind it («new row violates
 * row-level security policy for table "voice_channels"») names an
 * implementation the product does not otherwise admit to having.
 */
export type VoiceChannelWriteRefusal =
  | "forbidden"
  | "unsupported"
  | "already"
  | "network"
  | "unknown";

function writeErrorFields(error: unknown): { code: string; message: string } {
  if (typeof error === "string") return { code: "", message: error.toLocaleLowerCase("ru-RU") };
  if (!error || typeof error !== "object") return { code: "", message: "" };
  const record = error as Record<string, unknown>;
  return {
    code: typeof record.code === "string" ? record.code : "",
    message: typeof record.message === "string" ? record.message.toLocaleLowerCase("ru-RU") : "",
  };
}

/**
 * One PostgREST answer, read as a reason.
 *
 * The three table-absent codes are the same ones `useVoiceChannel` already
 * treats as «this deployment has no voice tables» — a state the client half is
 * built to pass through, because the migration, the gateway and this interface
 * are three separate pieces of work.
 *
 * `23505` is the race between two administrators pressing at the same moment on
 * a deployment that has given `chat_id` a unique index. Without one they both
 * succeed and the second row is simply ignored by the reader, which takes the
 * first; with one, the loser is told the true thing rather than «unknown».
 *
 * supabase-js reports a fetch that never reached anything as an error with no
 * code, so the message is the only evidence — «failed to fetch» in Chromium,
 * «load failed» in WebKit.
 */
export function classifyVoiceChannelWriteError(error: unknown): VoiceChannelWriteRefusal {
  const { code, message } = writeErrorFields(error);
  if (code === "42501" || code === "PGRST301") return "forbidden";
  if (code === "42P01" || code === "PGRST205" || code === "PGRST202") return "unsupported";
  if (code === "23505") return "already";
  if (message.includes("row-level security") || message.includes("permission denied")) {
    return "forbidden";
  }
  if (code === "" && (message.includes("fetch") || message.includes("network") || message.includes("load failed"))) {
    return "network";
  }
  return "unknown";
}

/**
 * What a refused start means to a person.
 *
 * Full sentences, in the voice `microphoneRefusalText` and
 * `voiceGatewayRefusalText` already speak in: one line, no code, and nothing
 * the reader cannot act on.
 */
export function voiceChannelStartRefusalText(code: VoiceChannelWriteRefusal): string {
  switch (code) {
    case "forbidden":
      return "Недостаточно прав, чтобы начать голосовой чат.";
    case "unsupported":
      return "Голосовые чаты здесь пока недоступны.";
    case "already":
      return "Голосовой чат уже начат.";
    case "network":
      return "Нет связи с сервером, проверьте подключение.";
    default:
      return "Не удалось начать голосовой чат.";
  }
}

/** The same, for an end that did not happen. */
export function voiceChannelEndRefusalText(code: VoiceChannelWriteRefusal): string {
  switch (code) {
    case "forbidden":
      return "Недостаточно прав, чтобы завершить голосовой чат.";
    case "unsupported":
      return "Голосовые чаты здесь пока недоступны.";
    case "already":
      return "Голосовой чат уже завершён.";
    case "network":
      return "Нет связи с сервером, проверьте подключение.";
    default:
      return "Не удалось завершить голосовой чат.";
  }
}

/** The question raised before an end, and the words it is answered with. */
export interface VoiceChannelEndConfirmation {
  title: string;
  description: string;
  aftermath: string;
  confirmLabel: string;
  busyLabel: string;
}

/**
 * Ending asks first, and says what it does.
 *
 * The one thing this question must not be coy about is that it reaches other
 * people: an administrator pressing it while three colleagues are talking
 * disconnects all three. «Удалить канал?» would read as tidying up a row.
 */
export function voiceChannelEndConfirmation(): VoiceChannelEndConfirmation {
  return {
    title: "Завершить голосовой чат?",
    description: "Все, кто сейчас в нём, будут отключены.",
    aftermath:
      "Голосовой чат исчезнет у всех участников группы. Начать новый можно в любой момент.",
    confirmLabel: "Завершить",
    busyLabel: "Завершаем…",
  };
}

/**
 * Whether this client's own call has to end because its channel is gone.
 *
 * This is what makes the question above true rather than a claim. Ending is a
 * DELETE of the channel row; the SFU keeps the room open for another minute and
 * there is no client call that closes it sooner, so without this a person in
 * the call would keep hearing everybody while their capsule — and with it the
 * only «Выйти» control that exists in slice 2 — vanished from under them.
 *
 * Only the chat's **own** view may speak for the chat's own channel. A person
 * looking at another conversation is reading that conversation's channel, which
 * says nothing at all about this call, and «no channel here» must not be read
 * as «the call was ended». The honest consequence, recorded rather than hidden:
 * somebody whose call is ended while they are looking elsewhere keeps hearing
 * it until they come back, because slice 2 has nothing outside the conversation
 * that watches. The bar that would is slice 3.
 *
 * `chatId` is therefore the chat the view was **read for**, not the chat that
 * is open. The two differ for as long as a read takes, because opening another
 * conversation does not clear what the hook is holding — and measured on
 * 2026-09-14, reading the argument instead hung up a live call on the way back
 * to the conversation it was in.
 */
export function voiceCallLostItsChannel(input: {
  /** The channel this client's call is in, or null when there is no call. */
  callChannelId: string | null;
  /** The chat that call belongs to. */
  callChatId: string | null;
  /** The chat this channel view was read for; null when nothing was read. */
  chatId: string | null;
  /** False until the first read has come back. */
  ready: boolean;
  /** False where this deployment has no voice tables. */
  supported: boolean;
  /** The channel this chat has now, or null. */
  channel: VoiceChannelSummary | null;
  /**
   * The type of the chat the call is in, or null while it is unknown.
   *
   * Added on 2026-09-18, and it is the whole of the defect below.
   */
  chatType: string | null;
}): boolean {
  // **Only a group's call is governed by the rail.**
  //
  // This rule was written when a `voice_channels` row could only belong to a
  // group, so «this chat's view says there is no such channel» could only mean
  // an administrator had ended it. One-to-one calls then put a row in every
  // private chat anybody calls in — and the rail does not list those, because
  // `voiceChannelRowOffer` answers `not_a_group`. So for a private chat the
  // view is `ready`, `supported`, and reports **no channel**, which read as
  // «an administrator ended it» and hung the call up seconds after it began.
  //
  // Measured on production from the SFU's own log: the participant left with
  // `reason: CLIENT_REQUEST_LEAVE` while ICE was healthy and on UDP, over and
  // over. Not a network failure — the application hanging up on itself.
  //
  // `null` is the safe answer while the type is unknown: hanging up a live
  // call because a read has not come back yet is the failure this guard
  // exists to prevent, one level up.
  if (input.chatType !== "group") return false;
  if (!input.callChannelId || !input.callChatId) return false;
  if (!input.ready || !input.supported) return false;
  if (input.chatId === null || input.chatId !== input.callChatId) return false;
  return input.channel === null || input.channel.id !== input.callChannelId;
}
