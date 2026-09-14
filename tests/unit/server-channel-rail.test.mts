import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  CHANNEL_RAIL_WIDTH,
  CONVERSATION_MIN_WIDTH,
  GENERAL_CHANNEL_ID,
  categoryFromRow,
  channelsShownWhileCollapsed,
  currentTextChannelId,
  paneFitsChannelRail,
  CHANNEL_RAIL_RETRY,
  CHANNEL_RAIL_UNREADABLE,
  railIsOffered,
  seatLabel,
  textChannelFromTopic,
  topicIdForChannel,
  capsuleNamesARoom,
  voiceChannelForCall,
  voiceChannelFromRow,
  withGeneralChannel,
} from "../../artifacts/kub/src/lib/channelRail.ts";
import {
  buildChannelTree,
  canManageChannels,
  flattenChannelTree,
  voiceJoinVerdict,
  type ServerChannel,
} from "../../artifacts/kub/src/lib/serverChannels.ts";
import { voiceCallLostItsChannel } from "../../artifacts/kub/src/lib/voiceChannel.ts";

/**
 * The channel rail's rules, away from React and away from a browser.
 *
 * `serverChannels.ts` is tested by whoever owns it; what is pinned here is the
 * part that only exists because the rail is drawn inside **this** product: how
 * two tables with different columns become one list, how a conversation with no
 * row of its own is still a row in the rail, which of several rooms the call
 * capsule speaks for, and whether there is room for a column.
 *
 * The load-bearing one is `voiceChannelForCall`, and the last section of this
 * file tests it through `voiceCallLostItsChannel` rather than on its own —
 * because the cost of getting it wrong is not a mislabelled capsule, it is a
 * live call hung up by an interface that mistook «this is not the room I am
 * looking at» for «an administrator ended it».
 */

const CHAT = "22222222-2222-4222-8222-000000000001";
const AT = "2026-09-14T09:00:00.000Z";

function topicRow(id: string, name: string, extra: Record<string, unknown> = {}) {
  return { id, name, emoji: null, is_general: false, position: 0, archived: false, category_id: null, created_at: AT, ...extra };
}

