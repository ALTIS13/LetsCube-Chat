import assert from "node:assert/strict";
import test from "node:test";

import {
  buildChatSummaryMap,
  isChatListSummariesUnavailable,
  isChatListSummariesEnabled,
} from "../../artifacts/kub/src/lib/chatSummaryBatching.ts";

test("buildChatSummaryMap normalizes RPC rows by chat id", () => {
  const preview = { id: "message-1", content: "preview" };
  const summaries = buildChatSummaryMap([
    { chat_id: "chat-1", last_message: preview, unread_count: "3" },
    { chat_id: "chat-2", last_message: null, unread_count: -5 },
    { chat_id: "", last_message: null, unread_count: 7 },
  ]);

  assert.deepEqual(summaries.get("chat-1"), {
    lastMessage: preview,
    unreadCount: 3,
  });
  assert.deepEqual(summaries.get("chat-2"), {
    lastMessage: null,
    unreadCount: 0,
  });
  assert.equal(summaries.has(""), false);
});

test("isChatListSummariesUnavailable recognizes missing RPC errors only", () => {
  assert.equal(
    isChatListSummariesUnavailable({
      code: "PGRST202",
      message: "Could not find the function public.chat_list_summaries",
    }),
    true,
  );
  assert.equal(
    isChatListSummariesUnavailable({
      code: "42883",
      message: "function public.chat_list_summaries(uuid[]) does not exist",
    }),
    true,
  );
  assert.equal(
    isChatListSummariesUnavailable({ code: "42501", message: "permission denied" }),
    false,
  );
});

test("isChatListSummariesEnabled requires an explicit production flag", () => {
  assert.equal(isChatListSummariesEnabled("1"), true);
  assert.equal(isChatListSummariesEnabled("true"), false);
  assert.equal(isChatListSummariesEnabled(undefined), false);
});
