import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyMicrophoneError,
  microphoneRefusalText,
  orderVoiceParticipants,
  renameVoiceParticipants,
  resolveVoiceParticipants,
  voiceCapsuleState,
  voiceChannelRowOffer,
  voiceOccupancy,
  voiceOccupancyLabel,
  voiceParticipantsLine,
  type VoiceCallPhase,
  type VoiceChannelSummary,
  type VoiceParticipant,
} from "../../artifacts/kub/src/lib/voiceChannel.ts";

/**
 * The voice channel's rules, away from React and away from a browser.
 *
 * Slice 2 of docs/proposals/2026-09-13-voice-channels.md. What is pinned here
 * is everything the interface decides rather than renders: whether a row is
 * offered, what the capsule says in each of its states, how a participant list
 * is ordered, and what a refusal means to a person. Every one of those is a
 * sentence somebody reads, so a silent change to any of them is a change to the
 * product.
 */

const ME = "11111111-1111-4111-8111-000000000001";
const ANNA = "11111111-1111-4111-8111-000000000002";
const PETR = "11111111-1111-4111-8111-000000000003";

const CHANNEL: VoiceChannelSummary = {
  id: "33333333-3333-4333-8333-000000000001",
  name: "Общий голос",
  participantCount: 0,
  maxParticipants: 10,
};

const person = (userId: string, name: string, muted = false): VoiceParticipant => ({ userId, name, muted });

function capsule(over: Partial<Parameters<typeof voiceCapsuleState>[0]> = {}) {
  return voiceCapsuleState({
    channel: CHANNEL,
    phase: "idle",
    callChannelId: null,
    participants: [],
    selfId: ME,
    micMuted: false,
    canPublish: true,
    refusal: null,
    ...over,
  });
}

test("a voice row is offered to a member of a group, and to nobody else", () => {
  assert.deepEqual(voiceChannelRowOffer({ chatType: "group", myRole: "member", channel: CHANNEL }), {
    offered: true,
    channel: CHANNEL,
    full: false,
  });

  // Slice 2 is group-only. A channel has the same members and the same roles in
  // the database, which is exactly why the distinction has to be made here and
  // not by eye in the panel — D-169.
  assert.deepEqual(voiceChannelRowOffer({ chatType: "channel", myRole: "owner", channel: CHANNEL }), {
    offered: false,
    reason: "not_a_group",
  });
  assert.deepEqual(voiceChannelRowOffer({ chatType: "private", myRole: "member", channel: CHANNEL }), {
    offered: false,
    reason: "not_a_group",
  });

  // RLS says an onlooker cannot read the channel; the interface must not offer
  // a control the database would refuse.
  assert.deepEqual(voiceChannelRowOffer({ chatType: "group", myRole: null, channel: CHANNEL }), {
    offered: false,
    reason: "not_a_member",
  });

  assert.deepEqual(voiceChannelRowOffer({ chatType: "group", myRole: "admin", channel: null }), {
    offered: false,
    reason: "no_channel",
  });
});

test("a full channel keeps its row, and says so", () => {
  const full = { ...CHANNEL, participantCount: 10 };
  const verdict = voiceChannelRowOffer({ chatType: "group", myRole: "member", channel: full });
  assert.equal(verdict.offered, true);
  assert.equal(verdict.offered && verdict.full, true);

  // Over the cap — which the reconciler can produce for a moment when a webhook
  // and a reconciliation disagree — is still full rather than negative room.
  const over = voiceChannelRowOffer({ chatType: "group", myRole: "member", channel: { ...CHANNEL, participantCount: 11 } });
  assert.equal(over.offered && over.full, true);
});

test("occupancy prints the pair, and zero has its own sentence", () => {
  assert.equal(voiceOccupancyLabel(0, 10), "Никого нет");
  assert.equal(voiceOccupancyLabel(3, 10), "3 из 10");
  // The maximum can never read as smaller than the count, whatever the two rows
  // happen to say at the moment they are read.
  assert.equal(voiceOccupancyLabel(11, 10), "11 из 11");
  assert.equal(voiceOccupancyLabel(-2, 10), "Никого нет");
});

test("the count follows whichever list is drawn beneath it", () => {
  // Outside the call: the table's counter, because that is what the gateway
  // compares against the cap when the next press asks it for a token.
  assert.equal(voiceOccupancy({ inCall: false, rowCount: 3, listed: 3 }), 3);
  assert.equal(voiceOccupancy({ inCall: false, rowCount: 9, listed: 2 }), 9);

  // Inside it: the SDK's list, which is what is rendered directly under the
  // number. Photographed before this existed: «1 из 10» above two people.
  assert.equal(voiceOccupancy({ inCall: true, rowCount: 1, listed: 2 }), 2);
  assert.equal(voiceOccupancyLabel(voiceOccupancy({ inCall: true, rowCount: 1, listed: 2 }), 10), "2 из 10");
});

