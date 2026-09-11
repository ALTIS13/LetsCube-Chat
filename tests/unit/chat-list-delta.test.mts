import assert from "node:assert/strict";
import test from "node:test";

import {
  applyChatSummaries,
  applyIncomingMessage,
  applyMessageUpdate,
  applyOwnMembershipUpdate,
  applyPeerReceipt,
  clearUnread,
  replayChatListEvents,
  samePreviewMessage,
  type ChatLike,
  type MessageRowLike,
} from "../../artifacts/kub/src/lib/chatListDelta.ts";

/**
 * D-088: one Realtime event changes one row of the chat list, and nothing is
 * refetched for it.
 *
 * The behaviour on the running application — requests and renders counted per
 * event — is `tests/e2e/chat-list-event-cost.spec.ts`. These pin the arithmetic
 * behind it: what a message, an edit, a deletion, a read and a receipt do to a
 * preview, a count and the rows around it, and that each lands once however
 * many times it is applied.
 */

const ME = "11111111-1111-4111-8111-111111111111";
const PEER = "22222222-2222-4222-8222-222222222222";
const BOT = "33333333-3333-4333-8333-333333333333";

const T0 = "2026-09-11T10:00:00.000Z";
const T1 = "2026-09-11T10:01:00.000Z";
const T2 = "2026-09-11T10:02:00.000Z";
const T3 = "2026-09-11T10:03:00.000Z";

type Chat = ChatLike & { name: string; type: string };
type Row = MessageRowLike & Record<string, unknown>;

const profile = (id: string) => ({
  id,
  full_name: id === ME ? "Максим" : "Аня",
  username: null,
  avatar_url: null,
  online_at: T0,
});

function member(userId: string, readAt: string | null) {
  return {
    user_id: userId,
    role: "member",
    joined_at: "2026-09-01T00:00:00.000Z",
    last_read_at: readAt,
    last_delivered_at: readAt,
    profile: profile(userId),
  };
}

function message(id: string, chatId: string, userId: string | null, createdAt: string, extra: Record<string, unknown> = {}): Row {
  return {
    id,
    chat_id: chatId,
    user_id: userId,
    bot_id: null,
    type: "text",
    content: `text ${id}`,
    created_at: createdAt,
    edited_at: null,
    deleted_at: null,
    client_message_id: null,
    ...extra,
  };
}

function chat(id: string, previewAt: string, overrides: Partial<Chat> = {}): Chat {
  return {
    id,
    name: `chat ${id}`,
    type: "group",
    updated_at: previewAt,
    unread_count: 0,
    cleared_at: null,
    hidden_at: null,
    is_pinned: false,
    pinned_at: null,
    pinned_order: null,
    last_message: { ...message(`${id}-preview`, id, PEER, previewAt), sender: profile(PEER), bot: null },
    members: [member(ME, previewAt), member(PEER, previewAt)],
    ...overrides,
  };
}

/** The columns of a preview without its joins, as Realtime would send the row. */
function columnsOf(preview: MessageRowLike | null | undefined): Row {
  const { sender: _sender, bot: _bot, ...columns } = preview as Row;
  return columns as Row;
}

const reading = (readingChatId: string | null) => ({ currentUserId: ME, readingChatId });

test("a message in another chat changes that row, and only that row", () => {
  const list = [chat("a", T0), chat("b", T0), chat("c", T0)];
  const { chats, outcome } = applyIncomingMessage(list, message("m1", "b", PEER, T1), reading("a"));
  assert.equal(outcome, "applied");
  assert.equal(chats[0], list[0]);
  assert.equal(chats[2], list[2]);
  assert.equal(chats[1].last_message?.id, "m1");
  assert.equal(chats[1].unread_count, 1);
  assert.equal(chats[1].updated_at, T1);
  assert.deepEqual(chats[1].last_message?.sender, profile(PEER), "the sender comes from the chat's own members");
});

test("the same message applied twice is counted once", () => {
  const list = [chat("a", T0), chat("b", T0)];
  const once = applyIncomingMessage(list, message("m1", "b", PEER, T1), reading(null)).chats;
  const twice = applyIncomingMessage(once, message("m1", "b", PEER, T1), reading(null));
  assert.equal(twice.outcome, "ignored");
  assert.equal(twice.chats, once);
  assert.equal(twice.chats[1].unread_count, 1);
});

