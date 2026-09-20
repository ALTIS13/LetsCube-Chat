import assert from "node:assert/strict";
import test from "node:test";

import {
  CATEGORIES_UNAVAILABLE,
  CHANNELS_REFUSED,
  CHANNELS_UNAVAILABLE,
  CHANNEL_CREATE_FAILED,
  CHANNEL_KIND_OPTIONS,
  MISSING_SQLSTATES,
  REFUSED_SQLSTATE,
  SEAT_LIMIT_DEFAULT,
  SEAT_LIMIT_MAX,
  SEAT_LIMIT_MIN,
  SEAT_LIMIT_UNLIMITED,
  SEAT_LIMIT_UNLIMITED_LABEL,
  SEAT_LIMIT_UNLIMITED_NOTE,
  SERVER_CHANNEL_MESSAGES,
  SPEAK_ROLE_LISTENERS_NOTE,
  SPEAK_ROLE_OPTIONS,
  canRemoveChannel,
  categoryRemovalPrompt,
  categoryRemovedFeedback,
  channelCountLabel,
  channelKindLabel,
  channelRemovalPrompt,
  channelRemovedFeedback,
  channelWriteRefusalText,
  channelsReadFailureText,
  classifyChannelWriteError,
  normalizeSeatLimit,
  seatLimitIsUnlimited,
  personCountLabel,
  seatCountLabel,
  speakRoleLabel,
  speakRoleNarrowsSpeech,
  voiceChannelSummaryLine,
  voiceOccupancyNote,
  type ChannelKind as VocabularyChannelKind,
  type ChatRole as VocabularyChatRole,
} from "../../artifacts/kub/src/lib/serverChannelVocabulary.ts";
import {
  CHANNEL_NAME_MAX,
  CHAT_ROLE_RANK,
  canManageChannels,
  normalizeChannelName,
  reorderPositions,
  type ChannelKind,
  type ChatRole,
} from "../../artifacts/kub/src/lib/serverChannels.ts";
import { INTERNALS_PATTERN } from "../../artifacts/kub/src/lib/plainMessages.ts";

/**
 * The management half of a group's channels, away from React and away from a
 * network.
 *
 * `tests/unit/server-channels.test.mts` — the rail's — pins the arrangement.
 * What is pinned here is everything the *administrator's* surfaces decide
 * rather than render: which controls are offered, what each question promises
 * before something is removed, how a refusal is classified, and the two bounds
 * the product puts on a room. Each is a sentence somebody reads or a rule the
 * database will judge, so a silent change to any of them is a change to the
 * product.
 */

// ---------------------------------------------------------------------------
// The copies that must not drift
// ---------------------------------------------------------------------------

test("the vocabulary's two unions are the arrangement's two unions", () => {
  // `serverChannelVocabulary.ts` imports nothing but `plainMessages.ts`, so it
  // declares `ChannelKind` and `ChatRole` again rather than importing them.
  // Assigned in both directions here: a value of either type has to be a value
  // of the other, so a member added to one and not the other stops compiling.
  const kindsOut: VocabularyChannelKind[] = (["text", "voice"] satisfies ChannelKind[]);
  const kindsBack: ChannelKind[] = kindsOut;
  assert.deepEqual(kindsBack, ["text", "voice"]);

  const rolesOut: VocabularyChatRole[] = ([...CHAT_ROLE_RANK] satisfies ChatRole[]);
  const rolesBack: ChatRole[] = rolesOut;
  assert.deepEqual(rolesBack, ["member", "admin", "owner"]);
});

test("every speak-role option is a role the column can hold", () => {
  // The ids are the database's `chat_member_role`; the labels are the product's.
  // Pinned together so a renamed label cannot quietly become an unwritable id.
  assert.deepEqual(
    SPEAK_ROLE_OPTIONS.map((option) => option.id),
    [...CHAT_ROLE_RANK],
  );
  for (const option of SPEAK_ROLE_OPTIONS) {
    assert.ok(option.label.trim().length > 0, `«${option.id}» has no label`);
  }
});

