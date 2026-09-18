import assert from "node:assert/strict";
import test from "node:test";

import {
  voiceCallBarState,
  type VoiceCallBarInput,
} from "../../artifacts/kub/src/lib/voiceCallBar.ts";

/**
 * When the application says a call is running, and what it offers.
 *
 * The defect this covers is the one a person actually hits: a call survives
 * leaving the conversation it started in — that is deliberate and correct — and
 * until 2026-09-18 nothing anywhere else on screen said so. Read off
 * `voiceCapsuleState`: in a chat that owns a voice channel the capsule said «Вы
 * в другом голосовом чате» and offered no control at all, and in a chat that
 * owns none it returned `HIDDEN` first, so the microphone stayed open with
 * nothing on screen about it.
 *
 * Every case below is about that: whether the bar appears, and whether it
 * offers the three controls or only says something.
 */

const CHANNEL = "33333333-3333-4333-8333-000000000001";
const CALL_CHAT = "22222222-2222-4222-8222-000000000001";
const OTHER_CHAT = "22222222-2222-4222-8222-000000000002";

function input(over: Partial<VoiceCallBarInput> = {}): VoiceCallBarInput {
  return {
    phase: "connected",
    channelId: CHANNEL,
    chatId: CALL_CHAT,
    channelName: "Общий голос",
    chatName: "Команда проекта",
    selectedChatId: OTHER_CHAT,
    // A group's room, which is the only kind the capsule knows how to be. The
    // one-to-one call's private conversation has none, and the cases for that
    // are at the foot of this file.
    capsuleHere: true,
    ringing: false,
    micMuted: false,
    deafened: false,
    speechRevoked: false,
    talkControl: false,
    ...over,
  };
}

test("no call, no bar — and «no call» is three different states", () => {
  assert.equal(voiceCallBarState(input({ channelId: null })).visible, false);
  assert.equal(voiceCallBarState(input({ phase: "idle" })).visible, false);
  // A call that failed is not a call that is running. The retry belongs where
  // the person tried — the capsule, which offers «Повторить» against the
  // channel it knows — and a bar following somebody around the application to
  // report a failure they already saw is noise.
  assert.equal(voiceCallBarState(input({ phase: "failed" })).visible, false);
});

test("the bar stands down in the conversation that owns the call, and nowhere else", () => {
  // The capsule is already there, with these same three controls over this same
  // state. Two identical control sets on one screen is the relabelled duplicate
  // this project refuses, and on a phone they would be one under the other.
  assert.equal(voiceCallBarState(input({ selectedChatId: CALL_CHAT })).visible, false);

  // Every other place: visible. Including no conversation open at all, which is
  // the phone's chat list and the computer's welcome screen.
  assert.equal(voiceCallBarState(input({ selectedChatId: OTHER_CHAT })).visible, true);
  assert.equal(voiceCallBarState(input({ selectedChatId: null })).visible, true);

  // And the mutation this exists for: comparing against the channel instead of
  // the chat, which would hide the bar nowhere and show it in the one place it
  // must not.
  assert.equal(voiceCallBarState(input({ selectedChatId: CHANNEL })).visible, true);
});

test("a call whose chat is unknown still gets a bar, and its body does nothing", () => {
  // `chatId` is null only in a state the hook should not produce, but the bar
  // must not vanish over it: a running microphone said nothing about is the
  // whole defect. What it must not do is offer a press that goes nowhere.
  const view = voiceCallBarState(input({ chatId: null }));
  assert.equal(view.visible, true);
  assert.equal(view.openChatId, null);
});

test("it names the room and the group, and presses through to the call's own chat", () => {
  const view = voiceCallBarState(input());
  assert.equal(view.room, "Общий голос");
  assert.equal(view.where, "Команда проекта");
  assert.equal(view.detail, "Вы в разговоре");
  assert.equal(view.tone, "live");
  assert.equal(view.controls, true);
  // Never the conversation on screen — that is where the reader already is.
  assert.equal(view.openChatId, CALL_CHAT);
});

test("a nameless room says «Голосовой канал», and a nameless group says nothing", () => {
  for (const channelName of [null, "", "   "]) {
    assert.equal(
      voiceCallBarState(input({ channelName })).room,
      "Голосовой канал",
      "a room with no name left the bar with an empty line where its name goes",
    );
  }
  for (const chatName of [null, "", "   "]) {
    assert.equal(
      voiceCallBarState(input({ chatName })).where,
      null,
      "an empty group name became a separator with nothing in front of it",
    );
  }
});

test("a join in flight offers no controls, because there is nothing yet to mute or leave", () => {
  const view = voiceCallBarState(input({ phase: "joining" }));
  assert.equal(view.visible, true);
  assert.equal(view.detail, "Подключаемся…");
  // The join has its own cancel in the capsule. A second one here would race
  // it, and a mute over a track that does not exist does nothing.
  assert.equal(view.controls, false);
  assert.equal(view.openChatId, CALL_CHAT);
});

test("a reconnecting call keeps its controls, because leaving must not wait for the transport", () => {
  const view = voiceCallBarState(input({ phase: "reconnecting", micMuted: true }));
  assert.equal(view.visible, true);
  assert.equal(view.tone, "danger");
  // The sentence says the SDK is trying rather than that the call is gone.
  // «Нет связи» over a call that is coming back is what makes somebody press
  // leave.
  assert.match(view.detail, /восстанавливается/);
  assert.ok(!view.detail.includes("Нет связи"));
  // The mutation this exists for: dropping the controls while the transport is
  // down. Somebody whose call is stuttering must be able to get out of it
  // without waiting for it to come back first.
  assert.equal(view.controls, true);
  assert.equal(view.muted, true);
});