test("a message in the chat being read is not unread", () => {
  const list = [chat("a", T0)];
  const { chats } = applyIncomingMessage(list, message("m1", "a", PEER, T1), reading("a"));
  assert.equal(chats[0].last_message?.id, "m1");
  assert.equal(chats[0].unread_count, 0);
});

test("neither your own message from another device nor a system message is unread", () => {
  const list = [chat("a", T0)];
  const own = applyIncomingMessage(list, message("m1", "a", ME, T1), reading(null)).chats;
  assert.equal(own[0].unread_count, 0);
  assert.deepEqual(own[0].last_message?.sender, profile(ME));
  const system = applyIncomingMessage(list, message("m2", "a", null, T1, { type: "system" }), reading(null)).chats;
  assert.equal(system[0].unread_count, 0);
  assert.equal(system[0].last_message?.sender, null);
});

test("a message older than the preview changes nothing", () => {
  const list = [chat("a", T2)];
  const result = applyIncomingMessage(list, message("m1", "a", PEER, T1), reading(null));
  assert.equal(result.outcome, "ignored");
  assert.equal(result.chats, list);
});

test("a message already read past, or from before the clear, is not counted", () => {
  const readAhead = [chat("a", T0, { members: [member(ME, T2), member(PEER, T0)] })];
  const late = applyIncomingMessage(readAhead, message("m1", "a", PEER, T1), reading(null)).chats;
  assert.equal(late[0].last_message?.id, "m1", "it is still the newest message");
  assert.equal(late[0].unread_count, 0, "but this user has read past it on another device");

  const cleared = [chat("a", T0, { cleared_at: T2, last_message: null })];
  const result = applyIncomingMessage(cleared, message("m1", "a", PEER, T1), reading(null));
  assert.equal(result.outcome, "ignored");
  assert.equal(result.chats, cleared);
});

test("a chat that is not in the list asks for the list", () => {
  const list = [chat("a", T0)];
  const result = applyIncomingMessage(list, message("m1", "hidden", PEER, T1), reading(null));
  assert.equal(result.outcome, "unknown-chat");
  assert.equal(result.chats, list);
});

test("a bot's message waits for its bot, and a fetched row is complete even for a deleted bot", () => {
  const list = [chat("a", T0)];
  const bare = message("m1", "a", null, T1, { bot_id: BOT });
  const waiting = applyIncomingMessage(list, bare, reading(null));
  assert.equal(waiting.outcome, "needs-row");
  assert.equal(waiting.chats, list);
  const joined = applyIncomingMessage(list, { ...bare, bot: { id: BOT, display_name: "Помощник", state: "active" } }, reading(null));
  assert.equal(joined.outcome, "applied");
  assert.equal(joined.chats[0].unread_count, 1);
  const deletedBot = applyIncomingMessage(list, { ...bare, bot: null }, reading(null));
  assert.equal(deletedBot.outcome, "applied", "a null join is an answer; asking again would ask forever");
});

test("an event replayed over a fetch lands once whether or not the fetch saw it", () => {
  const event = { kind: "message-insert" as const, row: message("m1", "a", PEER, T1) };
  const fetchedBefore = [chat("a", T0)];
  const overOlder = replayChatListEvents(fetchedBefore, [event], reading(null));
  assert.equal(overOlder[0].last_message?.id, "m1");
  assert.equal(overOlder[0].unread_count, 1);

  const fetchedAfter = [chat("a", T1, {
    unread_count: 1,
    last_message: { ...message("m1", "a", PEER, T1), sender: profile(PEER), bot: null },
  })];
  assert.equal(replayChatListEvents(fetchedAfter, [event], reading(null)), fetchedAfter);
});

test("an edit of the preview patches it and keeps the joined sender", () => {
  const list = [chat("a", T0), chat("b", T0)];
  const edit = { ...columnsOf(list[1].last_message), content: "исправлено", edited_at: T1 };
  const { chats, outcome } = applyMessageUpdate(list, edit, reading(null));
  assert.equal(outcome, "applied");
  assert.equal(chats[0], list[0]);
  assert.equal((chats[1].last_message as Row).content, "исправлено");
  assert.deepEqual(chats[1].last_message?.sender, profile(PEER));
});

test("an update that changes nothing about the preview is not a change", () => {
  const list = [chat("a", T0)];
  const result = applyMessageUpdate(list, columnsOf(list[0].last_message), reading(null));
  assert.equal(result.outcome, "ignored");
  assert.equal(result.chats, list);
});

