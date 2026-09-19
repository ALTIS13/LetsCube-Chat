/**
 * The conversation you are already in, on the device that is not in your hand.
 *
 * ## What was asked for, and what was already true
 *
 * The owner asked for Discord's behaviour on 2026-09-18: open the application
 * on a phone while a voice session is running in some group, and be offered to
 * join **from the phone instead of from the computer** — never from both at
 * once. `docs/proposals/2026-09-18-one-to-one-calls.md` §4b measured the three
 * halves of that and found two of them already true:
 *
 *  - nothing binds a room to whoever made it (`created_by` is written and never
 *    read to decide anything), so a room outlives the person who opened it;
 *  - `voice_participants`'s primary key is `(channel_id, user_id)`, so one
 *    person **cannot** be represented twice in one room, whatever any client
 *    does.
 *
 * What was missing is only that the second device does not *know*.
 * `voice_participants` is `SELECT`-able by any member of the chat and is in the
 * `supabase_realtime` publication, so a device can see that **its own user id**
 * is a participant of room C while its own call state says it is connected to
 * nothing. Those two facts together are «вы в этом разговоре на другом
 * устройстве», and they need no new table, no device identity and no round trip
 * to ask. This module is that pair of facts turned into one answer.
 *
 * ## Which is why nothing here is a second source
 *
 * The rows are the same rows the channel rail already lists occupants from, and
 * the room is the same `voice_channels` row the capsule already names. §4b
 * refuses «a banner that asked the server its own question», and this does not
 * ask one: it reads the answer that exists, for one person, without a chat to
 * scope it to.
 *
 * ## The transport rule this deliberately does not lean on
 *
 * LiveKit is documented to disconnect an existing participant when a second
 * connection arrives with the same identity, and the identity this product
 * mints is the user id — read off the SFU's own log. **That behaviour is not
 * verified on this deployment**, so the design must not depend on it: the
 * client refuses to offer a plain join for a room it already believes itself to
 * be in elsewhere, and offers to *move* instead. If the SFU's rule is what the
 * documentation says, the move is belt and braces; if it is not, the interface
 * is the thing that keeps the rule.
 *
 * That is also why the words below are a forecast rather than a report. Nothing
 * here ever says the other device **was** disconnected — only that the call is
 * moving, which is true of this device whatever the SFU does with the other.
 *
 * This module imports nothing, so `node --test` can load it. A decision inside
 * a `"use client"` module is a decision with no test; `voiceChannel.ts` records
 * why at its own head, and `micGate.ts`, `voiceRing.ts`, `callRecord.ts` and
 * `sessionDevices.ts` all follow it.
 */

/** The phases this module knows, spelled as `VoiceCallState.phase` spells them. */
export type VoiceElsewherePhase = "idle" | "joining" | "connected" | "reconnecting" | "failed";

/** One row of `voice_participants`, as the reader selects it. */
export interface VoiceParticipantRow {
  readonly channelId: string;
  readonly userId: string;
}

/**
 * A room the reader has a name for, from `voice_channels`.
 *
 * `ringing` and `archived` are carried rather than assumed because both are
 * states in which the room is **not** a conversation to move into, and each is
 * the kind of thing that would otherwise be decided in a hook. The ring rule
 * itself stays in `lib/voiceRing.ts`, which owns it; this only needs the answer.
 */
export interface VoiceElsewhereRoom {
  readonly channelId: string;
  readonly chatId: string;
  readonly name: string;
  readonly archived: boolean;
  /**
   * An outgoing call nobody has answered yet.
   *
   * The caller joins the room the moment they press, so a device with a ring in
   * flight is a participant of a room in which no conversation is happening.
   * Without this the banner would say «вы в разговоре» about a telephone that
   * is still ringing — the same sentence `readVoicePresenceRows` refuses to put
   * on a chat row, arrived at from the other side.
   */
  readonly ringing: boolean;
}

/**
 * The words, in one place, so three surfaces cannot say this differently.
 *
 * The bar, the capsule and the rail are three windows onto one fact, and the
 * rule the call bar was built under applies here unchanged: neither window
 * invents a word of its own.
 */