test("the participant list puts you first and then collates in Russian", () => {
  const list = [person(PETR, "Ёлка"), person(ANNA, "Егор"), person(ME, "Яна")];
  assert.deepEqual(
    orderVoiceParticipants(list, ME).map((entry) => entry.name),
    ["Яна", "Егор", "Ёлка"],
  );

  // Without a self id nobody is promoted, and «Ё» still sorts between «Е» and
  // «Ж» rather than after «Я» — which is what a bare localeCompare can give.
  assert.deepEqual(
    orderVoiceParticipants(list, null).map((entry) => entry.name),
    ["Егор", "Ёлка", "Яна"],
  );

  // Two people with one name still have one order, so a re-render cannot
  // shuffle them.
  const twins = [person("b", "Аня"), person("a", "Аня")];
  assert.deepEqual(orderVoiceParticipants(twins, null).map((entry) => entry.userId), ["a", "b"]);
  assert.deepEqual(orderVoiceParticipants([...twins].reverse(), null).map((entry) => entry.userId), ["a", "b"]);

  // The input is not mutated: the caller holds the SDK's own array.
  const source = [person(ANNA, "Егор"), person(ME, "Яна")];
  orderVoiceParticipants(source, ME);
  assert.deepEqual(source.map((entry) => entry.userId), [ANNA, ME]);
});

test("the one-line summary names two and counts the rest", () => {
  assert.equal(voiceParticipantsLine([], ME), "Никого нет");
  assert.equal(voiceParticipantsLine([person(ME, "Яна")], ME), "Вы");
  assert.equal(voiceParticipantsLine([person(ANNA, "Анна"), person(ME, "Яна")], ME), "Вы, Анна");
  assert.equal(
    voiceParticipantsLine([person(ANNA, "Анна"), person(ME, "Яна"), person(PETR, "Пётр"), person("d", "Дима")], ME),
    "Вы, Анна и ещё 2",
  );
  // Read by somebody who is not in the call at all: no «Вы» anywhere.
  assert.equal(voiceParticipantsLine([person(ANNA, "Анна"), person(PETR, "Пётр")], null), "Анна, Пётр");
});

test("names come from the chat's member list, with «Участник» as the floor", () => {
  const directory = new Map([[ANNA, "Анна Смирнова"], [PETR, "  "]]);

  assert.deepEqual(resolveVoiceParticipants([ANNA, PETR, "unknown"], directory), [
    { userId: ANNA, name: "Анна Смирнова", muted: false },
    { userId: PETR, name: "Участник", muted: false },
    { userId: "unknown", name: "Участник", muted: false },
  ]);

  // The token's name is a snapshot taken at mint time, so the current member
  // list wins wherever it has an entry and the token is only the fallback.
  assert.deepEqual(
    renameVoiceParticipants(
      [person(ANNA, "Аня (старое имя)", true), person("unknown", "Гость"), person("blank", "")],
      directory,
    ),
    [
      { userId: ANNA, name: "Анна Смирнова", muted: true },
      { userId: "unknown", name: "Гость", muted: false },
      { userId: "blank", name: "Участник", muted: false },
    ],
  );
});

test("the capsule is not drawn where there is no channel", () => {
  assert.equal(capsule({ channel: null }).visible, false);
  // Even mid-call: a chat with no channel of its own has nothing to say about
  // one, and slice 2 has no bar outside the conversation.
  assert.equal(capsule({ channel: null, phase: "connected", callChannelId: "elsewhere" }).visible, false);
});

test("at rest the capsule offers the way in, and says how full the channel is", () => {
  const view = capsule({ channel: { ...CHANNEL, participantCount: 3 } });
  assert.deepEqual(
    { visible: view.visible, title: view.title, detail: view.detail, action: view.action, label: view.actionLabel },
    { visible: true, title: "Общий голос", detail: "3 из 10", action: "join", label: "Присоединиться" },
  );
  assert.equal(view.mute, false);
  assert.equal(view.tone, "neutral");
});

test("a full channel shows itself and offers nothing", () => {
  const view = capsule({ channel: { ...CHANNEL, participantCount: 10 } });
  assert.equal(view.visible, true);
  assert.equal(view.detail, "Канал заполнен");
  assert.equal(view.action, null);
  assert.equal(view.actionLabel, null);
});

