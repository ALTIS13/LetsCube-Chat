import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyMicrophoneError,
  classifyVoiceChannelWriteError,
  microphoneRefusalText,
  newVoiceChannelDraft,
  orderVoiceParticipants,
  renameVoiceParticipants,
  resolveVoiceParticipants,
  voiceCallLostItsChannel,
  voiceCapsuleState,
  voiceChannelControl,
  voiceChannelEndConfirmation,
  voiceChannelEndRefusalText,
  voiceChannelRowOffer,
  voiceChannelStartRefusalText,
  voiceOccupancy,
  voiceOccupancyLabel,
  voiceParticipantsLine,
  type VoiceCallPhase,
  type VoiceChannelSummary,
  type VoiceChannelWriteRefusal,
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
    outputDeviceRefused: false,
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
  assert.equal(view.detail, "Мест больше нет");
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

/**
 * The output device, and the one state where the capsule has to contradict the
 * settings screen.
 *
 * `setOutputDevice` answers `false` where the browser would not move the call's
 * audio — Firefox has no `setSinkId` — and a settings screen showing a headset
 * selected while the call comes out of the laptop is the failure this exists to
 * prevent. The mark belongs to a call that is running **here**: a capsule
 * offering the way in has no audio that could have failed to move, and one
 * speaking for a call in another chat's channel is already saying it cannot act
 * for it.
 */
test("a refused output device is marked on the call it belongs to and nowhere else", () => {
  const inCall = { phase: "connected" as VoiceCallPhase, callChannelId: CHANNEL.id, participants: [person(ME, "Яна")] };
  assert.equal(capsule({ ...inCall, outputDeviceRefused: true }).outputRefused, true);
  assert.equal(capsule({ ...inCall, outputDeviceRefused: false }).outputRefused, false);
  // A dropped transport is still this call, and the headset is still not
  // carrying it.
  assert.equal(
    capsule({ ...inCall, phase: "reconnecting", outputDeviceRefused: true }).outputRefused,
    true,
  );

  // Everywhere else the flag is refused, whatever the state says, because there
  // is no audio here to have gone to the wrong place.
  assert.equal(capsule({ outputDeviceRefused: true }).outputRefused, false);
  assert.equal(capsule({ phase: "joining", callChannelId: CHANNEL.id, outputDeviceRefused: true }).outputRefused, false);
  assert.equal(
    capsule({ phase: "connected", callChannelId: "44444444-4444-4444-8444-000000000009", outputDeviceRefused: true })
      .outputRefused,
    false,
  );
  assert.equal(
    capsule({ phase: "failed", refusal: "Нет доступа к микрофону.", outputDeviceRefused: true }).outputRefused,
    false,
  );
  assert.equal(capsule({ channel: null, outputDeviceRefused: true }).outputRefused, false);
});