test("a moderator's silence is the one state painted as a problem", () => {
  const revoked = voiceCallBarState(input({ speechRevoked: true }));
  assert.equal(revoked.detail, "Модератор выключил ваш микрофон");
  assert.equal(revoked.tone, "danger");
  // The control stays drawn and reads as unavailable: one that disappears is
  // read as a feature that went away.
  assert.equal(revoked.controls, true);
  assert.equal(revoked.speechRevoked, true);

  // The reader's own choices are not problems. Painting a chosen mute as danger
  // would be the interface disagreeing with the person who chose it.
  for (const over of [{ micMuted: true }, { deafened: true }]) {
    const chosen = voiceCallBarState(input(over));
    assert.equal(chosen.tone, "live", `${JSON.stringify(over)} was painted as a problem`);
  }
});

test("each of the four states has its own line, and no two share one", () => {
  const lines = [
    voiceCallBarState(input()).detail,
    voiceCallBarState(input({ micMuted: true })).detail,
    voiceCallBarState(input({ deafened: true })).detail,
    voiceCallBarState(input({ speechRevoked: true })).detail,
  ];
  assert.equal(new Set(lines).size, 4, `two states share a sentence: ${lines.join(" | ")}`);
  // And the order matters: somebody both deafened and silenced by a moderator
  // is told about the moderator, because that is the one they did not choose
  // and the one they cannot undo.
  assert.equal(
    voiceCallBarState(input({ deafened: true, micMuted: true, speechRevoked: true })).detail,
    "Модератор выключил ваш микрофон",
  );
});

test("a bar carrying a hold-to-talk control stops printing the group", () => {
  // A fourth control takes about 90 points of a row that is 360 in the column
  // and 390 on a phone. Measured at 390 with the name still printed, the line
  // under the room came out «К · Вы в разговоре» — one letter of «Команда
  // проекта» before the separator. This file's rule is that the group is the
  // fact allowed to be cut; a fact cut to one letter is not shorter, it is
  // noise.
  const plain = voiceCallBarState(input());
  assert.equal(plain.where, "Команда проекта");
  const talking = voiceCallBarState(input({ talkControl: true }));
  assert.equal(talking.where, null);
  // And nothing else moves: the room and the state are what the bar is for.
  assert.equal(talking.room, plain.room);
  assert.equal(talking.detail, plain.detail);
  assert.equal(talking.controls, plain.controls);
  assert.equal(talking.openChatId, plain.openChatId);
});

test("a one-to-one call keeps its bar in its own conversation, because nothing else is there", () => {
  // The rule the bar has always had is «stand down where the capsule stands».
  // A private chat has no capsule: `ChatWindow` reads a chat's voice channels
  // when its type is `group` and for nothing else, so the room a one-to-one
  // call lives in is never drawn under a private conversation's header. With
  // the old rule the call would be invisible in the one conversation it is in
  // — the microphone open and nothing on screen saying so, which is the exact
  // defect this bar was built for.
  const group = voiceCallBarState(input({ selectedChatId: CALL_CHAT, capsuleHere: true }));
  assert.equal(group.visible, false);

  const oneToOne = voiceCallBarState(input({ selectedChatId: CALL_CHAT, capsuleHere: false }));
  assert.equal(oneToOne.visible, true);
  assert.equal(oneToOne.controls, true);

  // And `capsuleHere` changes nothing anywhere else: it is a statement about
  // one conversation, not a second switch for the whole bar.
  assert.equal(voiceCallBarState(input({ selectedChatId: OTHER_CHAT, capsuleHere: false })).visible, true);
  assert.equal(voiceCallBarState(input({ selectedChatId: OTHER_CHAT, capsuleHere: true })).visible, true);
});

test("a call still ringing at the other end gets no bar anywhere", () => {
  // The caller joins the room the moment they press, so that an answer lands on
  // a connection that is already up. That makes `phase` `joining` and then
  // `connected` while the other person's telephone is still ringing, and left
  // to itself the bar would say «Вы в разговоре» about a call nobody has taken.
  // `VoiceCallRing` is the window onto that state; this is the other one
  // standing down.
  assert.equal(voiceCallBarState(input({ ringing: true, phase: "connected" })).visible, false);
  assert.equal(voiceCallBarState(input({ ringing: true, phase: "joining" })).visible, false);
  // Everywhere, not only in the call's own chat: the ring card is fixed to the
  // window and is on screen whichever conversation is open.
  assert.equal(voiceCallBarState(input({ ringing: true, selectedChatId: null })).visible, false);
  assert.equal(
    voiceCallBarState(input({ ringing: true, selectedChatId: OTHER_CHAT, capsuleHere: false })).visible,
    false,
  );
  // And the moment it is answered the bar takes over, with everything on it.
  const answered = voiceCallBarState(input({ ringing: false }));
  assert.equal(answered.visible, true);
  assert.equal(answered.controls, true);
});

test("the bar never prints the same fact twice", () => {
  // A one-to-one call's room is the person: `startVoiceRing` passes their name
  // as the room's, because «Звонок · Вы в разговоре» names nobody. And
  // `useChats` sets a private chat's own `name` to that same person. Without
  // the rule the bar would print «Анна Смирнова» over «Анна Смирнова · Вы в
  // разговоре».
  const view = voiceCallBarState(input({ channelName: "Анна Смирнова", chatName: "Анна Смирнова" }));
  assert.equal(view.room, "Анна Смирнова");
  assert.equal(view.where, null);
  assert.equal(view.detail, "Вы в разговоре");
  // A group whose name merely resembles the room's keeps both, because they
  // are two different facts. The comparison is equality, not similarity.
  assert.equal(
    voiceCallBarState(input({ channelName: "Общий голос", chatName: "Общий голос 2" })).where,
    "Общий голос 2",
  );
});