export const VOICE_ELSEWHERE_STATE = "На другом устройстве";
/**
 * What the press does, said before it is pressed.
 *
 * Discord simply moves you and says so afterwards. This says it first, because
 * moving is not free: it takes the conversation away from a device that may be
 * the one with the good microphone, in front of the person being talked to. The
 * sentence must not promise that both devices can listen, because they cannot —
 * and it must not claim the other device has already gone, because this client
 * cannot see that happen.
 */
export const VOICE_ELSEWHERE_PROMISE = "Разговор перейдёт сюда и прервётся там";
export const VOICE_ELSEWHERE_MOVE = "Перейти сюда";
/** What the capsule and the information panel say in their one line of room. */
export const VOICE_ELSEWHERE_DETAIL = `${VOICE_ELSEWHERE_STATE} · ${VOICE_ELSEWHERE_PROMISE}`;

/**
 * Is this device connected to, or committed to, a room of its own?
 *
 * `joining` counts. The device is not connected yet, but it has left whatever it
 * was in and is on its way somewhere — and counting it is what makes the banner
 * disappear the instant «Перейти сюда» is pressed, rather than a round trip
 * later when a webhook happens to land. `failed` deliberately does not count:
 * `VoiceCallState` keeps `channelId` on a join that failed, and a room this
 * device never reached is not a room it is in.
 */
function callRunsHere(phase: VoiceElsewherePhase): boolean {
  return phase === "joining" || phase === "connected" || phase === "reconnecting";
}

/** The room this device holds, or null when it holds none. */
function connectedHere(phase: VoiceElsewherePhase, channelId: string | null): string | null {
  return callRunsHere(phase) ? channelId : null;
}

/**
 * The room I am in on a device that is not this one, or null.
 *
 * §4b's `inCallElsewhere(myUserId, participantRows, localCallChannelId)`, with
 * the room's own row folded in so that the caller gets something it can act on
 * rather than an id it would have to go and resolve.
 *
 * **A room this client has no row for is not an answer.** Joining needs a chat
 * id, and a participant row left behind by a room that has since been removed
 * would otherwise draw a banner offering to move into nothing. Silence is the
 * honest response to «I am apparently somewhere, and I cannot tell you where».
 *
 * **Several rooms is a real state and it is answered deterministically.** The
 * table can hold one person in two rooms — the primary key only forbids two of
 * them in *one* room — and a client that crashed mid-move can leave exactly
 * that. The lowest channel id wins, for the reason `chatVoicePresence` breaks
 * its ties by name: an answer that changes between two reads saying the same
 * thing is a banner that flickers between two rooms.
 */
export function voiceElsewhere(input: {
  readonly myUserId: string | null;
  readonly participants: readonly VoiceParticipantRow[];
  readonly localPhase: VoiceElsewherePhase;
  readonly localChannelId: string | null;
  readonly rooms: readonly VoiceElsewhereRoom[];
}): VoiceElsewhereRoom | null {
  const { myUserId, participants, rooms } = input;
  if (typeof myUserId !== "string" || myUserId === "") return null;
  const here = connectedHere(input.localPhase, input.localChannelId);

  const known = new Map<string, VoiceElsewhereRoom>();
  for (const room of rooms) {
    if (!room || typeof room.channelId !== "string" || room.channelId === "") continue;
    // Not a conversation to move into: a room that was removed, and a room
    // whose only occupant is a caller waiting to be answered.
    if (room.archived || room.ringing) continue;
    if (typeof room.chatId !== "string" || room.chatId === "") continue;
    known.set(room.channelId, room);
  }

  let found: VoiceElsewhereRoom | null = null;
  for (const row of participants) {
    if (!row || row.userId !== myUserId) continue;
    if (row.channelId === here) continue;
    const room = known.get(row.channelId);
    if (!room) continue;
    if (found === null || room.channelId < found.channelId) found = room;
  }
  return found;
}

/**
 * Whether the way into this room, from here, is a move rather than a join.
 *
 * The one question the capsule, the channel rail and the information panel each
 * ask before they draw «Присоединиться» — asked in one place so that all three
 * change together. A device already in a room elsewhere must never be offered a
 * plain join: that is the press that would put one person in one room twice,
 * and the press that takes the conversation off their other device without
 * saying so.
 */
