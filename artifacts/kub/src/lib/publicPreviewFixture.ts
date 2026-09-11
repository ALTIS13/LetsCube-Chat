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

/** One emoji on a message, and the people who put it — by the names they have in the fixture. */
export type PublicPreviewReaction = { emoji: string; users: string[] };

export type PublicPreviewMessage = {
  sender: string;
  text: string;
  time: string;
  own: boolean;
  image?: PublicPreviewImage;
  reactions?: PublicPreviewReaction[];
  /** The original author of a forwarded message, shown as «Переслано от …». */
  forwardedFrom?: string;
  /** When the message was edited, as HH:MM today. */
  editedAt?: string;
  pinned?: boolean;
};

export type PublicPreviewFixture = {
  currentUser: { name: string; username: string };
  // A count, never a rendered subtitle. `ChatHeader` composes the wording
  // itself, so the fixture cannot invent a string the product never emits.
  activeChat: {
    name: string;
    memberCount: number;
    /** A group unless it says otherwise. A private chat is the reader and the first other sender. */
    type?: "group" | "private";
    /** When the others read the conversation, as HH:MM today. Anyone not named has read it all. */
    readers?: { name: string; time: string }[];
  };
  chats: { name: string; preview: string; time: string; unread: number }[];
  messages: PublicPreviewMessage[];
  /** The six reactions beside ❤️, in this order, instead of this device's ranking. */
  recentReactions?: string[];
  /** Messages waiting above the composer to be forwarded, and the comment typed with them. */
  pendingForward?: { messages: { sender: string; text: string }[]; comment?: string };
};

/**
 * A picture on a fixture message, for the QA specs that open the photo viewer.
 *
 * A `data:image/` address and nothing else, so a fixture cannot point the
 * viewer at anything on a network — production media least of all. The product
 * previews carry none.
 */
export type PublicPreviewImage = { url: string; width: number; height: number };

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

function requirePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) fail(`${field} must be a positive integer`);
  return value;
}

/** An emoji is a short string; anything longer is a sentence smuggled into a chip. */
function requireEmoji(value: unknown, field: string): string {
  const emoji = requireString(value, field);
  if (emoji.length > 16) fail(`${field} must be a single emoji`);
  return emoji;
}

function requireImage(value: unknown, field: string): PublicPreviewImage {
  const image = asRecord(value, field);
  const url = requireString(image.url, `${field}.url`);
  // Refused rather than trusted: only an inline picture can be shown here.
  if (!url.startsWith("data:image/")) fail(`${field}.url must be a data:image/ URL`);
  return {
    url,
    width: requirePositiveInteger(image.width, `${field}.width`),
    height: requirePositiveInteger(image.height, `${field}.height`),
  };
}

function requireReactions(value: unknown, field: string): PublicPreviewReaction[] {
  return requireArray(value, field).map((entry, index) => {
    const reaction = asRecord(entry, `${field}[${index}]`);
    return {
      emoji: requireEmoji(reaction.emoji, `${field}[${index}].emoji`),
      users: requireArray(reaction.users, `${field}[${index}].users`).map((user, userIndex) =>
        requireString(user, `${field}[${index}].users[${userIndex}]`),
      ),
    };
  });
}

