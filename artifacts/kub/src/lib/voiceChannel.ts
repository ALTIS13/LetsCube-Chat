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
 */

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
    full: input.channel.participantCount >= input.channel.maxParticipants,
  };
}

/**
 * How many are in, as the row says it.
 *
 * The maximum is always printed, because the number that decides whether a
 * person can join is the pair and not the count. «3 из 10» beside an empty
 * channel would read as a defect, so zero gets its own sentence.
 */
export function voiceOccupancyLabel(count: number, max: number): string {
  const present = Math.max(0, Math.floor(count));
  if (present === 0) return "Никого нет";
  return `${present} из ${Math.max(present, Math.floor(max))}`;
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
  /** The primary control, or null when the capsule offers none in this state. */
  action: "join" | "leave" | "cancel" | null;
  actionLabel: string | null;
  /** Whether the mute control is drawn, and how it reads. */
  mute: boolean;
  muted: boolean;
  /** Set while something is in flight, so the control can say so and refuse a second press. */
  busy: boolean;
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
  busy: false,
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
}): VoiceCapsuleView {
  const { channel, phase, callChannelId, participants, selfId, micMuted, canPublish, refusal } = input;
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
      muted: micMuted,
      busy: phase === "reconnecting",
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
      muted: micMuted,
      busy: true,
      tone: "neutral",
    };
  }

  if (!channel) return HIDDEN;

  // A call in some other chat's channel. Say so, offer nothing.
  if (callChannelId !== null && phase !== "idle" && phase !== "failed") {
    return {
      visible: true,
      title: channel.name,
      detail: "Вы в другом голосовом канале",
      action: null,
      actionLabel: null,
      mute: false,
      muted: micMuted,
      busy: false,
      tone: "neutral",
    };
  }

  const full = channel.participantCount >= channel.maxParticipants;

  if (phase === "failed" && refusal) {
    return {
      visible: true,
      title: channel.name,
      detail: refusal,
      action: "join",
      actionLabel: "Повторить",
      mute: false,
      muted: false,
      busy: false,
      tone: "danger",
    };
  }

  return {
    visible: true,
    title: channel.name,
    detail: full
      ? "Канал заполнен"
      : voiceOccupancyLabel(channel.participantCount, channel.maxParticipants),
    action: full ? null : "join",
    actionLabel: full ? null : "Присоединиться",
    mute: false,
    muted: false,
    busy: false,
    tone: "neutral",
  };
}
