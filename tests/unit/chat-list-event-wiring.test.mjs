import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * D-088 and D-089: the source half.
 *
 * The behaviour is measured in `tests/e2e/chat-list-event-cost.spec.ts` —
 * requests and React renders counted per message, receipt, focus and reopened
 * chat — and that is the proof. It needs a dev server on the fixture host, so
 * it does not run in the default gate. These scans do, and they are weaker than
 * they look: they say the mechanism is still written the way that measured
 * correctly, not that it still measures that way.
 */

// Comments describe the very constructs forbidden below, so they are stripped
// first — a sentence about a focus listener must not trip a scan for one.
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const read = (path) => strip(readFileSync(new URL(`../../artifacts/kub/src/${path}`, import.meta.url), "utf8"));

const chatsHook = read("hooks/useChats.ts");
const messagesHook = read("hooks/useMessages.ts");
const store = read("store/app.store.ts");
const chatList = read("components/sidebar/ChatList.tsx");
const chatRow = read("components/sidebar/ChatListItem.tsx");
const chatWindow = read("components/chat/ChatWindow.tsx");
const messageList = read("components/chat/MessageList.tsx");

test("an event about one chat is applied to that chat, not answered with the whole list", () => {
  assert.match(chatsHook, /applyEvent\(\{ kind: "message-insert", row \}\)/, "a new message no longer goes through the delta");
  assert.match(chatsHook, /applyEvent\(\{ kind: "message-update", row \}\)/, "an edited message no longer goes through the delta");
  assert.match(chatsHook, /applyEvent\(\{ kind: "own-membership", row: payload\.new \}\)/, "this user's read no longer goes through the delta");
  assert.match(chatsHook, /applyEvent\(\{ kind: "peer-receipt", row: payload\.new \}\)/, "a peer's receipt no longer goes through the delta");
  assert.match(
    chatsHook,
    /replayChatListEvents\(sortedVisibleChats, arrived/,
    "a fetch that was in flight can put back what an event changed",
  );
});

test("window focus is not a reason to refetch the list, and coming back online still is", () => {
  assert.doesNotMatch(chatsHook, /addEventListener\("focus"/, "the list refetches on every focus again");
  assert.match(chatsHook, /createResumeRevalidationGate\(/);
  assert.match(chatsHook, /addEventListener\("online", onOnline\)/, "coming back online no longer refetches the list");
  assert.match(messagesHook, /addEventListener\("online", handleOnline\)/, "coming back online no longer reconciles the open chat");
});

test("a chat row is memoised and handed nothing new per render", () => {
  assert.match(chatRow, /export const ChatListItem = memo\(function ChatListItem\(/, "the row is no longer memoised");
  const element = chatList.match(/<ChatListItem\s([\s\S]*?)\/>/);
  assert.ok(element, "<ChatListItem> could not be found in the list");
  assert.doesNotMatch(element[1], /=>/, "an inline arrow is passed to every row");
  assert.doesNotMatch(element[1], /=\{\{/, "an inline object is passed to every row");
  assert.doesNotMatch(element[1], /presenceNow=/, "the shared presence clock is passed to every row again");
  assert.doesNotMatch(chatList, /is_muted: mutedChatIds\.includes/, "every chat is copied with its mute flag on every render again");
});

test("the store keeps what did not change", () => {
  assert.match(store, /import \{ shareChatList \} from '@\/lib\/chatListChange'/);
  assert.match(
    store,
    /setMessages: \(chatId, msgs\) =>[\s\S]{0,400}shareById\(existing, sorted/,
    "setMessages takes a refetch whole again",
  );
  assert.match(
    store,
    /markChatRead: \(chatId\) =>[\s\S]{0,200}clearUnread\(state\.chats, chatId\)/,
    "opening a chat with nothing unread rebuilds the list again",
  );
});

test("the conversation reads its own chat and its own messages", () => {
  assert.match(chatWindow, /useAppStore\(\(s\) => s\.chats\.find\(\(c\) => c\.id === chatId\)\)/);
  assert.doesNotMatch(chatWindow, /useAppStore\(\(s\) => s\.chats\)/, "the chat window subscribes to the whole list again");
  assert.match(messagesHook, /useAppStore\(\(s\) => \(chatId \? s\.messages\[chatId\] : undefined\) \?\? EMPTY_MESSAGES\)/);
  assert.doesNotMatch(messagesHook, /useAppStore\(\(s\) => s\.messages\)/, "the hook subscribes to every chat's messages again");
});

test("a reopened chat is fetched once, and a chat with unread messages before it is placed", () => {
  assert.match(messagesHook, /fetchedMessageScopes\.has\(scope\) && cached && !unreadWhileClosed/);
  assert.match(messagesHook, /void fetchMessages\(\{ cacheIsStale: cached && unreadWhileClosed \}\)/);
  assert.equal(
    (messagesHook.match(/loadClearedAt\(supabase, chatId, user\.id\)/g) ?? []).length,
    2,
    "the message and pinned fetches no longer share one read of the clear mark",
  );
  assert.doesNotMatch(
    messagesHook,
    /\[chatId, topicId, generalTopicIds, supabase, clearedAt, rememberHiddenMessageIds\]/,
    "the pinned fetch runs again whenever the clear mark is set",
  );
});

test("a receipt keeps its object while it draws the same thing", () => {
  assert.match(messageList, /sameGroupReadReceiptFace\(priorGroupRead, nextGroupRead\) \? priorGroupRead : nextGroupRead/);
  assert.match(messageList, /sameData\(priorDelivery, nextDelivery\) \? priorDelivery : nextDelivery/);
});

/**
 * D-260: the subscription half, and it is the weaker half.
 *
 * What is actually proved elsewhere: `tests/unit/chat-list-delta.test.mts`
 * executes the arithmetic of a join and a departure. What nothing here proves
 * is that the server sends this client a peer's `chat_members` row at all —
 * that is Realtime plus the `chat_members select` policy, and observing it
 * needs two signed-in sessions and a write to production. These scans say the
 * bindings are still written; they cannot say a row ever arrives.
 */
test("a peer's join and departure are subscribed to, unfiltered, on the chat_members channel", () => {
  const peers = chatsHook.match(/const receiptsChannelName[\s\S]*?registerChannel\(receiptsChannelName\);/);
  assert.ok(peers, "the peer chat_members channel could not be found in useChats");
  const block = peers[0];

  for (const event of ["INSERT", "DELETE", "UPDATE"]) {
    assert.match(
      block,
      new RegExp(`\{ event: "${event}", schema: "public", table: "chat_members" \}`),
      `a peer's ${event} on chat_members is no longer subscribed to`,
    );
  }
  assert.doesNotMatch(
    block,
    /table: "chat_members", filter:/,
    "a filter on this channel narrows it to one column; «any chat I am in» is RLS's answer, not a filter's",
  );
  assert.match(block, /applyEvent\(\{ kind: "peer-joined", row: payload\.new \}\)/, "a peer's join no longer goes through the delta");
  assert.match(block, /applyEvent\(\{ kind: "peer-left", row: \{ chat_id: chatId, user_id: memberId \} \}\)/, "a peer's departure no longer goes through the delta");
  assert.match(block, /!== "ignored"\) scheduleRefetch\(\)/, "a join no longer fetches the profile the Realtime row cannot carry");

  // The bindings that were already here, and which this channel must not lose:
  // they are the only thing that moves a peer's read receipt.
  assert.match(block, /applyEvent\(\{ kind: "peer-receipt", row: payload\.new \}\)/);
});

test("the three chat_members bindings share one channel, because they share one table", () => {
  const peers = chatsHook.match(/const receiptsChannelName[\s\S]*?registerChannel\(receiptsChannelName\);/)[0];
  assert.equal(
    (peers.match(/\.channel\(/g) ?? []).length,
    1,
    "the peer bindings were split across channels; realtimeTableChannels.ts groups by table, not by event",
  );
});