test("a call in another chat's channel offers no control here", () => {
  for (const phase of ["joining", "connected", "reconnecting"] as VoiceCallPhase[]) {
    const view = capsule({ phase, callChannelId: "44444444-4444-4444-8444-000000000009" });
    assert.equal(view.visible, true, phase);
    assert.equal(view.detail, "Вы в другом голосовом чате", phase);
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

/* -------------------------------------------------------------------------- */
/* Starting a voice chat, and ending it. Telegram's mechanic, slice 2's table. */
/* -------------------------------------------------------------------------- */

const control = (over: Partial<Parameters<typeof voiceChannelControl>[0]> = {}) =>
  voiceChannelControl({
    chatType: "group",
    myRole: "admin",
    hasChannel: false,
    supported: true,
    ready: true,
    ...over,
  });

test("only an administrator of a group may start a voice chat or end one", () => {
  // The whole mechanic in two lines: no channel and you may make one; a channel
  // and you may end it.
  assert.equal(control({ hasChannel: false }), "start");
  assert.equal(control({ hasChannel: true }), "end");
  assert.equal(control({ myRole: "owner", hasChannel: false }), "start");
  assert.equal(control({ myRole: "owner", hasChannel: true }), "end");

  // A member joins what exists and creates nothing. `is_chat_admin(chat_id)` is
  // both the USING and the WITH CHECK of the one policy that lets a client
  // write this table, so either control offered here is a control the database
  // will refuse.
  assert.equal(control({ myRole: "member", hasChannel: false }), null);
  assert.equal(control({ myRole: "member", hasChannel: true }), null);

  // And an onlooker gets nothing at all, with or without a channel.
  assert.equal(control({ myRole: null, hasChannel: false }), null);
  assert.equal(control({ myRole: null, hasChannel: true }), null);

  // Slice 2 is group-only, exactly as `voiceChannelRowOffer` is — D-169 is the
  // register entry for this panel calling a channel a group.
  for (const chatType of ["channel", "private", "saved", ""]) {
    assert.equal(control({ chatType, myRole: "owner" }), null, chatType);
  }
});

test("nothing is offered before the first read, or where the tables are absent", () => {
  // «This group has no channel» and «I have not looked yet» are the same shape
  // in the hook's state, and offering to start one in the second case flashes a
  // control that is about to be wrong.
  assert.equal(control({ ready: false }), null);
  assert.equal(control({ ready: false, hasChannel: true }), null);

  // A deployment whose voice tables are absent is a state the client half is
  // built to pass through silently. A start control there ends in a Postgres
  // error and nothing else.
  assert.equal(control({ supported: false }), null);
  assert.equal(control({ supported: false, hasChannel: true }), null);
});

test("a new voice chat is named, and holds what the SFU will let it hold", () => {
  const draft = newVoiceChannelDraft();
  assert.equal(draft.name, "Общий голос");
  // Ten is the SFU's own room limit and what the one existing row carries.
  // Asking for more would write a number the server will not honour.
  assert.equal(draft.maxParticipants, 10);
  // A fresh object each time: the caller spreads it into an insert.
  assert.notEqual(newVoiceChannelDraft(), draft);
});

test("a refused write is classified from what PostgREST actually sends", () => {
  // RLS, as the insert is refused.
  assert.equal(
    classifyVoiceChannelWriteError({
      code: "42501",
      message: 'new row violates row-level security policy for table "voice_channels"',
    }),
    "forbidden",
  );
  // The same refusal from a deployment that answers with a message and no code.
  assert.equal(
    classifyVoiceChannelWriteError({ message: "permission denied for table voice_channels" }),
    "forbidden",
  );
  assert.equal(classifyVoiceChannelWriteError({ code: "PGRST301" }), "forbidden");

  // The three shapes of «this deployment has no voice tables», the same ones
  // `useVoiceChannel` already treats that way.
  for (const code of ["42P01", "PGRST205", "PGRST202"]) {
    assert.equal(classifyVoiceChannelWriteError({ code }), "unsupported", code);
  }

  assert.equal(classifyVoiceChannelWriteError({ code: "23505" }), "already");

  // Nothing answered. supabase-js reports a fetch that never arrived as an
  // error with no code, and the two engines word it differently.
  assert.equal(classifyVoiceChannelWriteError({ message: "TypeError: Failed to fetch" }), "network");
  assert.equal(classifyVoiceChannelWriteError({ message: "Load failed" }), "network");
  assert.equal(classifyVoiceChannelWriteError({ message: "NetworkError when attempting to fetch" }), "network");

  // Anything else, including nothing at all.
  assert.equal(classifyVoiceChannelWriteError({ code: "22P02", message: "invalid input syntax" }), "unknown");
  assert.equal(classifyVoiceChannelWriteError(null), "unknown");
  assert.equal(classifyVoiceChannelWriteError(undefined), "unknown");
  assert.equal(classifyVoiceChannelWriteError("something"), "unknown");
});

test("a failed start and a failed end each have their own sentence", () => {
  const codes: VoiceChannelWriteRefusal[] = ["forbidden", "unsupported", "already", "network", "unknown"];

  for (const code of codes) {
    for (const text of [voiceChannelStartRefusalText(code), voiceChannelEndRefusalText(code)]) {
      assert.match(text, /[А-Яа-яЁё]/, `${code} must be Russian`);
      assert.match(text, /\.$/, `${code} must be a sentence`);
      // The same rule `voiceGatewayRefusalText` obeys: a number is the one
      // thing the reader can do nothing with.
      assert.ok(!/\d/.test(text), `${code} must not print a code: ${text}`);
    }
  }

  // Five codes, five sentences, in each direction.
  assert.equal(new Set(codes.map(voiceChannelStartRefusalText)).size, 5);
  assert.equal(new Set(codes.map(voiceChannelEndRefusalText)).size, 5);

  // And starting is not ending. «Не удалось начать» after pressing «Завершить»
  // would send the reader looking for a mistake they did not make.
  for (const code of ["forbidden", "already", "unknown"] as VoiceChannelWriteRefusal[]) {
    assert.notEqual(
      voiceChannelStartRefusalText(code),
      voiceChannelEndRefusalText(code),
      `${code} says the same thing both ways`,
    );
  }
  // The two that genuinely are the same fact about the world, and say so.
  assert.equal(voiceChannelStartRefusalText("network"), voiceChannelEndRefusalText("network"));
  assert.equal(voiceChannelStartRefusalText("unsupported"), voiceChannelEndRefusalText("unsupported"));
});

test("the question before an end says that it reaches other people", () => {
  const words = voiceChannelEndConfirmation();
  assert.match(words.title, /\?$/);
  // The one thing this question must not be coy about: pressing it disconnects
  // everybody who is in the call. A confirmation that only says «удалить» is a
  // confirmation of a different act.
  assert.match(words.description.toLocaleLowerCase("ru-RU"), /отключен/);
  assert.match(words.aftermath.toLocaleLowerCase("ru-RU"), /у всех/);
  for (const line of [words.title, words.description, words.aftermath, words.confirmLabel, words.busyLabel]) {
    assert.match(line, /[А-Яа-яЁё]/);
  }
  assert.notEqual(words.confirmLabel, words.busyLabel);
});

const lost = (over: Partial<Parameters<typeof voiceCallLostItsChannel>[0]> = {}) =>
  voiceCallLostItsChannel({
    callChannelId: CHANNEL.id,
    callChatId: "22222222-2222-4222-8222-000000000001",
    chatId: "22222222-2222-4222-8222-000000000001",
    ready: true,
    supported: true,
    channel: CHANNEL,
    ...over,
  });

test("a call whose channel was ended has to end, and one whose channel is elsewhere does not", () => {
  // The ordinary case: the channel is still there.
  assert.equal(lost(), false);

  // An administrator ended it. Without this the capsule — the only «Выйти»
  // there is in slice 2 — disappears from under somebody still connected.
  assert.equal(lost({ channel: null }), true);
  // Ended and immediately started again is a different channel, not this one.
  assert.equal(lost({ channel: { ...CHANNEL, id: "33333333-3333-4333-8333-00000000000f" } }), true);

  // No call at all.
  assert.equal(lost({ callChannelId: null, callChatId: null, channel: null }), false);

  // Looking at another conversation. That conversation's view says nothing
  // about this call's channel, and «no channel here» must never be read as «the
  // call was ended» — which is what hanging up on a person reading a different
  // chat would be.
  assert.equal(lost({ chatId: "22222222-2222-4222-8222-000000000002", channel: null }), false);
  assert.equal(lost({ chatId: null, channel: null }), false);

  // The measured version of the same mistake, 2026-09-14: coming back to the
  // conversation the call is in, while the view still holds the **other**
  // conversation's channel, because opening a chat does not clear what the hook
  // is holding until the new read lands. Passing the open chat's id here
  // instead of the id the view was read for hung up a live call, and
  // `tests/e2e/voice-call.spec.ts` caught it as «the call survives a change of
  // conversation».
  assert.equal(
    lost({
      chatId: "22222222-2222-4222-8222-000000000002",
      channel: { ...CHANNEL, id: "33333333-3333-4333-8333-000000000002", name: "Склад" },
    }),
    false,
  );

  // And neither an unfinished first read nor a deployment without the tables is
  // evidence that anything was ended.
  assert.equal(lost({ ready: false, channel: null }), false);
  assert.equal(lost({ supported: false, channel: null }), false);
});
