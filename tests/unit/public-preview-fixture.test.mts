import assert from "node:assert/strict";
import test from "node:test";

import {
  parsePublicPreviewFixture,
  previewChats,
  previewForwardDraft,
  previewMembers,
  previewMessages,
} from "../../artifacts/kub/src/lib/publicPreviewFixture.ts";

/**
 * The DEV preview fixture carries the states the message-action renders are
 * taken from: reactions by named people, photos, a forwarded message, a
 * private chat beside a group, an edit, read times, and a forward waiting
 * above the composer. Every name has to mean the same person everywhere it
 * appears, or a reaction, a read receipt and a message would disagree.
 */

const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const group = {
  currentUser: { name: "Максим", username: "maksim" },
  activeChat: { name: "Команда", memberCount: 4, readers: [{ name: "Аня", time: "00:00" }] },
  chats: [{ name: "Команда", preview: "Привет", time: "00:00", unread: 0 }],
  messages: [
    {
      sender: "Аня",
      text: "Привет",
      time: "00:00",
      own: false,
      reactions: [
        { emoji: "❤️", users: ["Борис", "Максим"] },
        { emoji: "👍", users: ["Вера"] },
      ],
    },
    { sender: "Максим", text: "Фото", time: "00:00", own: true, image: { url: PIXEL, width: 4, height: 3 }, editedAt: "00:00", pinned: true },
    { sender: "Борис", text: "Пересылаю", time: "00:00", own: false, forwardedFrom: "Гена" },
  ],
  recentReactions: ["🔥", "😂"],
  pendingForward: { messages: [{ sender: "Лена", text: "Первое" }, { sender: "Олег", text: "Второе" }], comment: "Смотри" },
};

test("the new fields parse, and what is not given stays absent", () => {
  const parsed = parsePublicPreviewFixture(group);
  assert.equal(parsed.messages[0].reactions?.length, 2);
  assert.equal(parsed.messages[1].pinned, true);
  assert.equal(parsed.messages[2].forwardedFrom, "Гена");
  assert.deepEqual(parsed.recentReactions, ["🔥", "😂"]);
  assert.equal(parsed.pendingForward?.comment, "Смотри");
  const minimal = parsePublicPreviewFixture({ ...group, messages: [{ sender: "Аня", text: "Да", time: "00:00", own: false }], recentReactions: undefined, pendingForward: undefined });
  assert.equal("reactions" in minimal.messages[0], false);
  assert.equal("recentReactions" in minimal, false);
});

test("a fixture that could not be rendered faithfully is refused", () => {
  const broken = (patch: Record<string, unknown>) => () => parsePublicPreviewFixture({ ...group, ...patch });
  assert.throws(broken({ activeChat: { ...group.activeChat, type: "channel" } }), /activeChat\.type/);
  assert.throws(broken({ recentReactions: ["a sentence, not an emoji"] }), /single emoji/);
  assert.throws(
    broken({ messages: [{ sender: "Аня", text: "x", time: "00:00", own: false, image: { url: "https://example.com/a.png", width: 1, height: 1 } }] }),
    /data:image/,
  );
  assert.throws(broken({ messages: [{ sender: "Аня", text: "x", time: "25:00", own: false }] }), /HH:MM/);
  assert.throws(broken({ pendingForward: { messages: [] } }), /pendingForward\.messages/);
});

test("one name is one person across messages, reactions and read receipts", () => {
  const fixture = parsePublicPreviewFixture(group);
  const members = previewMembers(fixture);
  const idOf = (name: string) => members.find((member) => member.profile.full_name === name)?.user_id;
  const messages = previewMessages(fixture);

  const [first] = messages;
  assert.equal(first.user_id, idOf("Аня"));
  const byEmoji = (emoji: string) => first.reactions?.filter((reaction) => reaction.emoji === emoji).map((reaction) => reaction.user_id);
  assert.deepEqual(byEmoji("❤️"), [idOf("Борис"), idOf("Максим")]);
  assert.deepEqual(byEmoji("👍"), [idOf("Вера")]);
  assert.equal(messages[2].user_id, idOf("Борис"), "a second incoming sender is not folded into the first");
  assert.notEqual(idOf("Борис"), idOf("Аня"));
});

test("an edit, a pin, a picture and a forward reach the message rows", () => {
  const messages = previewMessages(parsePublicPreviewFixture(group));
  assert.equal(messages[1].type, "image");
  assert.ok(messages[1].edited_at);
  assert.equal(messages[1].pinned, true);
  assert.ok(messages[2].forwarded_from_id);
  assert.deepEqual(messages[2].forward_origin, { name: "Гена" });
  assert.equal(messages[0].forwarded_from_id, null);
});

test("read times apply to the people named, and everyone else has read it all", () => {
  const fixture = parsePublicPreviewFixture(group);
  const members = previewMembers(fixture);
  const anya = members.find((member) => member.profile.full_name === "Аня");
  const boris = members.find((member) => member.profile.full_name === "Борис");
  assert.ok(anya && boris);
  assert.ok(new Date(anya.last_read_at!).getTime() < new Date(boris.last_read_at!).getTime());
});

test("a private chat is the reader and the other person, and says so", () => {
  const fixture = parsePublicPreviewFixture({
    ...group,
    activeChat: { name: "Аня", memberCount: 2, type: "private" },
    messages: [{ sender: "Аня", text: "Привет", time: "00:00", own: false }],
  });
  const members = previewMembers(fixture);
  assert.equal(members.length, 2);
  const [active] = previewChats(fixture);
  assert.equal(active.type, "private");
  assert.equal(active.other_user?.full_name, "Аня");
});

test("a forward waiting above the composer carries its senders", () => {
  const draft = previewForwardDraft(parsePublicPreviewFixture(group));
  assert.deepEqual(draft.map((message) => [message.sender?.full_name, message.content]), [["Лена", "Первое"], ["Олег", "Второе"]]);
  assert.notEqual(draft[0].chat_id, previewChats(parsePublicPreviewFixture(group))[0].id);
});

test("a message from an earlier day lands on that day, so a conversation can cross a date separator", () => {
  const fixture = parsePublicPreviewFixture({
    ...group,
    messages: [
      { sender: "Аня", text: "Вчера", time: "23:59", own: false, daysAgo: 1, editedAt: "23:59" },
      { sender: "Аня", text: "Сегодня", time: "00:00", own: false, daysAgo: 0 },
    ],
  });
  assert.equal(fixture.messages[0].daysAgo, 1);
  assert.equal("daysAgo" in fixture.messages[1], false, "zero days is today, which an absent value already says");

  const [earlier, later] = previewMessages(fixture);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  assert.equal(new Date(earlier.created_at).toDateString(), yesterday.toDateString());
  // 23:59 is later than any clock this test can run at, so a stamp that had
  // stayed on today would have been refused as being in the future.
  assert.equal(new Date(earlier.edited_at!).toDateString(), yesterday.toDateString(), "the edit left its message's day");
  assert.equal(new Date(later.created_at).toDateString(), new Date().toDateString());

  const withDays = (daysAgo: unknown) => () =>
    parsePublicPreviewFixture({ ...group, messages: [{ sender: "Аня", text: "x", time: "00:00", own: false, daysAgo }] });
  for (const daysAgo of [-1, 1.5, 31, "1", null]) {
    assert.throws(withDays(daysAgo), /daysAgo/, `${JSON.stringify(daysAgo)} was accepted`);
  }
});