/** Validates a payload. Throws on anything the page could not render faithfully. */
export function parsePublicPreviewFixture(raw: unknown): PublicPreviewFixture {
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

  const messages = requireArray(fixture.messages, "messages").map((entry, index): PublicPreviewMessage => {
    const message = asRecord(entry, `messages[${index}]`);
    const field = `messages[${index}]`;
    if (typeof message.own !== "boolean") fail(`${field}.own must be a boolean`);
    if (message.pinned !== undefined && typeof message.pinned !== "boolean") fail(`${field}.pinned must be a boolean`);
    const image = message.image === undefined ? undefined : requireImage(message.image, `${field}.image`);
    const reactions = message.reactions === undefined ? undefined : requireReactions(message.reactions, `${field}.reactions`);
    const forwardedFrom =
      message.forwardedFrom === undefined ? undefined : requireString(message.forwardedFrom, `${field}.forwardedFrom`);
    const editedAt = message.editedAt === undefined ? undefined : requireDisplayTime(message.editedAt, `${field}.editedAt`);
    return {
      sender: requireString(message.sender, `${field}.sender`),
      text: requireString(message.text, `${field}.text`),
      time: requireDisplayTime(message.time, `${field}.time`),
      own: message.own,
      ...(image ? { image } : {}),
      ...(reactions ? { reactions } : {}),
      ...(forwardedFrom ? { forwardedFrom } : {}),
      ...(editedAt ? { editedAt } : {}),
      ...(message.pinned ? { pinned: true } : {}),
    };
  });

  const type = activeChat.type;
  if (type !== undefined && type !== "group" && type !== "private") fail('activeChat.type must be "group" or "private"');
  const readers = activeChat.readers === undefined
    ? undefined
    : requireArray(activeChat.readers, "activeChat.readers").map((entry, index) => {
        const reader = asRecord(entry, `activeChat.readers[${index}]`);
        return {
          name: requireString(reader.name, `activeChat.readers[${index}].name`),
          time: requireDisplayTime(reader.time, `activeChat.readers[${index}].time`),
        };
      });

  const recentReactions = fixture.recentReactions === undefined
    ? undefined
    : requireArray(fixture.recentReactions, "recentReactions").map((emoji, index) =>
        requireEmoji(emoji, `recentReactions[${index}]`),
      );
  if (recentReactions && recentReactions.length > 12) fail("recentReactions holds at most 12 emoji");

  let pendingForward: PublicPreviewFixture["pendingForward"];
  if (fixture.pendingForward !== undefined) {
    const forward = asRecord(fixture.pendingForward, "pendingForward");
    pendingForward = {
      messages: requireArray(forward.messages, "pendingForward.messages").map((entry, index) => {
        const message = asRecord(entry, `pendingForward.messages[${index}]`);
        return {
          sender: requireString(message.sender, `pendingForward.messages[${index}].sender`),
          text: requireString(message.text, `pendingForward.messages[${index}].text`),
        };
      }),
      ...(forward.comment === undefined ? {} : { comment: requireString(forward.comment, "pendingForward.comment") }),
    };
  }

  return {
    currentUser: {
      name: requireString(currentUser.name, "currentUser.name"),
      username: requireString(currentUser.username, "currentUser.username"),
    },
    activeChat: {
      name: requireString(activeChat.name, "activeChat.name"),
      memberCount: requireMemberCount(activeChat.memberCount),
      ...(type ? { type } : {}),
      ...(readers ? { readers } : {}),
    },
    chats,
    messages,
    ...(recentReactions ? { recentReactions } : {}),
    ...(pendingForward ? { pendingForward } : {}),
  };
}

/** Validates the injected payload. Returns null when nothing was injected. */
export function readPublicPreviewFixture(): PublicPreviewFixture | null {
  if (typeof window === "undefined") return null;
  const raw = window[PUBLIC_PREVIEW_WINDOW_KEY];
  if (raw === undefined) return null;
  return parsePublicPreviewFixture(raw);
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
    is_test_account: false,
    // The preview shows the product, not anyone's earned decoration.
    profile_frame: null,
    profile_background: null,
    online_at: EPOCH,
    role: "user",
    created_at: EPOCH,
    updated_at: EPOCH,
  };
}

/**
 * Everyone the conversation names, the reader first and then in order of
 * appearance: senders, then people who only reacted, then people who only read.
 * A name keeps one id everywhere it appears, which is what lets a reaction, a
 * read receipt and a message agree about who someone is.
 */
function previewPeople(fixture: PublicPreviewFixture): string[] {
  const names = [fixture.currentUser.name];
  const add = (name: string) => {
    if (!names.includes(name)) names.push(name);
  };
  for (const message of fixture.messages) add(message.sender);
  for (const message of fixture.messages) for (const reaction of message.reactions ?? []) reaction.users.forEach(add);
  for (const reader of fixture.activeChat.readers ?? []) add(reader.name);
  return names;
}

function personIdAt(index: number): string {
  if (index === 0) return PREVIEW_IDS.currentUser;
  if (index === 1) return PREVIEW_IDS.otherUser;
  return previewMemberId(index);
}

function previewPersonId(fixture: PublicPreviewFixture, name: string): string {
  const index = previewPeople(fixture).indexOf(name);
  return index < 0 ? PREVIEW_IDS.otherUser : personIdAt(index);
}