function voiceRow(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    position: 0,
    max_participants: 10,
    speak_role: "member",
    participant_count: 0,
    archived: false,
    category_id: null,
    created_at: AT,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Rows to channels
// ---------------------------------------------------------------------------

test("a topic row becomes a text channel, emoji and general flag included", () => {
  const channel = textChannelFromTopic(topicRow("t1", "дизайн", { emoji: "🎨", position: 3 }));
  assert.equal(channel.kind, "text");
  assert.equal(channel.name, "дизайн");
  assert.equal(channel.emoji, "🎨");
  assert.equal(channel.position, 3);
  assert.equal(channel.isGeneral, false);
  assert.equal(channel.categoryId, null);
});

test("a voice row becomes a room, with its seats and its counter", () => {
  const room = voiceChannelFromRow(voiceRow("v1", "Общая комната", { max_participants: 6, participant_count: 2 }));
  assert.equal(room.kind, "voice");
  assert.equal(room.maxParticipants, 6);
  assert.equal(room.participantCount, 2);
  assert.equal(room.speakRole, "member");
});

test("a speak_role the enum does not name becomes null, so the fallback is deliberate", () => {
  // The column is `chat_member_role`, but the value arrived as a string through
  // PostgREST. `canSpeakInChannel` treats an unknown role as «member»; passing
  // the string through would make that silent rather than chosen.
  assert.equal(voiceChannelFromRow(voiceRow("v1", "Комната", { speak_role: "moderator" })).speakRole, null);
  assert.equal(voiceChannelFromRow(voiceRow("v1", "Комната", { speak_role: "owner" })).speakRole, "owner");
});

test("a missing position is zero rather than NaN, in both kinds", () => {
  assert.equal(textChannelFromTopic({ id: "t1", name: "n" }).position, 0);
  assert.equal(voiceChannelFromRow({ id: "v1", name: "n" }).position, 0);
  assert.equal(categoryFromRow({ id: "c1", name: "n" }).position, 0);
});

test("archived is carried through rather than filtered here", () => {
  // One place drops archived rows — `buildChannelTree`. Two places deciding the
  // same thing is how they come to disagree.
  assert.equal(textChannelFromTopic(topicRow("t1", "n", { archived: true })).archived, true);
  assert.equal(voiceChannelFromRow(voiceRow("v1", "n", { archived: true })).archived, true);
});

// ---------------------------------------------------------------------------
// The conversation itself
// ---------------------------------------------------------------------------

test("a group with no topics row still has the conversation in its rail", () => {
  const channels = withGeneralChannel([voiceChannelFromRow(voiceRow("v1", "Комната"))]);
  const general = channels.find((channel) => channel.kind === "text");
  assert.ok(general, "the rail has no row for the conversation");
  assert.equal(general.id, GENERAL_CHANNEL_ID);
  assert.equal(general.name, "Общие");
  assert.equal(general.isGeneral, true);
});

test("a forum's own general topic is used rather than a second one invented", () => {
  const real = textChannelFromTopic(topicRow("t-general", "Общие", { is_general: true }));
  const channels = withGeneralChannel([real, textChannelFromTopic(topicRow("t2", "дизайн"))]);
  assert.equal(channels.filter((channel) => channel.isGeneral === true).length, 1);
  assert.equal(channels.find((channel) => channel.isGeneral === true)?.id, "t-general");
});

test("the invented conversation sorts above every real channel in its group", () => {
  // The voice room is given the id and the creation time that would put it
  // FIRST under `byPosition` alone — an earlier `created_at` and an id that
  // sorts before the text channel's. So the order below can only come from the
  // kind rule. Measured on 2026-09-14: with ids «t2» and «v1» the tie-break
  // produced the same order by accident, and deleting the kind rule from
  // `buildChannelTree` left this test green.
  const groups = buildChannelTree({
    categories: [],
    channels: withGeneralChannel([
      textChannelFromTopic(topicRow("zz-text", "дизайн", { position: 0, created_at: "2026-09-14T12:00:00.000Z" })),
      voiceChannelFromRow(voiceRow("aa-room", "Комната", { position: 0, created_at: "2026-09-14T08:00:00.000Z" })),
    ]),
  });
  assert.deepEqual(
    flattenChannelTree(groups).map((channel) => channel.id),
    [GENERAL_CHANNEL_ID, "zz-text", "aa-room"],
  );
});

// ---------------------------------------------------------------------------
// Whether the rail is offered at all
// ---------------------------------------------------------------------------

test("a group with only the conversation keeps the topic strip", () => {
  const only = withGeneralChannel([]);
  assert.equal(railIsOffered(only, []), false);

  const forumWithOnlyGeneral = [textChannelFromTopic(topicRow("t-general", "Общие", { is_general: true }))];
  assert.equal(railIsOffered(forumWithOnlyGeneral, []), false);
});

test("a second text channel, a room, or a heading each earn the rail", () => {
  assert.equal(railIsOffered(withGeneralChannel([textChannelFromTopic(topicRow("t2", "дизайн"))]), []), true);
  assert.equal(railIsOffered(withGeneralChannel([voiceChannelFromRow(voiceRow("v1", "Комната"))]), []), true);
  // A heading somebody has made and not filled yet is a thing they are in the
  // middle of doing; a rail that waits for the first channel hides it.
  assert.equal(railIsOffered(withGeneralChannel([]), [categoryFromRow({ id: "c1", name: "Голос" })]), true);
});

test("a read that failed keeps the rail, and the rail says so", () => {
  // D-193. `useServerChannels` turned an error into `[]`, so a failed read of
  // `voice_channels` looked exactly like a group with no rooms — and a group
  // whose only extra channels were rooms lost its whole rail, with no sentence
  // anywhere saying why. An empty answer and an answer nobody could get are not
  // the same answer.
  const onlyTheConversation = withGeneralChannel([]);
  assert.equal(railIsOffered(onlyTheConversation, []), false, "the fixture is not the case being tested");
  assert.equal(railIsOffered(onlyTheConversation, [], true), true);

  // And the sentence is about the read rather than about the group: «пусто»
  // would be a claim, and this is an admission.
  assert.match(CHANNEL_RAIL_UNREADABLE, /не удалось/iu);
  assert.doesNotMatch(CHANNEL_RAIL_UNREADABLE, /пуст|нет каналов/iu);
  assert.ok(CHANNEL_RAIL_RETRY.length > 0, "a read worth retrying has no way to retry it");
});

test("the rail draws that sentence, and the composer half holds its fire", () => {
  // Two source facts, because both live inside React and neither returns a
  // value a test can call. The second is the serious one: with `ready` true and
  // the rooms empty, `voiceCallLostItsChannel` reads «this chat has no such
  // room» and hangs up a live call — on a network blip.
  const rail = readFileSync("artifacts/kub/src/components/chat/ChannelRail.tsx", "utf8");
  assert.ok(rail.includes("{CHANNEL_RAIL_UNREADABLE}"), "the rail stopped saying the read failed");
  assert.ok(
    rail.includes('data-testid="channel-rail-unreadable"'),
    "the sentence lost the handle a test can find it by",
  );

  const window = readFileSync("artifacts/kub/src/components/chat/ChatWindow.tsx", "utf8");
  assert.ok(
    window.includes("ready: voice.ready && !voice.failed,"),
    "a failed read is being read as evidence that the room is gone",
  );
});

test("an archived extra channel does not earn a rail listing one row", () => {
  const channels = withGeneralChannel([textChannelFromTopic(topicRow("t2", "дизайн", { archived: true }))]);
  assert.equal(railIsOffered(channels, []), false);
});

// ---------------------------------------------------------------------------
// Which text channel is being read
// ---------------------------------------------------------------------------

test("null in the store is the conversation, not «nothing chosen»", () => {
  const channels = withGeneralChannel([textChannelFromTopic(topicRow("t2", "дизайн"))]);
  assert.equal(currentTextChannelId(channels, null), GENERAL_CHANNEL_ID);
});

test("a chosen topic is the chosen row", () => {
  const channels = withGeneralChannel([textChannelFromTopic(topicRow("t2", "дизайн"))]);
  assert.equal(currentTextChannelId(channels, "t2"), "t2");
});

test("a topic that is gone falls back to the conversation rather than to nothing", () => {
  const channels = withGeneralChannel([textChannelFromTopic(topicRow("t2", "дизайн"))]);
  assert.equal(currentTextChannelId(channels, "t-archived"), GENERAL_CHANNEL_ID);
});

test("a rail of rooms and no text channels has no chosen text row", () => {
  assert.equal(currentTextChannelId([voiceChannelFromRow(voiceRow("v1", "Комната"))], null), null);
});

test("choosing the general channel writes null, whether its row is real or invented", () => {
  assert.equal(topicIdForChannel({ id: GENERAL_CHANNEL_ID, isGeneral: true }), null);
  // The real `is_general` row too: `useTopics` resets the store to null
  // whenever the selected topic is the general one, so writing its id would
  // highlight a row the store unselects within a render.
  assert.equal(topicIdForChannel({ id: "t-general", isGeneral: true }), null);
  assert.equal(topicIdForChannel({ id: "t2", isGeneral: false }), "t2");
});

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

test("the seat count is the row's own counter against its limit", () => {
  assert.equal(seatLabel(voiceChannelFromRow(voiceRow("v1", "n", { participant_count: 3, max_participants: 10 }))), "3/10");
});

test("a room with no limit prints no seats", () => {
  assert.equal(seatLabel({ maxParticipants: null, participantCount: 2 }), null);
  assert.equal(seatLabel({ maxParticipants: 0, participantCount: 2 }), null);
});

test("a negative counter is drawn as empty rather than as minus one", () => {
  assert.equal(seatLabel({ maxParticipants: 10, participantCount: -1 }), "0/10");
});

// ---------------------------------------------------------------------------
// Collapsing
// ---------------------------------------------------------------------------

test("a folded heading keeps the channel being read and the rooms with people in them", () => {
  const channels = [
    textChannelFromTopic(topicRow("t2", "дизайн")),
    textChannelFromTopic(topicRow("t3", "смета")),
    voiceChannelFromRow(voiceRow("v1", "Пустая")),
    voiceChannelFromRow(voiceRow("v2", "Занятая")),
  ];
  const shown = channelsShownWhileCollapsed(channels, { textChannelId: "t3", occupiedVoiceIds: ["v2"] });
  assert.deepEqual(shown.map((channel) => channel.id), ["t3", "v2"]);
});

test("a folded heading with nothing happening in it shows nothing", () => {
  const channels = [textChannelFromTopic(topicRow("t2", "дизайн")), voiceChannelFromRow(voiceRow("v1", "Пустая"))];
  assert.deepEqual(channelsShownWhileCollapsed(channels, { textChannelId: null, occupiedVoiceIds: [] }), []);
});

// ---------------------------------------------------------------------------
// Room for a column
// ---------------------------------------------------------------------------

test("a pane too narrow for the rail and a readable conversation opens a sheet instead", () => {
  // 768 with the chat list at its default: the pane is about 336px, and a
  // `md:` breakpoint would have put a 224px column into it.
  assert.equal(paneFitsChannelRail(336), false);
  assert.equal(paneFitsChannelRail(390), false);
});

test("a computer's pane holds the column with the conversation still above the narrowest tested width", () => {
  // 1440 with the list at its default 360: the pane is about 1007px.
  assert.equal(paneFitsChannelRail(1007), true);
  assert.ok(1007 - CHANNEL_RAIL_WIDTH >= CONVERSATION_MIN_WIDTH);
});

test("the boundary is exact, and a pane of unknown width is not a column", () => {
  assert.equal(paneFitsChannelRail(CHANNEL_RAIL_WIDTH + CONVERSATION_MIN_WIDTH), true);
  assert.equal(paneFitsChannelRail(CHANNEL_RAIL_WIDTH + CONVERSATION_MIN_WIDTH - 1), false);
  assert.equal(paneFitsChannelRail(Number.NaN), false);
});

// ---------------------------------------------------------------------------
// Which room the call capsule speaks for
// ---------------------------------------------------------------------------

const ROOMS: ServerChannel[] = [
  voiceChannelFromRow(voiceRow("v1", "Общая", { position: 0 })),
  voiceChannelFromRow(voiceRow("v2", "Планёрка", { position: 1 })),
];

test("with no call, the first room is the one named", () => {
  assert.equal(voiceChannelForCall(ROOMS, null)?.id, "v1");
});

test("with a call, the room the call is in wins over the first", () => {
  assert.equal(voiceChannelForCall(ROOMS, "v2")?.id, "v2");
});

test("a call in another chat's room leaves this chat naming its own first", () => {
  assert.equal(voiceChannelForCall(ROOMS, "somewhere-else")?.id, "v1");
});

test("a group with no rooms names none", () => {
  assert.equal(voiceChannelForCall(withGeneralChannel([]), "v2"), null);
});

test("a live call in the second room is not hung up by the rail's arrival", () => {
  // This is the defect the rule exists for. `voiceCallLostItsChannel` reads
  // «this chat's channel is not the one I am in» as «an administrator ended the
  // voice chat» and leaves the call. Naming the first room here would end a
  // call the moment anybody joined the second one.
  const named = voiceChannelForCall(ROOMS, "v2");
  assert.equal(
    voiceCallLostItsChannel({
      callChannelId: "v2",
      callChatId: CHAT,
      chatId: CHAT,
      ready: true,
      supported: true,
      channel: named ? { id: named.id, name: named.name, participantCount: 0, maxParticipants: 10 } : null,
    }),
    false,
  );
});

test("a room deleted under a live call still hangs it up", () => {
  // The other direction, and it has to keep working: ending a voice chat is a
  // DELETE of the row, and the SFU keeps the room for another minute.
  const remaining = ROOMS.filter((room) => room.id !== "v2");
  const named = voiceChannelForCall(remaining, "v2");
  assert.equal(named?.id, "v1");
  assert.equal(
    voiceCallLostItsChannel({
      callChannelId: "v2",
      callChatId: CHAT,
      chatId: CHAT,
      ready: true,
      supported: true,
      channel: named ? { id: named.id, name: named.name, participantCount: 0, maxParticipants: 10 } : null,
    }),
    true,
  );
});

test("a group with one room keeps the capsule that has always offered it", () => {
  // The shipped behaviour, and it stays: «the voice chat of this group» names
  // something when there is one of them, and `tests/e2e/voice-call.spec.ts`
  // drives the whole join from that capsule.
  const one = withGeneralChannel([voiceChannelFromRow(voiceRow("v1", "Общий голос"))]);
  assert.equal(capsuleNamesARoom(one, null), true);
});

test("a group with several rooms gets no capsule until there is a call", () => {
  // Whichever room came first is not a fact about the group. The rail names
  // them; the capsule would be guessing.
  assert.equal(capsuleNamesARoom(ROOMS, null), false);
  assert.equal(capsuleNamesARoom(ROOMS, "v2"), true);
});

test("a call in another chat's room does not put this chat's capsule up", () => {
  assert.equal(capsuleNamesARoom(ROOMS, "somewhere-else"), false);
});

test("a group with no rooms never names one", () => {
  assert.equal(capsuleNamesARoom(withGeneralChannel([]), null), false);
  assert.equal(capsuleNamesARoom(withGeneralChannel([]), "v1"), false);
});

// ---------------------------------------------------------------------------
// The rail as a whole, built from rows
// ---------------------------------------------------------------------------

test("the rail from a realistic group: loose above headings, text above voice", () => {
  const categories = [
    categoryFromRow({ id: "c-text", name: "Текст", position: 0 }),
    categoryFromRow({ id: "c-voice", name: "Голос", position: 1 }),
  ];
  const channels = withGeneralChannel([
    // Same trap avoided as above: the loose room's id and creation time would
    // both put it ahead of «объявления» if the kind rule went away.
    textChannelFromTopic(topicRow("t-news", "объявления", { position: 0, created_at: "2026-09-14T12:00:00.000Z" })),
    textChannelFromTopic(topicRow("t-design", "дизайн", { position: 0, category_id: "c-text" })),
    voiceChannelFromRow(voiceRow("v-general", "Общая", { position: 0, category_id: "c-voice" })),
    voiceChannelFromRow(voiceRow("v-standup", "Планёрка", { position: 1, category_id: "c-voice" })),
    voiceChannelFromRow(voiceRow("a-loose", "Без раздела", { position: 0, created_at: "2026-09-14T08:00:00.000Z" })),
  ]);
  const groups = buildChannelTree({ categories, channels });

  assert.equal(groups[0].category, null);
  assert.deepEqual(
    groups[0].channels.map((channel) => channel.id),
    [GENERAL_CHANNEL_ID, "t-news", "a-loose"],
  );
  assert.equal(groups[1].category?.name, "Текст");
  assert.deepEqual(groups[1].channels.map((channel) => channel.id), ["t-design"]);
  assert.equal(groups[2].category?.name, "Голос");
  assert.deepEqual(groups[2].channels.map((channel) => channel.id), ["v-general", "v-standup"]);
});

test("a channel whose heading was deleted between two reads lands above the headings, not out of sight", () => {
  const channels = withGeneralChannel([
    voiceChannelFromRow(voiceRow("v1", "Осиротевшая", { category_id: "c-gone" })),
  ]);
  const groups = buildChannelTree({ categories: [categoryFromRow({ id: "c-live", name: "Живой" })], channels });
  assert.deepEqual(groups[0].channels.map((channel) => channel.id), [GENERAL_CHANNEL_ID, "v1"]);
});

// ---------------------------------------------------------------------------
// What the rows may do, as the rail asks it
// ---------------------------------------------------------------------------

test("the manage control is an administrator's, exactly as is_chat_admin is", () => {
  assert.equal(canManageChannels("owner"), true);
  assert.equal(canManageChannels("admin"), true);
  assert.equal(canManageChannels("member"), false);
  assert.equal(canManageChannels(null), false);
});

test("a full room and a room you may not speak in are different answers", () => {
  const full = voiceChannelFromRow(voiceRow("v1", "n", { max_participants: 2, participant_count: 2 }));
  assert.equal(voiceJoinVerdict({ channel: full, role: "member" }), "full");
  // Already inside: switching seats is not a new seat.
  assert.equal(voiceJoinVerdict({ channel: full, role: "member", alreadyInside: true }), "ok");

  const staffOnly = voiceChannelFromRow(voiceRow("v2", "n", { speak_role: "admin" }));
  assert.equal(voiceJoinVerdict({ channel: staffOnly, role: "member" }), "listen-only");
  assert.equal(voiceJoinVerdict({ channel: staffOnly, role: "admin" }), "ok");
});

test("somebody who is not a member of the group joins nothing", () => {
  assert.equal(voiceJoinVerdict({ channel: voiceChannelFromRow(voiceRow("v1", "n")), role: null }), "not-a-member");
});
