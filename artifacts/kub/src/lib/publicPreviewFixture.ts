import type { ChatMember, ChatWithLastMessage, MessageWithSender, Profile } from "@/types/database";

/**
 * DEV-only support for capturing public product previews.
 *
 * The fixture is never imported by the application. The capture script reads
 * the checked-in file and injects it into a clean browser context, so no demo
 * content can reach a production bundle even by accident. Everything here is
 * behind a two-part gate and touches neither Supabase nor authentication.
 */

export const PUBLIC_PREVIEW_CAPTURE_PATH = "/__qa/public-preview";
export const PUBLIC_PREVIEW_WINDOW_KEY = "__letscubePublicPreviewFixture";
export const PUBLIC_PREVIEW_READY_ATTRIBUTE = "data-public-preview-ready";

export type PublicPreviewFixture = {
  currentUser: { name: string; username: string };
  // A count, never a rendered subtitle. `ChatHeader` composes the wording
  // itself, so the fixture cannot invent a string the product never emits.
  activeChat: { name: string; memberCount: number };
  chats: { name: string; preview: string; time: string; unread: number }[];
  messages: { sender: string; text: string; time: string; own: boolean }[];
};

declare global {
  interface Window {
    [PUBLIC_PREVIEW_WINDOW_KEY]?: unknown;
  }
}

export type PublicPreviewGateEnv = {
  DEV?: unknown;
  VITE_PUBLIC_PREVIEW_FIXTURE?: unknown;
};

/**
 * The capture gate as a pure function, so the rule itself can be tested.
 *
 * Both halves are required and neither reads the query string, the hash or
 * storage, so a flag in a URL can never enable capture.
 */
export function resolveCaptureGate(env: PublicPreviewGateEnv): boolean {
  return env.DEV === true && env.VITE_PUBLIC_PREVIEW_FIXTURE === "1";
}

/**
 * Runtime form of the same rule.
 *
 * `App.tsx` deliberately spells the gate out inline instead of calling this,
 * because only a literal `import.meta.env` read is folded away at build time;
 * a function call would keep the lazy chunk alive. This function is the rule
 * used at runtime and by the page's own defensive check.
 */
export function isPublicPreviewCaptureEnabled(): boolean {
  return resolveCaptureGate(import.meta.env as PublicPreviewGateEnv);
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function fail(reason: string): never {
  throw new Error(`Public preview fixture is invalid: ${reason}.`);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${field} must be a non-empty string`);
  return value;
}

function requireDisplayTime(value: unknown, field: string): string {
  const time = requireString(value, field);
  if (!TIME_PATTERN.test(time)) fail(`${field} must be a 24-hour HH:MM value`);
  return time;
}

function requireMemberCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 2) {
    fail("activeChat.memberCount must be an integer of at least 2");
  }
  return value;
}

function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) fail(`${field} must be a non-empty array`);
  return value;
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${field} must be an object`);
  return value as Record<string, unknown>;
}

/** Validates the injected payload. Returns null when nothing was injected. */
export function readPublicPreviewFixture(): PublicPreviewFixture | null {
  if (typeof window === "undefined") return null;
  const raw = window[PUBLIC_PREVIEW_WINDOW_KEY];
  if (raw === undefined) return null;

  const fixture = asRecord(raw, "fixture");

  const currentUser = asRecord(fixture.currentUser, "currentUser");
  const activeChat = asRecord(fixture.activeChat, "activeChat");

  const chats = requireArray(fixture.chats, "chats").map((entry, index) => {
    const chat = asRecord(entry, `chats[${index}]`);
    const unread = chat.unread;
    if (typeof unread !== "number" || !Number.isInteger(unread) || unread < 0) {
      fail(`chats[${index}].unread must be a non-negative integer`);
    }
    return {
      name: requireString(chat.name, `chats[${index}].name`),
      preview: requireString(chat.preview, `chats[${index}].preview`),
      time: requireDisplayTime(chat.time, `chats[${index}].time`),
      unread,
    };
  });

  const messages = requireArray(fixture.messages, "messages").map((entry, index) => {
    const message = asRecord(entry, `messages[${index}]`);
    if (typeof message.own !== "boolean") fail(`messages[${index}].own must be a boolean`);
    return {
      sender: requireString(message.sender, `messages[${index}].sender`),
      text: requireString(message.text, `messages[${index}].text`),
      time: requireDisplayTime(message.time, `messages[${index}].time`),
      own: message.own,
    };
  });

  return {
    currentUser: {
      name: requireString(currentUser.name, "currentUser.name"),
      username: requireString(currentUser.username, "currentUser.username"),
    },
    activeChat: {
      name: requireString(activeChat.name, "activeChat.name"),
      memberCount: requireMemberCount(activeChat.memberCount),
    },
    chats,
    messages,
  };
}

// Stable identifiers so repeated captures produce identical DOM and pixels.
const PREVIEW_IDS = {
  currentUser: "00000000-0000-4000-8000-000000000001",
  otherUser: "00000000-0000-4000-8000-000000000002",
  activeChat: "00000000-0000-4000-8000-0000000000a1",
} as const;

// Derived per row. An earlier version reused one id for every non-first chat,
// which would collide as soon as a fixture carried a third.
function previewChatId(index: number): string {
  if (index === 0) return PREVIEW_IDS.activeChat;
  return `00000000-0000-4000-8000-0000000000${(0xa1 + index).toString(16)}`;
}