test("the kind picker offers exactly the two kinds the rail draws", () => {
  assert.deepEqual(
    CHANNEL_KIND_OPTIONS.map((option) => option.id),
    ["text", "voice"],
  );
  assert.equal(channelKindLabel("text"), "Текстовый канал");
  assert.equal(channelKindLabel("voice"), "Голосовая комната");
});

// ---------------------------------------------------------------------------
// Which controls are offered
// ---------------------------------------------------------------------------

test("the general text channel is offered no removal control", () => {
  assert.equal(canRemoveChannel({ kind: "text", isGeneral: true }), false);
  assert.equal(canRemoveChannel({ kind: "text", isGeneral: false }), true);
  assert.equal(canRemoveChannel({ kind: "text" }), true);
  // `is_general` belongs to `topics` alone: a voice room carries no such column,
  // so a truthy value arriving on one must not take its removal away.
  assert.equal(canRemoveChannel({ kind: "voice", isGeneral: true }), true);
});

test("only an owner or an admin manages channels at all", () => {
  // The gate the dialog opens behind, and it mirrors `public.is_chat_admin`
  // rather than the wider client notion of staff.
  assert.equal(canManageChannels("owner"), true);
  assert.equal(canManageChannels("admin"), true);
  assert.equal(canManageChannels("member"), false);
  assert.equal(canManageChannels(null), false);
  assert.equal(canManageChannels("moderator"), false);
});

// ---------------------------------------------------------------------------
// What a removal promises
// ---------------------------------------------------------------------------

test("removing a text channel promises its messages stay, and never says «удалить»", () => {
  const prompt = channelRemovalPrompt({ kind: "text", name: "Релизы" });
  assert.equal(prompt.title, "Убрать канал?");
  assert.equal(prompt.confirmLabel, "Убрать");
  assert.match(prompt.description, /«Релизы»/u);
  // The write is `archived = true`. A question promising anything else would be
  // asking permission for something the product does not do.
  assert.match(prompt.description, /сообщения в нём не удаляются/iu);
  assert.doesNotMatch(prompt.title, /удалить/iu);
});

test("removing a voice room states the occupancy it has, and nothing when it is empty", () => {
  const busy = channelRemovalPrompt({ kind: "voice", name: "Переговорная", participantCount: 3 });
  assert.equal(busy.title, "Убрать комнату?");
  assert.match(busy.description, /Сейчас в комнате 3 человека\./u);

  const empty = channelRemovalPrompt({ kind: "voice", name: "Переговорная", participantCount: 0 });
  assert.doesNotMatch(empty.description, /Сейчас в комнате/u);
  // Nothing here has measured what the voice server does when the row under it
  // is archived, so nothing here predicts it.
  assert.doesNotMatch(busy.description, /прерв|отключ|заверш/iu);
});

test("a channel nobody named still gets a readable question", () => {
  assert.match(channelRemovalPrompt({ kind: "text", name: "   " }).description, /^Этот канал/u);
  assert.match(channelRemovalPrompt({ kind: "voice", name: null }).description, /^Эта комната/u);
});

test("deleting a heading says its channels survive, and counts them in Russian", () => {
  const many = categoryRemovalPrompt({ name: "Голос", channelCount: 2 });
  assert.equal(many.title, "Удалить раздел?");
  // `on delete set null (category_id)`: the rooms stay and lose their heading.
  // Without this clause a person has to assume the worst, and the worst is not
  // what happens.
  assert.match(many.description, /2 канала из него останутся на месте/u);

  assert.match(categoryRemovalPrompt({ name: "Голос", channelCount: 1 }).description, /1 канал из него/u);
  assert.match(categoryRemovalPrompt({ name: "Голос", channelCount: 5 }).description, /5 каналов из него/u);
  assert.match(categoryRemovalPrompt({ name: "Голос", channelCount: 0 }).description, /Каналов в нём нет\./u);
});