export function voiceJoinIsAMove(
  channelId: string | null,
  elsewhere: VoiceElsewhereRoom | null,
): boolean {
  if (elsewhere === null) return false;
  if (typeof channelId !== "string" || channelId === "") return false;
  return channelId === elsewhere.channelId;
}

/** What the banner draws, or that there is nothing to draw. */
export interface VoiceElsewhereBarView {
  readonly visible: boolean;
  /** The room's name, which is the thing a person is looking for. */
  readonly room: string;
  /** The group it is in, or null when the reader has no separate name for it. */
  readonly where: string | null;
  /** The state, in the same slot the call bar puts its state in. */
  readonly detail: string;
  /** What the press will do, said before it is pressed. */
  readonly promise: string;
  readonly actionLabel: string;
  /** Everything `joinVoiceChannel` needs, so the press has no lookup of its own. */
  readonly channelId: string | null;
  readonly chatId: string | null;
  readonly channelName: string | null;
}

const HIDDEN: VoiceElsewhereBarView = {
  visible: false,
  room: "",
  where: null,
  detail: "",
  promise: "",
  actionLabel: "",
  channelId: null,
  chatId: null,
  channelName: null,
};

/**
 * What the banner says, or that there is nothing to say.
 *
 * **It stands down whenever a call is running here**, and that is the whole of
 * its relationship with `VoiceCallBar`. Two bars are mounted in the same two
 * places — the foot of the chat list column on a computer, a band across the
 * top on a phone — and at most one of them may ever be on screen, because they
 * say opposite things about the same person: one is about a call this device is
 * in, the other about a call it is not.
 *
 * That gate is separate from `voiceElsewhere`'s own on purpose. The rail and
 * the capsule still need the truthful answer while a call is running here — a
 * person in room X on this device and room Y on another must not be offered a
 * plain join for Y either — so the exclusion belongs to the banner rather than
 * to the fact.
 */
export function voiceElsewhereBarState(input: {
  readonly elsewhere: VoiceElsewhereRoom | null;
  /** That chat's own name, from the list the reader already has. */
  readonly chatName: string | null;
  readonly localPhase: VoiceElsewherePhase;
  /**
   * Whether the conversation on screen already offers this room's move itself.
   *
   * `VoiceCallBar`'s `capsuleHere`, one state sideways, and the same
   * approximation: a group speaks for its own rooms — through the capsule where
   * one room makes the capsule name it, through the rail's row where several
   * do — and a private conversation has neither and never will. Standing down
   * there is the rule that keeps «Перейти сюда» from appearing twice on one
   * screen with the same words under it, which is the relabelled duplicate this
   * product refuses.
   *
   * Required rather than optional, for the reason `deafened` is required of the
   * capsule: a caller that stops passing it draws that duplicate silently.
   */
  readonly spokenForHere: boolean;
}): VoiceElsewhereBarView {
  const { elsewhere } = input;
  if (elsewhere === null) return HIDDEN;
  // A call here is `VoiceCallBar`'s to speak for, everywhere.
  if (callRunsHere(input.localPhase)) return HIDDEN;
  if (input.spokenForHere) return HIDDEN;

  const room = elsewhere.name.trim() || "Голосовой канал";
  const named = (input.chatName ?? "").trim() || null;
  /**
   * And never the same fact twice.
   *
   * A one-to-one call's room carries the other person's name, and `useChats`
   * sets a private chat's own name to that same person — so without this the
   * banner would print «Анна Смирнова» over «Анна Смирнова · На другом
   * устройстве». The call bar refuses the same duplicate for the same reason.
   */
  const where = named === room ? null : named;

  return {
    visible: true,
    room,
    where,
    detail: VOICE_ELSEWHERE_STATE,
    promise: VOICE_ELSEWHERE_PROMISE,
    actionLabel: VOICE_ELSEWHERE_MOVE,
    channelId: elsewhere.channelId,
    chatId: elsewhere.chatId,
    channelName: elsewhere.name,
  };
}