test("joining says so and stays escapable", () => {
  const view = capsule({ phase: "joining", callChannelId: CHANNEL.id });
  assert.equal(view.detail, "Подключаемся…");
  assert.equal(view.busy, true);
  // A join that hangs must have a way out that is not a reload.
  assert.equal(view.action, "cancel");
  assert.equal(view.actionLabel, "Отмена");
  assert.equal(view.mute, false);
});

test("connected: the people, the mute control and «Выйти»", () => {
  const view = capsule({
    phase: "connected",
    callChannelId: CHANNEL.id,
    participants: [person(ANNA, "Анна"), person(ME, "Яна")],
    micMuted: true,
  });
  assert.equal(view.title, "Общий голос");
  assert.equal(view.detail, "Вы, Анна");
  assert.equal(view.action, "leave");
  assert.equal(view.actionLabel, "Выйти");
  assert.equal(view.mute, true);
  assert.equal(view.muted, true);
  assert.equal(view.tone, "live");
  assert.equal(view.busy, false);
});

test("a token that may not publish gets no mute control, and is told why", () => {
  const view = capsule({
    phase: "connected",
    callChannelId: CHANNEL.id,
    participants: [person(ANNA, "Анна"), person(ME, "Яна")],
    canPublish: false,
  });
  // The SFU refuses the track whatever the interface draws, so a mute toggle
  // here would be a control with nothing behind it.
  assert.equal(view.mute, false);
  assert.equal(view.detail, "Только слушаете · Вы, Анна");
  assert.equal(view.action, "leave");
});

test("a dropped transport says so without ending the call", () => {
  const view = capsule({
    phase: "reconnecting",
    callChannelId: CHANNEL.id,
    participants: [person(ME, "Яна")],
  });
  assert.equal(view.detail, "Связь потеряна, восстанавливаем…");
  assert.equal(view.tone, "danger");
  assert.equal(view.busy, true);
  // Still leavable, and still showing the mute control: the call has not ended.
  assert.equal(view.action, "leave");
  assert.equal(view.mute, true);
});

test("a refusal is a state with words, and a way to try again", () => {
  const view = capsule({ phase: "failed", refusal: "Нет доступа к микрофону." });
  assert.equal(view.visible, true);
  assert.equal(view.detail, "Нет доступа к микрофону.");
  assert.equal(view.tone, "danger");
  assert.equal(view.action, "join");
  assert.equal(view.actionLabel, "Повторить");

  // A failure with no sentence is not a state the interface can show, so it
  // falls back to the ordinary offer rather than drawing an empty red line.
  assert.equal(capsule({ phase: "failed", refusal: null }).detail, "Никого нет");
});

test("a call in another chat's channel offers no control here", () => {
  for (const phase of ["joining", "connected", "reconnecting"] as VoiceCallPhase[]) {
    const view = capsule({ phase, callChannelId: "44444444-4444-4444-8444-000000000009" });
    assert.equal(view.visible, true, phase);
    assert.equal(view.detail, "Вы в другом голосовом канале", phase);
    // Joining from here would disconnect the call the person is in: a LiveKit
    // identity is unique per room and the second session kicks the first
    // (section 3.6). Offering it would be offering to hang up.
    assert.equal(view.action, null, phase);
    assert.equal(view.mute, false, phase);
  }
});

test("every microphone refusal is classified and has a sentence", () => {
  const named = (name: string) => Object.assign(new Error(name), { name });
  assert.equal(classifyMicrophoneError(named("NotAllowedError")), "permission_denied");
  assert.equal(classifyMicrophoneError(named("PermissionDeniedError")), "permission_denied");
  assert.equal(classifyMicrophoneError(named("SecurityError")), "permission_denied");
  assert.equal(classifyMicrophoneError(named("NotFoundError")), "no_device");
  assert.equal(classifyMicrophoneError(named("DevicesNotFoundError")), "no_device");
  assert.equal(classifyMicrophoneError(named("NotReadableError")), "no_device");
  assert.equal(classifyMicrophoneError(named("TrackStartError")), "no_device");
  assert.equal(classifyMicrophoneError(named("SomethingElse")), "unknown");
  assert.equal(classifyMicrophoneError("a string"), "unknown");
  assert.equal(classifyMicrophoneError(undefined), "unknown");

  for (const code of ["permission_denied", "no_device", "unsupported", "unknown"] as const) {
    const text = microphoneRefusalText(code);
    assert.match(text, /[А-Яа-яЁё]/, `${code} must be Russian`);
    assert.match(text, /\.$/, `${code} must be a sentence`);
  }
  // Four codes, four different sentences: a refusal a person cannot act on is
  // not much better than a silent failure.
  const sentences = new Set(
    (["permission_denied", "no_device", "unsupported", "unknown"] as const).map(microphoneRefusalText),
  );
  assert.equal(sentences.size, 4);
});