test("the feedback after a removal repeats what happened, not that a button was pressed", () => {
  assert.deepEqual(channelRemovedFeedback("voice", "Переговорная"), {
    title: "Комната убрана",
    detail: "«Переговорная» больше не виден участникам.",
  });
  assert.equal(channelRemovedFeedback("text", "  ").title, "Канал убран");
  assert.match(categoryRemovedFeedback(3).detail, /3 канала остались без раздела\./u);
  assert.match(categoryRemovedFeedback(0).detail, /Каналов в нём не было\./u);
});

// ---------------------------------------------------------------------------
// A room's two settings
// ---------------------------------------------------------------------------

test("who may speak is worded as what it does, never as the enum", () => {
  assert.equal(speakRoleLabel("member"), "Все участники");
  assert.equal(speakRoleLabel("admin"), "Только администраторы");
  assert.equal(speakRoleLabel("owner"), "Только владелец");
  // An absent value is the column's default, not an error.
  assert.equal(speakRoleLabel(null), "Все участники");
  assert.equal(speakRoleLabel(undefined), "Все участники");
  for (const option of SPEAK_ROLE_OPTIONS) {
    assert.doesNotMatch(option.label, /\b(member|admin|owner)\b/iu);
  }
});

test("a room that narrows speech says the rest may still listen", () => {
  assert.equal(speakRoleNarrowsSpeech("admin"), true);
  assert.equal(speakRoleNarrowsSpeech("owner"), true);
  assert.equal(speakRoleNarrowsSpeech("member"), false);
  assert.equal(speakRoleNarrowsSpeech(null), false);
  // `voiceJoinVerdict` separates «full» from «listen-only» for the same reason:
  // a room nobody but an administrator may speak in is a useful room, not a
  // closed one, and the note must never read as a refusal to enter.
  assert.equal(SPEAK_ROLE_LISTENERS_NOTE, "Остальные смогут зайти и слушать.");
  assert.doesNotMatch(SPEAK_ROLE_LISTENERS_NOTE, /нельзя|запрещ|недоступ/iu);
});

test("zero is «no limit» and every other value is clamped into the product's bounds", () => {
  assert.equal(normalizeSeatLimit(10), 10);
  assert.equal(normalizeSeatLimit(32767), SEAT_LIMIT_MAX);
  assert.equal(normalizeSeatLimit("25"), 25);
  assert.equal(normalizeSeatLimit(7.9), 7);

  // The owner, 2026-09-20: «изначально ограничения быть не должно». 0 is that,
  // it is the column's default since
  // `20260920130000_a_group_voice_channel_has_no_seat_limit.sql`, and it
  // survives this function -- which used to raise it to two, so a channel
  // carrying the new default would have been read as a two-person room by
  // every sentence this module writes.
  assert.equal(normalizeSeatLimit(0), SEAT_LIMIT_UNLIMITED);
  assert.equal(SEAT_LIMIT_UNLIMITED, 0);

  // One seat is still not a room, and the floor of two still holds for every
  // value that is a limit at all. A negative number is a broken value, not a
  // small one, and «no limit» is the safe reading: a two-seat room conjured out
  // of a corrupt column would lock a group out of its own channel.
  assert.equal(normalizeSeatLimit(1), SEAT_LIMIT_MIN);
  assert.equal(normalizeSeatLimit(-5), SEAT_LIMIT_UNLIMITED);

  // A field somebody is typing into passes through every intermediate state.
  assert.equal(normalizeSeatLimit(""), SEAT_LIMIT_DEFAULT);
  assert.equal(normalizeSeatLimit("-"), SEAT_LIMIT_DEFAULT);
  assert.equal(normalizeSeatLimit(null), SEAT_LIMIT_DEFAULT);
  assert.equal(normalizeSeatLimit(Number.NaN), SEAT_LIMIT_DEFAULT);
  assert.equal(SEAT_LIMIT_DEFAULT, SEAT_LIMIT_UNLIMITED);

  // The ceiling is the one the field has always offered, and the database now
  // agrees with it: the CHECK on production was `between 2 and 20` while this
  // said 99, so every number from 21 up was refused by Postgres after being
  // shown as acceptable here.
  assert.equal(SEAT_LIMIT_MAX, 99);
  assert.ok(SEAT_LIMIT_MIN >= 2 && SEAT_LIMIT_MAX <= 32767);

  assert.equal(seatLimitIsUnlimited(0), true);
  assert.equal(seatLimitIsUnlimited(null), true);
  assert.equal(seatLimitIsUnlimited(undefined), true);
  assert.equal(seatLimitIsUnlimited(10), false);
  assert.equal(seatLimitIsUnlimited(2), false);
});