export function previewCurrentUser(fixture: PublicPreviewFixture): Profile {
  return previewProfile(PREVIEW_IDS.currentUser, fixture.currentUser.name, fixture.currentUser.username);
}

/** Members of the open group, so `ChatHeader` composes its own subtitle and
 * `MessageList` can derive real delivery state from `last_read_at`. */
export function previewMembers(fixture: PublicPreviewFixture): (ChatMember & { profile: Profile })[] {
  const isPrivate = fixture.activeChat.type === "private";
  const people = previewPeople(fixture);
  const named = isPrivate ? people.slice(0, 2) : [...people];
  while (!isPrivate && named.length < fixture.activeChat.memberCount) named.push(`—${named.length}`);
  const readAt = new Map((fixture.activeChat.readers ?? []).map((reader) => [reader.name, todayAt(reader.time)]));

  return named.map((name, index) => {
    const isCurrent = index === 0;
    const id = personIdAt(index);
    // Everyone has read the conversation unless the fixture says when, which
    // is what the open chat state actually is, so own messages render their
    // real read receipt.
    const lastRead = !isCurrent && readAt.has(name) ? readAt.get(name)! : new Date().toISOString();
    return {
      chat_id: PREVIEW_IDS.activeChat,
      user_id: id,
      role: isCurrent ? "owner" : "member",
      joined_at: EPOCH,
      last_read_at: lastRead,
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
  const isPrivate = fixture.activeChat.type === "private";
  return fixture.chats.map((chat, index) => {
    const isActive = index === 0;
    const chatId = previewChatId(index);
    const other = isActive && isPrivate ? members[1]?.profile : undefined;
    return {
      id: chatId,
      type: isActive ? (isPrivate ? "private" : "group") : "private",
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
        ? other
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
    const authorId = message.own ? PREVIEW_IDS.currentUser : previewPersonId(fixture, message.sender);
    const id = `${PREVIEW_IDS.activeChat}-m${index}`;
    const createdAt = todayAt(message.time);
    // A picture makes an image message whose text is its caption, shaped the
    // way an uploaded photo is: the dimensions reserve the bubble's aspect.
    const image = message.image;
    return {
      id,
      chat_id: PREVIEW_IDS.activeChat,
      topic_id: null,
      user_id: authorId,
      bot_id: null,
      bot_reply_markup: null,
      content: message.text,
      type: image ? "image" : "text",
      media_bucket: null,
      media_path: null,
      media_url: image ? image.url : null,
      media_metadata: image ? { kind: "image", width: image.width, height: image.height } : null,
      reply_to_id: null,
      forwarded_from_id: message.forwardedFrom ? `${PREVIEW_IDS.activeChat}-f${index}` : null,
      forward_origin: message.forwardedFrom ? { name: message.forwardedFrom } : null,
      edited_at: message.editedAt ? todayAt(message.editedAt) : null,
      deleted_at: null,
      pinned: Boolean(message.pinned),
      created_at: createdAt,
      client_message_id: null,
      client_sent_at: null,
      reactions: (message.reactions ?? []).flatMap((reaction, reactionIndex) =>
        reaction.users.map((name, userIndex) => ({
          id: `${id}-r${reactionIndex}-${userIndex}`,
          message_id: id,
          user_id: name === fixture.currentUser.name ? PREVIEW_IDS.currentUser : previewPersonId(fixture, name),
          emoji: reaction.emoji,
          created_at: createdAt,
        })),
      ),
      sender: previewProfile(
        authorId,
        message.sender,
        message.own ? fixture.currentUser.username : null,
      ),
    };
  });
}

/** The messages a fixture has waiting above the composer, shaped like rows from another chat. */
export function previewForwardDraft(fixture: PublicPreviewFixture): MessageWithSender[] {
  return (fixture.pendingForward?.messages ?? []).map((message, index) => {
    const senderId = `00000000-0000-4000-8000-0000000000${(0x81 + index).toString(16)}`;
    return {
      id: `00000000-0000-4000-8000-0000000000${(0x91 + index).toString(16)}`,
      chat_id: previewChatId(1),
      topic_id: null,
      user_id: senderId,
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
      created_at: EPOCH,
      client_message_id: null,
      client_sent_at: null,
      sender: previewProfile(senderId, message.sender, null),
    };
  });
}
