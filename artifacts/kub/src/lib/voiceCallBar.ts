/**
 * The call, from anywhere in the application.
 *
 * ## The defect this exists for
 *
 * A call survives leaving the conversation it was started in — `useVoiceCall`
 * holds it as module state precisely so it does, and that was the right
 * decision. What did not exist was any way to see it or touch it from
 * elsewhere. Measured on 2026-09-18 by reading `voiceCapsuleState`:
 *
 *  - in a chat that owns a voice channel, the capsule says «Вы в другом
 *    голосовом чате» and **offers nothing at all** — no mute, no deafen, no
 *    leave, no way back;
 *  - in a chat that owns none — a private conversation, or any group made
 *    before channels existed — `if (!channel) return HIDDEN` fires first and
 *    the running call is **completely invisible**.
 *
 * So the microphone stayed open with nothing on screen saying so, and the only
 * way to reach it was to remember which conversation it was in and navigate
 * back. That is the state Discord's voice panel and Telegram's call bar both
 * exist to prevent.
 *
 * ## One rule, and why it is not «always show»
 *
 * The bar is drawn when a call is running **and the conversation that owns it
 * is not the one on screen**. Not because chrome is precious, but because the
 * capsule already stands in that conversation with the same three controls over
 * the same module state: two identical control sets on one screen is the
 * relabelled duplicate this project refuses, and on a phone the bar and the
 * capsule would occupy the same band one under the other.
 *
 * The handover is visible rather than a loss: on a computer both panes are on
 * screen, so opening the call's own chat moves the controls from the column to
 * the capsule in plain sight.
 *
 * ## What it is not
 *
 * It is not a second call state. Everything here is derived from the one
 * `VoiceCallState` the hook publishes, so the bar and the capsule cannot
 * disagree about whether the microphone is muted — they are two windows onto
 * one fact. And it holds no controls the capsule does not have: the same mute,
 * the same deafen, the same leave.
 *
 * This module imports nothing, so `node --test` can load it. A rule inside a
 * `"use client"` module is a rule with no test; `voiceChannel.ts` records why
 * at its own head.
 */

/** The phases this module knows, spelled as `VoiceCallState.phase` spells them. */
export type VoiceCallBarPhase = "idle" | "joining" | "connected" | "reconnecting" | "failed";

export interface VoiceCallBarInput {
  readonly phase: VoiceCallBarPhase;
  /** The room the call is in. `null` means there is no call to speak of. */
  readonly channelId: string | null;
  /** The chat that room belongs to — where pressing the bar goes. */
  readonly chatId: string | null;
  readonly channelName: string | null;
  /** That chat's own name, from the list the reader already has. */
  readonly chatName: string | null;
  /** The conversation on screen, so the bar can stand down where the capsule stands. */
  readonly selectedChatId: string | null;
  /**
   * Whether the conversation that owns this call draws a capsule for it.
   *
   * True for a group's voice room, which is the only thing the capsule knows
   * how to be. **False for a one-to-one call**, whose room belongs to a private
   * chat — `ChatWindow` reads a chat's channels only when its type is `group`,
   * so a private conversation has no capsule at all and never will.
   *
   * Without this the bar would keep the old rule and vanish in the one
   * conversation a private call is in, which is exactly the defect it was built
   * for: the microphone open and nothing on screen saying so. Required rather
   * than optional, for the reason `deafened` is — a caller that stops passing it
   * has silently gone back to that, and it has to be a type error.
   */
  readonly capsuleHere: boolean;
  /**
   * Whether this call is an outgoing ring nobody has answered yet.
   *
   * The caller joins the room the moment they press, so that an answer lands on
   * a connection that is already up — which means `phase` is `joining` and then
   * `connected` while the other person's telephone is still ringing. Left to
   * itself the bar would say «Вы в разговоре» about a call nobody has taken.
   * `VoiceCallRing` is the window onto that state and this is the other one
   * standing down, which is the same rule as the capsule's, one state earlier.
   */
  readonly ringing: boolean;
  readonly micMuted: boolean;
  readonly deafened: boolean;
  /** A moderator took the microphone away (D-221). */
  readonly speechRevoked: boolean;
  /**
   * Whether the bar is carrying a hold-to-talk control — which it does in
   * «Рация» and in no other mode. `lib/micGate.ts` decides that; this only
   * needs to know the answer, because it changes what there is room to say.
   *
   * Required rather than optional, for the reason `deafened` is: a caller that
   * stops passing it goes back to printing a name it has no room for, and that
   * has to be a type error rather than a silent `false`.
   */
  readonly talkControl: boolean;
}

