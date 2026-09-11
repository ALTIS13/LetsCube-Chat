import assert from "node:assert/strict";
import test from "node:test";

import { applyMessageUpdate, type ChatLike, type MessageRowLike } from "../../artifacts/kub/src/lib/chatListDelta.ts";

/**
 * An UPDATE may leave out a column Postgres stored out of line and did not
 * change: the chat tables keep the default replica identity on production. A
 * pin on a long last message must not blank the chat list's preview until the
 * next revalidation.
 */

const ME = "11111111-1111-4111-8111-111111111111";
const PEER = "22222222-2222-4222-8222-222222222222";
const T0 = "2026-09-11T10:00:00.000Z";
const T1 = "2026-09-11T10:01:00.000Z";

type Row = MessageRowLike & Record<string, unknown>;

const longText = "очень длинное сообщение ".repeat(200);

function preview(extra: Record<string, unknown> = {}): Row {
  return {
    id: "m1",
    chat_id: "c1",
    user_id: PEER,
    bot_id: null,
    type: "text",
    content: longText,
    created_at: T0,
    edited_at: null,
    deleted_at: null,
    pinned: false,
    client_message_id: null,
    ...extra,
  };
}

function chatWith(last: Row): ChatLike & { name: string } {
  return { id: "c1", name: "Аня", updated_at: T0, unread_count: 0, last_message: last, members: [] };
}

test("a pin on a long preview whose text the UPDATE left out keeps the text", () => {
  const chats = [chatWith(preview())];
  const row = { id: "m1", chat_id: "c1", user_id: PEER, bot_id: null, created_at: T0, deleted_at: null, pinned: true } as Row;
  const { chats: next, outcome } = applyMessageUpdate(chats, row, { currentUserId: ME });
  assert.equal(outcome, "applied");
  assert.equal((next[0].last_message as Row).content, longText);
  assert.equal((next[0].last_message as Row).pinned, true);
});

test("the same pin with the text sent empty keeps the text too", () => {
  const chats = [chatWith(preview())];
  const { chats: next } = applyMessageUpdate(chats, preview({ content: null, pinned: true }), { currentUserId: ME });
  assert.equal((next[0].last_message as Row).content, longText);
  assert.equal((next[0].last_message as Row).pinned, true);
});

test("an edit still replaces the text", () => {
  const chats = [chatWith(preview())];
  const { chats: next } = applyMessageUpdate(chats, preview({ content: "исправлено", edited_at: T1 }), { currentUserId: ME });
  assert.equal((next[0].last_message as Row).content, "исправлено");
});

test("a deletion still clears what it clears and asks for the summary", () => {
  const chats = [chatWith(preview())];
  const { chats: next, outcome } = applyMessageUpdate(chats, preview({ content: null, deleted_at: T1 }), { currentUserId: ME });
  assert.equal(outcome, "needs-summary");
  assert.equal((next[0].last_message as Row).content, null);
  assert.equal((next[0].last_message as Row).deleted_at, T1);
});
