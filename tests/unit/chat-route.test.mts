import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_ROUTE_PREFIX,
  chatAddressPath,
  isMessengerRoute,
  parseChatAddress,
  reconcileChatAddress,
  type ChatAddressState,
} from "../../artifacts/kub/src/lib/chatRoute.ts";

/**
 * The conversation's address (queue item 35, first piece).
 *
 * Two rules live here and they are tested separately.
 *
 * **What is an address.** Strictly `/chat/<uuid>` and
 * `/chat/<uuid>/m/<uuid>`. Everything else is not a conversation, including
 * every near match — `/chat`, `/chats/<id>`, an id one group short, a third
 * segment that is not `m`. A near match that quietly opened something would be
 * a way to probe ids, and a near match that silently failed would send a
 * signed-in person to `/login` with no explanation.
 *
 * **Who wins when the two disagree.** A location and a selection can disagree
 * for opposite reasons and one snapshot cannot tell them apart: `/` with a
 * conversation open is either a click that has not reached the URL yet, or a
 * Back press that has not reached the store. So the rule is given the pair it
 * last saw agree, and whichever side moved wins.
 */

const CHAT = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER = "b4d8e1c2-1111-4a2b-8c3d-9f0a1b2c3d4e";
const MESSAGE = "550e8400-e29b-41d4-a716-446655440000";

test("the prefix is the one the router mounts", () => {
  assert.equal(CHAT_ROUTE_PREFIX, "/chat");
});

test("a conversation, with and without a message", () => {
  assert.deepEqual(parseChatAddress(`/chat/${CHAT}`), { chatId: CHAT, messageId: null });
  assert.deepEqual(parseChatAddress(`/chat/${CHAT}/m/${MESSAGE}`), { chatId: CHAT, messageId: MESSAGE });
});

test("a query string and a hash are not part of the address", () => {
  assert.deepEqual(parseChatAddress(`/chat/${CHAT}?from=push`), { chatId: CHAT, messageId: null });
  assert.deepEqual(parseChatAddress(`/chat/${CHAT}#top`), { chatId: CHAT, messageId: null });
  assert.deepEqual(parseChatAddress(`/chat/${CHAT}/m/${MESSAGE}?x=1#y`), { chatId: CHAT, messageId: MESSAGE });
});

test("a trailing slash is the same address, because `publicRoutes` says so", () => {
  // Both modules normalise the same way on purpose: two route modules that
  // disagree about what a path *is* is how a near match becomes reachable.
  assert.deepEqual(parseChatAddress(`/chat/${CHAT}/`), { chatId: CHAT, messageId: null });
  assert.deepEqual(parseChatAddress(`/chat/${CHAT}/m/${MESSAGE}//`), { chatId: CHAT, messageId: MESSAGE });
});

test("upper case hexadecimal is still a UUID", () => {
  const upper = CHAT.toUpperCase();
  assert.deepEqual(parseChatAddress(`/chat/${upper}`), { chatId: upper, messageId: null });
});

test("every near match is not an address", () => {
  const cases = [
    "/",
    "/chat",
    "/chat/",
    "/chatter",
    `/chats/${CHAT}`,
    // The separator is part of the prefix: without it this slices to a valid
    // id, and a path the product never produces would open a conversation.
    `/chatz${CHAT}`,
    `/chat/${CHAT}x`,
    `/chat/${CHAT}/m`,
    `/chat/${CHAT}/m/`,
    `/chat/${CHAT}/${MESSAGE}`,
    `/chat/${CHAT}/message/${MESSAGE}`,
    `/chat/${CHAT}/m/${MESSAGE}/extra`,
    `/chat/${CHAT}/m/${MESSAGE}/m/${MESSAGE}`,
    "/chat/not-a-uuid",
    // One group short: 8-4-4-12 instead of 8-4-4-4-12. This exact mistake has
    // already shipped in this project once, inside a database function, where
    // it made two branches unreachable for weeks without failing anything.
    "/chat/3f2504e0-4f89-41d3-0305e82c3301",
    // One group too many, and a group of the wrong length.
    `/chat/${CHAT}-0000`,
    "/chat/3f2504e0-4f89-41d3-9a0c-0305e82c330",
    // Not hexadecimal.
    "/chat/3f2504e0-4f89-41d3-9a0c-0305e82c33zz",
    `/tasks/${CHAT}`,
  ];
  for (const path of cases) {
    assert.equal(parseChatAddress(path), null, `${path} must not address a conversation`);
  }
});

test("the address is built the way it is read", () => {
  assert.equal(chatAddressPath(CHAT), `/chat/${CHAT}`);
  assert.equal(chatAddressPath(CHAT, null), `/chat/${CHAT}`);
  assert.equal(chatAddressPath(CHAT, MESSAGE), `/chat/${CHAT}/m/${MESSAGE}`);
  // Round trip, which is what stops the builder and the parser drifting apart.
  assert.deepEqual(parseChatAddress(chatAddressPath(CHAT, MESSAGE)), { chatId: CHAT, messageId: MESSAGE });
  assert.deepEqual(parseChatAddress(chatAddressPath(CHAT)), { chatId: CHAT, messageId: null });
});