export interface VoiceCallBarView {
  readonly visible: boolean;
  /** The room's name, which is the thing a person is looking for. */
  readonly room: string;
  /** The group it is in, or null when the reader has no name for it. */
  readonly where: string | null;
  /** One short line under the names. Never a number, never a status code. */
  readonly detail: string;
  readonly tone: "live" | "neutral" | "danger";
  /** Whether the three controls are drawn at all. A join in flight offers none. */
  readonly controls: boolean;
  readonly muted: boolean;
  readonly deafened: boolean;
  /**
   * The microphone is not this person's to press. The control stays drawn and
   * reads as unavailable, because removing it would leave the reader looking
   * for a control that used to be there.
   */
  readonly speechRevoked: boolean;
  /** Which chat the bar's body opens. Null means the bar's body does nothing. */
  readonly openChatId: string | null;
}

const HIDDEN: VoiceCallBarView = {
  visible: false,
  room: "",
  where: null,
  detail: "",
  tone: "neutral",
  controls: false,
  muted: false,
  deafened: false,
  speechRevoked: false,
  openChatId: null,
};

/**
 * What the bar says, or that there is nothing to say.
 *
 * `failed` is deliberately not a bar. A call that failed is not running, the
 * retry belongs where the person tried — the capsule, which offers «Повторить»
 * against the channel it knows — and a bar following somebody around the
 * application to report a failure they already saw is noise.
 */
export function voiceCallBarState(input: VoiceCallBarInput): VoiceCallBarView {
  const { phase, channelId, chatId } = input;
  if (channelId === null) return HIDDEN;
  if (phase !== "joining" && phase !== "connected" && phase !== "reconnecting") return HIDDEN;
  // A call that is still ringing is `VoiceCallRing`'s to speak for, everywhere.
  if (input.ringing) return HIDDEN;
  // The capsule is already in that conversation, with these same controls over
  // this same state — where there is one. A private chat has none, so a
  // one-to-one call keeps its bar in its own conversation as well.
  if (chatId !== null && chatId === input.selectedChatId && input.capsuleHere) return HIDDEN;

  const room = (input.channelName ?? "").trim() || "Голосовой канал";
  /**
   * The group's name, and the one state that has no room for it.
   *
   * A fourth control — hold to talk — takes about 90 points of a row that is
   * 360 in the chat-list column and 390 on a phone. Measured at 390 with the
   * name still printed: «Общий голос» survived and the line under it came out
   * «К · Вы в разговоре», one letter of «Команда проекта» before the separator.
   *
   * So it is dropped rather than cut. That is this file's own rule taken one
   * step further: the state is what somebody reads to know the call is up, the
   * room is what they are looking for, and the group is the fact that gets cut
   * — and a fact cut to one letter is not a shorter fact, it is noise. Pressing
   * the bar still goes there.
   */
  const named = input.talkControl ? null : (input.chatName ?? "").trim() || null;
  /**
   * And never the same fact twice.
   *
   * A one-to-one call's room **is** the person — `startVoiceRing` passes their
   * name as the room's, because «Звонок · Вы в разговоре» names nobody — and
   * `useChats` sets a private chat's own `name` to that same person. So without
   * this line the bar would print «Анна Смирнова» over «Анна Смирнова · Вы в
   * разговоре». Two lines saying one thing is the same waste the paragraph
   * above refuses, arrived at from the other direction.
   */
  const where = named === room ? null : named;

  if (phase === "joining") {
    return {
      ...HIDDEN,
      visible: true,
      room,
      where,
      detail: "Подключаемся…",
      tone: "neutral",
      // Nothing to mute yet, and nothing to leave: the join has its own cancel
      // in the capsule, and offering a second one here would race it.
      controls: false,
      openChatId: chatId,
    };
  }

  if (phase === "reconnecting") {
    return {
      visible: true,
      room,
      where,
      // «Соединение восстанавливается», not «Нет связи»: the SDK is trying, the
      // call has not ended, and telling somebody their call is gone while it is
      // coming back is the kind of sentence that makes them press leave.
      detail: "Соединение восстанавливается…",
      tone: "danger",
      // Kept: muting and leaving must work while the transport is down. Leaving
      // in particular — somebody who wants out of a call that is stuttering
      // must not have to wait for it to come back first.
      controls: true,
      muted: input.micMuted,
      deafened: input.deafened,
      speechRevoked: input.speechRevoked,
      openChatId: chatId,
    };
  }

  return {
    visible: true,
    room,
    where,
    detail: input.speechRevoked
      ? "Модератор выключил ваш микрофон"
      : input.deafened
        ? "Вы не слышите разговор"
        : input.micMuted
          ? "Микрофон выключен"
          : "Вы в разговоре",
    // `danger` only for the one state somebody else caused. Muting and
    // deafening are this person's own choices and the controls already show
    // them; painting a chosen state as a problem would be the interface
    // disagreeing with the reader.
    tone: input.speechRevoked ? "danger" : "live",
    controls: true,
    muted: input.micMuted,
    deafened: input.deafened,
    speechRevoked: input.speechRevoked,
    openChatId: chatId,
  };
}