test("deleting the preview marks it deleted at once and asks for the one before it", () => {
  const list = [chat("a", T2)];
  const deletion = { ...columnsOf(list[0].last_message), deleted_at: T3 };
  const marked = applyMessageUpdate(list, deletion, reading(null));
  assert.equal(marked.outcome, "needs-summary");
  assert.equal(marked.chats[0].last_message?.deleted_at, T3, "the row says «Сообщение удалено» meanwhile");
  const again = applyMessageUpdate(marked.chats, deletion, reading(null));
  assert.equal(again.chats, marked.chats);
  assert.equal(again.outcome, "needs-summary");
});

test("deleting an unread message needs the summary, and deleting a read or own one does not", () => {
  const list = [chat("a", T2, { unread_count: 2, members: [member(ME, T0), member(PEER, T2)] })];
  assert.equal(applyMessageUpdate(list, message("m1", "a", PEER, T1, { deleted_at: T3 }), reading(null)).outcome, "needs-summary");
  assert.equal(applyMessageUpdate(list, message("m2", "a", ME, T1, { deleted_at: T3 }), reading(null)).outcome, "ignored", "your own message was never unread");
  const alreadyRead = message("m3", "a", PEER, "2026-09-11T09:00:00.000Z", { deleted_at: T3 });
  assert.equal(applyMessageUpdate(list, alreadyRead, reading(null)).outcome, "ignored");
});

test("an update to a message newer than the preview means an insert was missed", () => {
  const list = [chat("a", T0)];
  assert.equal(applyMessageUpdate(list, message("m9", "a", PEER, T3), reading(null)).outcome, "needs-summary");
});

test("a read that covers the preview clears the count without asking", () => {
  const list = [chat("a", T0), chat("b", T1, { unread_count: 3, members: [member(ME, T0), member(PEER, T1)] })];
  const { chats, outcome } = applyOwnMembershipUpdate(
    list,
    { chat_id: "b", user_id: ME, last_read_at: T2, last_delivered_at: T2, hidden_at: null, cleared_at: null, pinned: false, pinned_at: null, pinned_order: null },
    reading(null),
  );
  assert.equal(outcome, "applied");
  assert.equal(chats[0], list[0]);
  assert.equal(chats[1].unread_count, 0);
  assert.equal(chats[1].members?.find((m) => m.user_id === ME)?.last_read_at, T2);
});

test("a read that stops short of the preview needs the summary", () => {
  const list = [chat("b", T2, { unread_count: 3, members: [member(ME, T0), member(PEER, T2)] })];
  const { outcome } = applyOwnMembershipUpdate(
    list,
    { chat_id: "b", user_id: ME, last_read_at: T1, last_delivered_at: T1 },
    reading(null),
  );
  assert.equal(outcome, "needs-summary");
});

test("a pin changes the pin, and a hide or a clear asks for the list", () => {
  const list = [chat("a", T0)];
  const pinned = applyOwnMembershipUpdate(list, { chat_id: "a", user_id: ME, pinned: true, pinned_at: T1, pinned_order: 1 }, reading(null));
  assert.equal(pinned.outcome, "applied");
  assert.equal(pinned.chats[0].is_pinned, true);
  assert.equal(pinned.chats[0].pinned_order, 1);
  assert.equal(applyOwnMembershipUpdate(list, { chat_id: "a", user_id: ME, hidden_at: T2 }, reading(null)).outcome, "needs-refetch");
  assert.equal(applyOwnMembershipUpdate(list, { chat_id: "a", user_id: ME, cleared_at: T2 }, reading(null)).outcome, "needs-refetch");
});

test("the same instant written the other way is not a change", () => {
  const list = [chat("a", T0)];
  const sameRead = "2026-09-11T10:00:00+00:00";
  const result = applyOwnMembershipUpdate(
    list,
    { chat_id: "a", user_id: ME, last_read_at: sameRead, last_delivered_at: sameRead, hidden_at: null, cleared_at: null, pinned: false, pinned_at: null, pinned_order: null },
    reading(null),
  );
  assert.equal(result.outcome, "ignored");
  assert.equal(result.chats, list);
});

