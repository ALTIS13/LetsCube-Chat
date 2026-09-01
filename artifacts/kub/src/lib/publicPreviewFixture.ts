import type { ChatWithLastMessage, MessageWithSender, Profile } from "@/types/database";

/**
 * DEV-only support for capturing public product previews.
 *
 * The fixture is never imported by the application. The capture script reads
 * the checked-in file and injects it into a clean browser context, so no demo
 * content can reach a production bundle even by accident. Everything here is
 * behind a two-part gate and touches neither Supabase nor authentication.
 */

export const PUBLIC_PREVIEW_WINDOW_KEY = "__letscubePublicPreviewFixture";
export const PUBLIC_PREVIEW_READY_ATTRIBUTE = "data-public-preview-ready";

export type PublicPreviewFixture = {
  currentUser: { name: string; username: string };
  activeChat: { name: string; members: string };
  chats: { name: string; preview: string; time: string; unread: number }[];
  messages: { sender: string; text: string; time: string; own: boolean }[];
};

declare global {
  interface Window {
    [PUBLIC_PREVIEW_WINDOW_KEY]?: unknown;
  }
}

/**
 * Both halves are required. `import.meta.env.DEV` is statically false in a
 * production build, so every caller of this gate — and the lazy chunk behind
 * it — is dropped at build time. A query flag alone can never enable capture.
 */
export function isPublicPreviewCaptureEnabled(): boolean {
  return Boolean(import.meta.env.DEV) && import.meta.env.VITE_PUBLIC_PREVIEW_FIXTURE === "1";
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
      members: requireString(activeChat.members, "activeChat.members"),
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
  secondChat: "00000000-0000-4000-8000-0000000000a2",
} as const;

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

export function previewChats(fixture: PublicPreviewFixture): ChatWithLastMessage[] {
  return fixture.chats.map((chat, index) => {
    const isActive = index === 0;
    const chatId = isActive ? PREVIEW_IDS.activeChat : PREVIEW_IDS.secondChat;
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
      unread_count: chat.unread,
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