test("a room's own line carries its seats, and who speaks only when that is narrower", () => {
  assert.equal(voiceChannelSummaryLine({ maxParticipants: 10, speakRole: "member" }), "10 мест");
  assert.equal(
    voiceChannelSummaryLine({ maxParticipants: 4, speakRole: "admin" }),
    "4 места · Только администраторы",
  );
  // «0 мест» is the sentence a room nobody may enter would show, and this is
  // the opposite of that room.
  assert.equal(
    voiceChannelSummaryLine({ maxParticipants: 0, speakRole: "member" }),
    SEAT_LIMIT_UNLIMITED_LABEL,
  );
  assert.equal(
    voiceChannelSummaryLine({ maxParticipants: 0, speakRole: "owner" }),
    `${SEAT_LIMIT_UNLIMITED_LABEL} · Только владелец`,
  );
  assert.equal(
    voiceChannelSummaryLine({ maxParticipants: null, speakRole: null }),
    SEAT_LIMIT_UNLIMITED_LABEL,
  );
  assert.doesNotMatch(SEAT_LIMIT_UNLIMITED_NOTE, /\bкан[ае]л/iu);
  assert.match(SEAT_LIMIT_UNLIMITED_NOTE, /0/u);
});

test("the occupancy note exists only while somebody is inside", () => {
  assert.equal(voiceOccupancyNote(0), null);
  assert.equal(voiceOccupancyNote(null), null);
  assert.equal(voiceOccupancyNote(-2), null);
  assert.equal(voiceOccupancyNote(1), "Сейчас в комнате 1 человек.");
  assert.equal(voiceOccupancyNote(4), "Сейчас в комнате 4 человека.");
});

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

test("Russian counts take the form Russian takes", () => {
  assert.equal(channelCountLabel(1), "1 канал");
  assert.equal(channelCountLabel(3), "3 канала");
  assert.equal(channelCountLabel(7), "7 каналов");
  // The teens are the trap: 11 ends in 1 and 12 ends in 2, and neither takes
  // the form its last digit suggests.
  assert.equal(channelCountLabel(11), "11 каналов");
  assert.equal(channelCountLabel(12), "12 каналов");
  assert.equal(channelCountLabel(14), "14 каналов");
  assert.equal(channelCountLabel(21), "21 канал");
  assert.equal(channelCountLabel(22), "22 канала");
  assert.equal(channelCountLabel(0), "0 каналов");
  assert.equal(seatCountLabel(1), "1 место");
  assert.equal(seatCountLabel(2), "2 места");
  assert.equal(seatCountLabel(10), "10 мест");
  assert.equal(personCountLabel(1), "1 человек");
  assert.equal(personCountLabel(2), "2 человека");
  assert.equal(personCountLabel(5), "5 человек");
});

// ---------------------------------------------------------------------------
// What a refusal is allowed to say
// ---------------------------------------------------------------------------

test("a refused write is classified by its code first and its text second", () => {
  assert.equal(classifyChannelWriteError({ code: REFUSED_SQLSTATE }), "refused");
  for (const code of MISSING_SQLSTATES) {
    assert.equal(classifyChannelWriteError({ code }), "missing", code);
  }
  assert.equal(
    classifyChannelWriteError({ message: "new row violates row-level security policy for table" }),
    "refused",
  );
  assert.equal(
    classifyChannelWriteError({ message: 'relation "public.voice_channels" does not exist' }),
    "missing",
  );
  assert.equal(
    classifyChannelWriteError({ message: "Could not find the table in the schema cache" }),
    "missing",
  );
  assert.equal(classifyChannelWriteError({ message: "Failed to fetch" }), "failed");
  assert.equal(classifyChannelWriteError("row level security"), "refused");
  assert.equal(classifyChannelWriteError(null), "failed");
  assert.equal(classifyChannelWriteError({}), "failed");
});

