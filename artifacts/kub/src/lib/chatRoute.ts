/**
 * The address of a conversation, and the rule that keeps it and the store in step.
 *
 * ## Why a conversation needs an address at all
 *
 * `selectedChatId` lived only in `app.store.ts`: not in the URL, not
 * persisted. So every reload landed on the chat list, and that single fact
 * priced every reload — which is why nothing reloaded on its own, why the
 * update notice had to be a question, and why the owner ran a two-commit-old
 * bundle until he pressed F5 (D-282, and queue item 35 of the tracker).
 *
 * Discord addresses a channel — `/channels/<guild>/<channel>/<message>` — and
 * that third segment is the whole of their restore mechanism. This is the same
 * shape, minus a guild, because our chats are flat:
 *
 *   /chat/<chatId>
 *   /chat/<chatId>/m/<messageId>
 *
 * ## What the address is worth, and what it is not
 *
 * The address restores **which conversation**, and the product restores **where
 * in it** on its own: entry position comes from `chat.unread_count` and
 * `chat_members.last_read_at` (`ChatWindow.tsx:691`), which are server facts
 * read fresh on every boot, so `MessageList` lands on the first unread from a
 * cold URL exactly as it does from a click. That is worth stating because it is
 * where we are **better** than the reference rather than merely different:
 * Discord's reading position is a client fact that dies with the page, so their
 * cold boot lands at the bottom with a banner. Section 9 of
 * `docs/operations/reference-clients.md` carries both cases and their grades.
 *
 * It is not a scroll offset. Nobody's is — Discord keeps no per-channel offset
 * anywhere either. «Where you stopped» means the unread boundary, and that is
 * what both products show.
 *
 * ## The two-way rule, and why it needs a memory
 *
 * A location and a selection can disagree for two opposite reasons, and one
 * snapshot cannot tell them apart: `/` with a chat selected is either somebody
 * who just clicked a chat (the URL is behind) or somebody who pressed Back (the
 * store is behind). So `reconcileChatAddress` is given the pair it last agreed
 * on. **Whichever side moved wins**, which is the only reading that makes Back
 * work without making a click navigate backwards.
 *
 * Free of React, of wouter and of every browser API, so `node --test` reads it
 * directly.
 */

/** Where a conversation lives. */
export const CHAT_ROUTE_PREFIX = "/chat";

/** The segment that introduces a message inside a conversation. */
const MESSAGE_SEGMENT = "m";

/**
 * A full UUID, all five groups.
 *
 * Spelled out rather than loosened because this project has already shipped a
 * UUID pattern of 8-4-4-12 — one group short — into a database function, where
 * it silently made two branches unreachable for weeks. A short pattern here
 * would make an address look like a near-match and send somebody to `/login`.
 */
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type ChatAddress = {
  chatId: string;
  /** The message to land on, or `null` for the conversation's own entry rule. */
  messageId: string | null;
};

/**
 * The path part of a location, without query or hash and without a trailing
 * slash — the same normalisation `publicRoutes.ts` applies, so the two modules
 * cannot disagree about what a route *is*.
 */
function normalizeRoutePath(location: string): string {
  const path = location.split(/[?#]/, 1)[0]?.trim() || "/";
  if (path === "/") return path;
  return path.replace(/\/+$/, "");
}

/**
 * The conversation this location addresses, or `null` if it addresses none.
 *
 * Strict on purpose. `/chat`, `/chat/`, `/chats/<id>`, `/chat/<id>/x/<id>` and
 * anything whose ids are not UUIDs are **not** conversations, so they fall
 * through to the application's ordinary «not found» rather than opening
 * something. A near match that quietly worked would be a way to probe ids.
 */
export function parseChatAddress(location: string): ChatAddress | null {
  const path = normalizeRoutePath(location);
  // The separator is part of the prefix. Without it `/chatX<uuid>` would slice
  // to a valid id and open a conversation from a path this product never
  // produces — and a bare `/chat` needs no guard of its own, because it does
  // not start with `/chat/` either.
  if (!path.startsWith(`${CHAT_ROUTE_PREFIX}/`)) return null;
  const segments = path.slice(CHAT_ROUTE_PREFIX.length + 1).split("/");
  const [chatId, marker, messageId, ...rest] = segments;
  if (!chatId || !UUID.test(chatId)) return null;
  if (segments.length === 1) return { chatId, messageId: null };
  if (rest.length > 0) return null;
  if (marker !== MESSAGE_SEGMENT) return null;
  if (!messageId || !UUID.test(messageId)) return null;
  return { chatId, messageId };
}

/** The address of a conversation, optionally of one message inside it. */
export function chatAddressPath(chatId: string, messageId?: string | null): string {
  const base = `${CHAT_ROUTE_PREFIX}/${chatId}`;
  return messageId ? `${base}/${MESSAGE_SEGMENT}/${messageId}` : base;
}

/**
 * Whether the messenger itself answers here: the chat list at `/`, or a
 * conversation. Everything else — `/tasks`, `/admin`, `/bots`, a near match —
 * belongs to another surface and this module leaves it alone.
 */
export function isMessengerRoute(location: string): boolean {
  return normalizeRoutePath(location) === "/" || parseChatAddress(location) !== null;
}

/** The pair this module last saw agree. */
export type ChatAddressState = {
  location: string;
  selectedChatId: string | null;
};

export type ChatAddressAction =
  /** They agree, or this location is not the messenger's. */
  | { kind: "idle" }
  /** The URL named a conversation the store is not showing. */
  | { kind: "open"; chatId: string; messageId: string | null }
  /** The URL left the conversation — a Back press, or a link to the list. */
  | { kind: "close" }
  /** The store moved and the address has to follow. */
  | { kind: "navigate"; path: string };

/**
 * What to do so that the address and the open conversation agree.
 *
 * `previous` is `null` on the first run — a boot, or a return to the messenger
 * — and that is deliberately treated as «the location moved», because a cold
 * load of `/chat/<id>` is exactly a location arriving with nothing to compare
 * it to.
 *
 * Coming back to `/` from a surface that is not the messenger does **not**
 * close the conversation: walking into «Задачи» and back has always left the
 * conversation open, and an address is not a reason to take that away. It
 * re-addresses instead.
 */
export function reconcileChatAddress(
  previous: ChatAddressState | null,
  next: ChatAddressState,
): ChatAddressAction {
  if (!isMessengerRoute(next.location)) return { kind: "idle" };

  const address = parseChatAddress(next.location);
  const locationMoved = previous === null || previous.location !== next.location;

  if (locationMoved) {
    if (address) {
      return address.chatId === next.selectedChatId
        ? { kind: "idle" }
        : { kind: "open", chatId: address.chatId, messageId: address.messageId };
    }
    if (next.selectedChatId === null) return { kind: "idle" };
    // `/` with a conversation still open. Inside the messenger that is a Back
    // press out of the conversation; arriving from another surface it is the
    // conversation that was never closed, and the address is what is missing.
    return previous !== null && isMessengerRoute(previous.location)
      ? { kind: "close" }
      : { kind: "navigate", path: chatAddressPath(next.selectedChatId) };
  }

  if (previous.selectedChatId === next.selectedChatId) return { kind: "idle" };

  if (next.selectedChatId === null) {
    return address ? { kind: "navigate", path: "/" } : { kind: "idle" };
  }
  return address?.chatId === next.selectedChatId
    ? { kind: "idle" }
    : { kind: "navigate", path: chatAddressPath(next.selectedChatId) };
}