test("another user's row, or a chat not in the list, is not this user's change", () => {
  const list = [chat("a", T0)];
  assert.equal(applyOwnMembershipUpdate(list, { chat_id: "a", user_id: PEER, last_read_at: T2 }, reading(null)).outcome, "ignored");
  assert.equal(applyOwnMembershipUpdate(list, { chat_id: "z", user_id: ME, last_read_at: T2 }, reading(null)).outcome, "unknown-chat");
});

test("a peer's receipt changes that chat only, once", () => {
  const list = [chat("a", T0), chat("b", T0)];
  const receipt = { chat_id: "b", user_id: PEER, last_read_at: T2, last_delivered_at: T2 };
  const once = applyPeerReceipt(list, receipt, reading(null));
  assert.notEqual(once, list);
  assert.equal(once[0], list[0]);
  assert.equal(once[1].members?.find((m) => m.user_id === PEER)?.last_read_at, T2);
  assert.equal(applyPeerReceipt(once, receipt, reading(null)), once);
});

test("your own row or a stranger's is not a peer's receipt", () => {
  const list = [chat("a", T0)];
  assert.equal(applyPeerReceipt(list, { chat_id: "a", user_id: ME, last_read_at: T2 }, reading(null)), list);
  assert.equal(applyPeerReceipt(list, { chat_id: "a", user_id: "stranger", last_read_at: T2 }, reading(null)), list);
});

test("a summary replaces one chat's preview and count, and an identical one nothing", () => {
  const list = [chat("a", T0), chat("b", T1, { unread_count: 2, last_message: { ...message("gone", "b", PEER, T1, { deleted_at: T2 }), sender: profile(PEER), bot: null } })];
  const fresh = { ...message("m0", "b", PEER, T0), sender: profile(PEER), bot: null };
  const applied = applyChatSummaries(list, new Map([["b", { lastMessage: fresh, unreadCount: 1 }]]));
  assert.equal(applied[0], list[0]);
  assert.equal(applied[1].last_message?.id, "m0", "a deleted preview gives way to the one before it");
  assert.equal(applied[1].unread_count, 1);
  const same = applyChatSummaries(applied, new Map([["b", { lastMessage: fresh, unreadCount: 1 }]]));
  assert.equal(same, applied);
});

test("a summary older than a message that has already arrived does not undo it", () => {
  const list = [chat("a", T2, { unread_count: 1 })];
  const stale = { ...message("m0", "a", PEER, T1), sender: profile(PEER), bot: null };
  assert.equal(applyChatSummaries(list, new Map([["a", { lastMessage: stale, unreadCount: 0 }]])), list);
});

test("copies of one message that draw the same row are the same preview", () => {
  const realtime = message("m1", "a", PEER, T1);
  const provisional = { ...realtime, sender: profile(PEER), reactions: [], pending: false, checking: false, failed: false };
  const joined = { ...realtime, sender: { ...profile(PEER), bio: "…" }, bot: null, reactions: [], reply_to: null };
  assert.equal(samePreviewMessage({ ...realtime, sender: profile(PEER), bot: null }, provisional), true);
  assert.equal(samePreviewMessage(provisional, joined), true);
  assert.equal(samePreviewMessage(null, undefined), true);
  assert.equal(samePreviewMessage(provisional, null), false);
});

test("anything the row draws is a different preview", () => {
  const base = { ...message("m1", "a", PEER, T1), sender: profile(PEER), bot: null };
  assert.equal(samePreviewMessage(base, { ...base, content: "другое" }), false);
  assert.equal(samePreviewMessage(base, { ...base, edited_at: T2 }), false);
  assert.equal(samePreviewMessage(base, { ...base, deleted_at: T2 }), false);
  assert.equal(samePreviewMessage(base, { ...base, pending: true }), false, "the clock of a message still sending");
  assert.equal(samePreviewMessage(base, { ...base, sender: profile(ME) }), false);
  const bot = { ...message("m2", "a", null, T1, { bot_id: BOT }), bot: { id: BOT, display_name: "Помощник", state: "active" } };
  assert.equal(samePreviewMessage(bot, { ...bot, bot: { id: BOT, display_name: "Другой", state: "active" } }), false);
});

test("reading a chat clears its count, and a chat with none is left alone", () => {
  const list = [chat("a", T0), chat("b", T0, { unread_count: 4 })];
  assert.equal(clearUnread(list, "a"), list);
  const cleared = clearUnread(list, "b");
  assert.equal(cleared[0], list[0]);
  assert.equal(cleared[1].unread_count, 0);
});