test("each outcome gets its own sentence, and «failed» keeps what a person can act on", () => {
  assert.equal(channelWriteRefusalText("refused", CHANNEL_CREATE_FAILED), CHANNELS_REFUSED);
  assert.equal(channelWriteRefusalText("missing", CHANNEL_CREATE_FAILED), CHANNELS_UNAVAILABLE);
  assert.equal(
    channelWriteRefusalText("failed", CHANNEL_CREATE_FAILED),
    "Не удалось создать канал. Попробуйте ещё раз.",
  );
  // A mapper's answer that a person can act on is worth more than the generic
  // sentence and survives untouched.
  assert.equal(
    channelWriteRefusalText("failed", CHANNEL_CREATE_FAILED, "Нет соединения с сервером."),
    "Нет соединения с сервером.",
  );
  // And one that names an internal is replaced, not printed.
  assert.equal(
    channelWriteRefusalText("failed", CHANNEL_CREATE_FAILED, "Требуется обновление базы данных."),
    "Не удалось создать канал. Попробуйте ещё раз.",
  );
});

test("the read's failure admits it may work later, and hides an internal the same way", () => {
  assert.equal(channelsReadFailureText(null), "Не удалось загрузить каналы. Попробуйте позже.");
  assert.equal(
    channelsReadFailureText("Не удалось выполнить миграцию таблицы topics."),
    "Не удалось загрузить каналы. Попробуйте позже.",
  );
  assert.equal(channelsReadFailureText("Сессия не найдена. Войдите снова."), "Сессия не найдена. Войдите снова.");
});

test("no sentence this feature can show explains the machine", () => {
  for (const message of SERVER_CHANNEL_MESSAGES) {
    assert.doesNotMatch(message, INTERNALS_PATTERN, message);
    assert.ok(message.trim().length > 0, "an empty sentence is in the list");
  }
  // The two «unavailable» lines are the ones most likely to reach for a cause,
  // since a missing object is exactly what they describe.
  assert.doesNotMatch(CHANNELS_UNAVAILABLE, INTERNALS_PATTERN);
  assert.doesNotMatch(CATEGORIES_UNAVAILABLE, INTERNALS_PATTERN);
});

// ---------------------------------------------------------------------------
// The two rules the dialog leans on from the arrangement
// ---------------------------------------------------------------------------

test("a name is cut by code point, so the constraint's count is the one that is honoured", () => {
  // `char_length` counts characters; `String.length` counts UTF-16 code units,
  // and an emoji costs two. The dialog's `maxLength` is the constraint's number
  // and this is what makes the two agree.
  const emoji = "🙂".repeat(CHANNEL_NAME_MAX + 5);
  const cut = normalizeChannelName(emoji);
  assert.equal(Array.from(cut ?? "").length, CHANNEL_NAME_MAX);
  assert.equal(normalizeChannelName("  Общий   канал  "), "Общий канал");
  assert.equal(normalizeChannelName("   "), null);
  assert.equal(normalizeChannelName(null), null);
});

test("a move that lands where it started writes nothing", () => {
  const rows = [
    { id: "a", position: 0 },
    { id: "b", position: 1 },
    { id: "c", position: 2 },
  ];
  assert.deepEqual(reorderPositions(rows, "b", 1), []);
  assert.deepEqual(reorderPositions(rows, "b", 0), [
    { id: "b", position: 0 },
    { id: "a", position: 1 },
  ]);
  // Off the end clamps rather than throwing: the dialog's «ниже» on the last row
  // is disabled, and a disabled control is not the only thing standing between
  // this and a bad index.
  assert.deepEqual(reorderPositions(rows, "a", 99), [
    { id: "b", position: 0 },
    { id: "c", position: 1 },
    { id: "a", position: 2 },
  ]);
  assert.deepEqual(reorderPositions(rows, "missing", 0), []);
});
