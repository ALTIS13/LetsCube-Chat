import assert from "node:assert/strict";
import test from "node:test";

import {
  labelPostgrestRequest,
  MESSAGES_HISTORY,
  MESSAGES_PREVIEW,
} from "../e2e/helpers/request-labels.ts";
import {
  MESSAGE_LAST_MESSAGE_SELECT,
  MESSAGE_SELECT_WITH_JOINS,
} from "../../artifacts/kub/src/lib/messageProjection.ts";

/**
 * D-173. The counting gate reported seven revalidations of the open
 * conversation where one was allowed, and six of the seven were the chat
 * list's per-chat preview queries wearing the conversation's label. The rule
 * that tells them apart is pure, so it is pinned here rather than only through
 * a three-minute Playwright run against a dev server.
 */

const HOST = "http://127.0.0.1:54321";

function label(path: string, params: Record<string, string> = {}, headers: Record<string, string> = {}, method = "GET") {
  const url = new URL(HOST + path);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return labelPostgrestRequest({ method, url, headers });
}

test("the conversation's history and the chat list's preview are different labels", () => {
  // The exact two queries, as their callers build them: `useMessages.fetchMessages`
  // orders the whole projection by created_at, `useChats.fetchFallbackChatSummary`
  // takes the newest 25 rows for one preview line.
  assert.equal(
    label("/rest/v1/messages", {
      select: MESSAGE_SELECT_WITH_JOINS,
      chat_id: "eq.22222222-2222-4222-8222-2222222222a1",
      deleted_at: "is.null",
      order: "created_at.desc,id.desc",
      limit: "51",
    }),
    MESSAGES_HISTORY,
  );
  assert.equal(
    label("/rest/v1/messages", {
      select: MESSAGE_LAST_MESSAGE_SELECT,
      chat_id: "eq.22222222-2222-4222-8222-2222222222a1",
      deleted_at: "is.null",
      order: "created_at.desc",
      limit: "25",
    }),
    MESSAGES_PREVIEW,
  );
  assert.notEqual(MESSAGES_HISTORY, MESSAGES_PREVIEW);
});

test("the two projections the product ships are still distinguishable", () => {
  // If these ever stop differing the split above silently collapses and the
  // gate goes back to blaming the conversation for the list's requests, which
  // is the whole of D-173. Fail here instead, where the reason is readable.
  const marker = "reactions(";
  assert.ok(
    MESSAGE_SELECT_WITH_JOINS.includes(marker),
    "the conversation's projection no longer asks for reactions",
  );
  assert.ok(
    !MESSAGE_LAST_MESSAGE_SELECT.includes(marker),
    "the sidebar preview now asks for reactions too, so the labels cannot be told apart",
  );
});

test("a count, a single row and the pinned list keep their own labels", () => {
  assert.equal(
    label("/rest/v1/messages", { select: "id" }, { prefer: "count=exact" }),
    "GET messages:count",
  );
  // A count is decided before the projection: an exact-count request carrying
  // the conversation's own select is still a count, never a history page.
  assert.equal(
    label("/rest/v1/messages", { select: MESSAGE_SELECT_WITH_JOINS }, { prefer: "count=exact" }),
    "GET messages:count",
  );
  assert.equal(
    label("/rest/v1/messages", { select: MESSAGE_SELECT_WITH_JOINS, id: "eq.33333333-3333-4333-8333-333333333301" }),
    "GET messages:one",
  );
  assert.equal(
    label("/rest/v1/messages", { select: MESSAGE_SELECT_WITH_JOINS, client_message_id: "eq.local-1" }),
    "GET messages:one",
  );
  assert.equal(
    label("/rest/v1/messages", { select: MESSAGE_SELECT_WITH_JOINS, pinned: "eq.true" }),
    "GET messages:pinned",
  );
});

test("a messages request with no projection at all counts as a preview, not as history", () => {
  // Unknown shapes must not be able to inflate the conversation's number: that
  // is the direction the defect went, and an unattributed request belongs in
  // the bucket that has a budget rather than in the one bounded to one.
  assert.equal(label("/rest/v1/messages"), MESSAGES_PREVIEW);
  assert.equal(label("/rest/v1/messages", { select: "*" }), MESSAGES_PREVIEW);
});

test("writes to messages are not labelled as reads", () => {
  assert.equal(label("/rest/v1/messages", { select: MESSAGE_SELECT_WITH_JOINS }, {}, "POST"), "POST messages");
  assert.equal(label("/rest/v1/messages", { id: "eq.1" }, {}, "PATCH"), "PATCH messages");
});

test("other tables, RPCs and auth keep their plain names", () => {
  assert.equal(label("/rest/v1/chats", { select: "*" }), "GET chats");
  assert.equal(label("/rest/v1/message_hidden_for_users", { select: "message_id" }), "GET message_hidden_for_users");
  assert.equal(label("/rest/v1/rpc/chat_list_summaries", {}, {}, "POST"), "POST rpc/chat_list_summaries");
  assert.equal(label("/auth/v1/token", { grant_type: "refresh_token" }, {}, "POST"), "POST auth/token");
  assert.equal(label("/functions/v1/anything", {}, {}, "POST"), "POST /functions/v1/anything");
});