function previewMemberId(index: number): string {
  return `00000000-0000-4000-8000-0000000000${(0xb1 + index).toString(16)}`;
}

const EPOCH = "2026-01-01T00:00:00.000Z";

/**
 * Renders a display time onto the current day so the real `formatTime` path
 * shows exactly that value. The capture script pins both the clock and the
 * timezone, which is what makes the result reproducible.
 */
function todayAt(time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  const stamp = new Date();
  stamp.setHours(hours, minutes, 0, 0);
  // `formatTime` only renders a clock value for today. A stamp in the future
  // makes its day difference negative and it falls through to a weekday name
  // instead, silently corrupting the captured pixels. Fail loudly instead.
  if (stamp.getTime() > Date.now()) {
    throw new Error(
      `Public preview fixture time ${time} is later than the capture clock, which would render a weekday instead of a time.`,
    );
  }
  return stamp.toISOString();
}

function previewProfile(id: string, name: string, username: string | null): Profile {
  return {
    id,
    username,
    full_name: name,
    avatar_url: null,
    bio: null,
    online_at: EPOCH,
    role: "user",
    created_at: EPOCH,
    updated_at: EPOCH,
  };
}

export function previewCurrentUser(fixture: PublicPreviewFixture): Profile {
  return previewProfile(PREVIEW_IDS.currentUser, fixture.currentUser.name, fixture.currentUser.username);
}

/** Members of the open group, so `ChatHeader` composes its own subtitle and
 * `MessageList` can derive real delivery state from `last_read_at`. */
export function previewMembers(fixture: PublicPreviewFixture): (ChatMember & { profile: Profile })[] {
  const names = [fixture.currentUser.name, ...fixture.messages.map((message) => message.sender)];
  const unique: string[] = [];
  for (const name of names) {
    if (!unique.includes(name)) unique.push(name);
  }
  while (unique.length < fixture.activeChat.memberCount) unique.push(`—${unique.length}`);

  return unique.slice(0, fixture.activeChat.memberCount).map((name, index) => {
    const isCurrent = index === 0;
    const id = isCurrent ? PREVIEW_IDS.currentUser : index === 1 ? PREVIEW_IDS.otherUser : previewMemberId(index);
    return {
      chat_id: PREVIEW_IDS.activeChat,
      user_id: id,
      role: isCurrent ? "owner" : "member",
      joined_at: EPOCH,
      // Everyone has read the conversation, which is what the open chat state
      // actually is, so own messages render their real read receipt.
      last_read_at: new Date().toISOString(),
      last_delivered_at: new Date().toISOString(),
      hidden_at: null,
      cleared_at: null,
      pinned: false,
      pinned_at: null,
      pinned_order: null,
      profile: previewProfile(id, name, isCurrent ? fixture.currentUser.username : null),
    };
  });
}

export function previewChats(fixture: PublicPreviewFixture): ChatWithLastMessage[] {
  const members = previewMembers(fixture);
  return fixture.chats.map((chat, index) => {
    const isActive = index === 0;
    const chatId = previewChatId(index);
    return {
      id: chatId,
      type: isActive ? "group" : "private",
      // `useChats` resolves a display name onto every row, including private
      // chats, and the avatar reads it. Matching that keeps the preview faithful.
      name: chat.name,
      description: null,
      avatar_url: null,
      created_by: PREVIEW_IDS.currentUser,
      is_forum: false,
      invite_policy: "owner_admin_only",
      created_at: EPOCH,
      updated_at: EPOCH,
      // The open chat is marked read on mount by `ChatWindow`, so a badge on it
      // would be a state the product cannot show.
      unread_count: isActive ? 0 : chat.unread,
      members: isActive ? members : undefined,
      other_user: isActive
        ? undefined
        : previewProfile(PREVIEW_IDS.otherUser, chat.name, null),
      last_message: {
        id: `${chatId}-last`,
        chat_id: chatId,
        topic_id: null,
        user_id: PREVIEW_IDS.otherUser,
        bot_id: null,
        bot_reply_markup: null,
        content: chat.preview,
        type: "text",
        media_bucket: null,
        media_path: null,
        media_url: null,
        media_metadata: null,
        reply_to_id: null,
        forwarded_from_id: null,
        edited_at: null,
        deleted_at: null,
        pinned: false,
        created_at: todayAt(chat.time),
        client_message_id: null,
        client_sent_at: null,
        sender: previewProfile(PREVIEW_IDS.otherUser, chat.name, null),
      },
    };
  });
}

export function previewMessages(fixture: PublicPreviewFixture): MessageWithSender[] {
  return fixture.messages.map((message, index) => {
    const authorId = message.own ? PREVIEW_IDS.currentUser : PREVIEW_IDS.otherUser;
    return {
      id: `${PREVIEW_IDS.activeChat}-m${index}`,
      chat_id: PREVIEW_IDS.activeChat,
      topic_id: null,
      user_id: authorId,
      bot_id: null,
      bot_reply_markup: null,
      content: message.text,
      type: "text",
      media_bucket: null,
      media_path: null,
      media_url: null,
      media_metadata: null,
      reply_to_id: null,
      forwarded_from_id: null,
      edited_at: null,
      deleted_at: null,
      pinned: false,
      created_at: todayAt(message.time),
      client_message_id: null,
      client_sent_at: null,
      sender: previewProfile(
        authorId,
        message.sender,
        message.own ? fixture.currentUser.username : null,
      ),
    };
  });
}
