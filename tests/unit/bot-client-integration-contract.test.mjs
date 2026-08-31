import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const projectionPath = "artifacts/kub/src/lib/messageProjection.ts";
const projection = existsSync(projectionPath) ? read(projectionPath) : "";
const messages = read("artifacts/kub/src/hooks/useMessages.ts");
const chats = read("artifacts/kub/src/hooks/useChats.ts");
const safeOpen = read("artifacts/kub/src/lib/safeOpenChat.ts");
const store = read("artifacts/kub/src/store/app.store.ts");
const messageList = read("artifacts/kub/src/components/chat/MessageList.tsx");
const messageBubble = read("artifacts/kub/src/components/chat/MessageBubble.tsx");
const pinned = read("artifacts/kub/src/components/chat/PinnedMessage.tsx");
const forward = read("artifacts/kub/src/components/chat/ForwardModal.tsx");
const chatSearch = read("artifacts/kub/src/components/chat/ChatSearchBar.tsx");
const messageInput = read("artifacts/kub/src/components/chat/MessageInput.tsx");
const globalSearch = read("artifacts/kub/src/hooks/useGlobalSearch.ts");
const searchShared = read("artifacts/kub/src/components/search/SearchShared.tsx");
const notifications = read("artifacts/kub/src/hooks/useNotifications.ts");
const desktop = read("artifacts/kub/src/lib/platform/desktopNotifications.ts");
const browser = read("artifacts/kub/src/lib/browserNotificationPresentation.ts");
const fcm = read("supabase/functions/send-push-notifications/fcm.ts");

test("all message hydration paths share explicit bounded bot projections", () => {
  assert.match(projection, /id,username,display_name,description,avatar_url,state,created_at,updated_at/);
  assert.match(projection, /bot:bots!bot_id\(\$\{BOT_PUBLIC_MESSAGE_COLUMNS\}\)/);
  assert.match(projection, /reply_to:messages!reply_to_id\([^)]*bot_id/);
  assert.doesNotMatch(projection, /bot:bots!bot_id\(\*\)/);
  for (const source of [messages, chats, safeOpen]) {
    assert.match(source, /MESSAGE_SELECT_WITH_JOINS|MESSAGE_LAST_MESSAGE_SELECT/);
    assert.doesNotMatch(source, /bot:bots!bot_id\(\*\)/);
  }
});

test("message reconciliation, grouping, unread targeting, and human controls are actor-aware", () => {
  assert.match(messages, /sameActorClientMessage|actorClientMessageKey/);
  assert.match(store, /sameActorClientMessage/);
  assert.match(messageList, /messageActorGroupingKey/);
  assert.match(messageList, /canUseHumanMessageControls/);
  assert.match(messageList, /isIncomingMessage/);
  assert.match(messageBubble, /resolveMessageActor/);
  assert.doesNotMatch(chats, /\.neq\(["']user_id["']/);
  assert.match(chats, /bot_id\.not\.is\.null/);
});

test("every sender-name preview uses the shared fail-closed actor resolver", () => {
  for (const source of [messageBubble, pinned, forward, chatSearch, messageInput, globalSearch]) {
    assert.match(source, /messageActorDisplayName|resolveMessageActor/);
  }
});

test("bot search is dedicated, separate, human-phone-safe, and has no table fallback", () => {
  assert.match(globalSearch, /search_public_bots/);
  assert.doesNotMatch(globalSearch, /\.from\(["']bots["']\)/);
  assert.match(globalSearch, /resultType: "bot"/);
  assert.match(searchShared, /bot: "Боты"/);
  assert.match(searchShared, /data-search-section=\{type\}/);
  assert.match(searchShared, /result\.resultType === "bot"/);
  assert.doesNotMatch(searchShared, /result\.resultType === "bot"[\s\S]{0,400}openPrivateChat/);
});

test("shared notification adapters preserve actor and exact navigation fields", () => {
  assert.match(notifications, /isSelfMessageNotification/);
  assert.match(desktop, /parseMessageNotificationProjection/);
  assert.match(desktop, /senderAvatarUrl/);
  assert.match(browser, /parseMessageNotificationProjection/);
  assert.match(desktop, /messageProjection\.messageId|messageProjection\?\.messageId/);
  for (const key of ["sender_kind", "sender_id", "bot_id", "sender_name", "sender_avatar_url"]) {
    assert.match(fcm, new RegExp(key));
  }
});