test("the messenger answers at the list and at a conversation, and nowhere else", () => {
  assert.equal(isMessengerRoute("/"), true);
  assert.equal(isMessengerRoute("/?x=1"), true);
  assert.equal(isMessengerRoute(`/chat/${CHAT}`), true);
  assert.equal(isMessengerRoute(`/chat/${CHAT}/m/${MESSAGE}`), true);
  for (const path of ["/login", "/register", "/tasks", "/bots", "/admin", "/admin/users", "/privacy", "/chat", "/chat/nope"]) {
    assert.equal(isMessengerRoute(path), false, `${path} is not the messenger`);
  }
});

// --- Who wins when the two disagree ---------------------------------------

const at = (location: string, selectedChatId: string | null): ChatAddressState => ({ location, selectedChatId });

test("a pair that already agrees is left alone", () => {
  assert.deepEqual(reconcileChatAddress(at("/", null), at("/", null)), { kind: "idle" });
  assert.deepEqual(
    reconcileChatAddress(at(`/chat/${CHAT}`, CHAT), at(`/chat/${CHAT}`, CHAT)),
    { kind: "idle" },
  );
});

test("a pair that agrees is left alone while the address catches up", () => {
  // Between a click and the location updating, this rule is asked again with
  // nothing changed on either side. Answering «navigate» there would issue a
  // second navigation for the one already in flight, and a rule that acts on
  // no change is a rule that can never come to rest.
  assert.deepEqual(reconcileChatAddress(at("/", CHAT), at("/", CHAT)), { kind: "idle" });
  assert.deepEqual(
    reconcileChatAddress(at(`/chat/${CHAT}`, null), at(`/chat/${CHAT}`, null)),
    { kind: "idle" },
  );
});

test("a cold load of a conversation opens it", () => {
  // `previous` is null: a boot has nothing to compare against, and that is
  // exactly the case where the URL is the only thing that knows anything.
  assert.deepEqual(reconcileChatAddress(null, at(`/chat/${CHAT}`, null)), {
    kind: "open",
    chatId: CHAT,
    messageId: null,
  });
  assert.deepEqual(reconcileChatAddress(null, at(`/chat/${CHAT}/m/${MESSAGE}`, null)), {
    kind: "open",
    chatId: CHAT,
    messageId: MESSAGE,
  });
});

test("a cold load of the list opens nothing", () => {
  assert.deepEqual(reconcileChatAddress(null, at("/", null)), { kind: "idle" });
});

test("opening a conversation writes its address", () => {
  assert.deepEqual(reconcileChatAddress(at("/", null), at("/", CHAT)), {
    kind: "navigate",
    path: `/chat/${CHAT}`,
  });
});

test("moving from one conversation to another writes the new address", () => {
  assert.deepEqual(reconcileChatAddress(at(`/chat/${CHAT}`, CHAT), at(`/chat/${CHAT}`, OTHER)), {
    kind: "navigate",
    path: `/chat/${OTHER}`,
  });
});

test("closing a conversation goes back to the list", () => {
  assert.deepEqual(reconcileChatAddress(at(`/chat/${CHAT}`, CHAT), at(`/chat/${CHAT}`, null)), {
    kind: "navigate",
    path: "/",
  });
});

test("Back out of a conversation closes it, rather than reopening it", () => {
  // The whole reason this rule carries a memory. Same snapshot as «opening a
  // conversation» above — `/` with a chat selected — and the opposite answer,
  // because here it is the location that moved.
  assert.deepEqual(reconcileChatAddress(at(`/chat/${CHAT}`, CHAT), at("/", CHAT)), { kind: "close" });
});

test("Back between two conversations opens the earlier one", () => {
  assert.deepEqual(reconcileChatAddress(at(`/chat/${OTHER}`, OTHER), at(`/chat/${CHAT}`, OTHER)), {
    kind: "open",
    chatId: CHAT,
    messageId: null,
  });
});

test("coming back from another surface re-addresses the conversation, never closes it", () => {
  // Walking into «Задачи» and back has always left the conversation open. An
  // address is not a reason to take that away, and this is the one case where
  // `/` with a selection is not a Back press.
  assert.deepEqual(reconcileChatAddress(at("/tasks", CHAT), at("/", CHAT)), {
    kind: "navigate",
    path: `/chat/${CHAT}`,
  });
});

test("another surface is left entirely alone", () => {
  for (const path of ["/tasks", "/bots", "/admin", "/login"]) {
    assert.deepEqual(reconcileChatAddress(at("/", CHAT), at(path, CHAT)), { kind: "idle" }, path);
    assert.deepEqual(reconcileChatAddress(at(`/chat/${CHAT}`, CHAT), at(path, null)), { kind: "idle" }, path);
  }
});

test("a near match is not the messenger, so nothing is opened or closed for it", () => {
  assert.deepEqual(reconcileChatAddress(at("/", null), at("/chat/nope", null)), { kind: "idle" });
  assert.deepEqual(reconcileChatAddress(at(`/chat/${CHAT}`, CHAT), at("/chat/", CHAT)), { kind: "idle" });
});

test("a selection that never left is not re-navigated on every location change", () => {
  // Arriving at the address that already matches the selection: the push path
  // navigates for itself, and this must not answer by navigating again.
  assert.deepEqual(reconcileChatAddress(at("/", CHAT), at(`/chat/${CHAT}`, CHAT)), { kind: "idle" });
  assert.deepEqual(
    reconcileChatAddress(at("/", CHAT), at(`/chat/${CHAT}/m/${MESSAGE}`, CHAT)),
    { kind: "idle" },
  );
});
