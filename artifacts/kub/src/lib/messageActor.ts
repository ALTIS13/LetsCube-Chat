import type { BotProfile, MessageWithSender, Profile } from "../types/database.ts";

type ActorSource = Pick<MessageWithSender, "id" | "type" | "user_id" | "bot_id" | "client_message_id"> & {
  sender?: Profile | null;
  bot?: BotProfile | null;
};

export type MessageActor =
  | { kind: "user"; id: string; profile: Profile }
  | { kind: "bot"; id: string; bot: BotProfile }
  | { kind: "deleted_bot"; id: string }
  | { kind: "deleted_user" }
  | { kind: "system" }
  | { kind: "invalid" };

export function resolveMessageActor(message: Partial<ActorSource>): MessageActor {
  const userId = message.user_id ?? null;
  const botId = message.bot_id ?? null;
  const sender = message.sender ?? null;
  const bot = message.bot ?? null;

  if (message.type === "system") {
    return userId === null && botId === null && sender === null && bot === null
      ? { kind: "system" }
      : { kind: "invalid" };
  }

  if (userId !== null && botId === null) {
    if (sender?.id === userId && bot === null) {
      return { kind: "user", id: userId, profile: sender };
    }
    return { kind: "invalid" };
  }

  if (botId !== null && userId === null) {
    if (sender !== null) return { kind: "invalid" };
    if (bot === null) return { kind: "deleted_bot", id: botId };
    if (bot.id !== botId) return { kind: "invalid" };
    return bot.state === "deleted"
      ? { kind: "deleted_bot", id: botId }
      : { kind: "bot", id: botId, bot };
  }

  if (userId === null && botId === null && sender === null && bot === null) {
    return { kind: "deleted_user" };
  }

  return { kind: "invalid" };
}

export function messageActorDisplayName(message: Partial<ActorSource> | MessageActor): string {
  const actor = isResolvedActor(message) ? message : resolveMessageActor(message);
  switch (actor.kind) {
    case "user":
      return actor.profile.full_name?.trim() || actor.profile.username?.trim() || "Участник";
    case "bot":
      return actor.bot.display_name.trim() || `@${actor.bot.username}`;
    case "deleted_bot":
      return "Удалённый бот";
    case "deleted_user":
      return "Удалённый пользователь";
    case "system":
      return "Система";
    default:
      return "Неизвестный отправитель";
  }
}

export function messageActorAvatarUrl(message: Partial<ActorSource> | MessageActor): string | null {
  const actor = isResolvedActor(message) ? message : resolveMessageActor(message);
  if (actor.kind === "user") return actor.profile.avatar_url ?? null;
  if (actor.kind === "bot") return actor.bot.avatar_url ?? null;
  return null;
}

export function messageActorGroupingKey(message: Partial<ActorSource>): string {
  const actor = resolveMessageActor(message);
  if (actor.kind === "user" || actor.kind === "bot" || actor.kind === "deleted_bot") {
    return `${actor.kind === "deleted_bot" ? "bot" : actor.kind}:${actor.id}`;
  }
  if (actor.kind === "system") return "system";
  return `${actor.kind}:${message.id ?? "unknown"}`;
}

export function sameActorClientMessage(
  left: Partial<ActorSource>,
  right: Partial<ActorSource>,
): boolean {
  if (
    !left.client_message_id ||
    !right.client_message_id ||
    left.client_message_id !== right.client_message_id
  ) {
    return false;
  }
  const leftKey = persistedSenderKey(left);
  return leftKey !== null && leftKey === persistedSenderKey(right);
}

export function actorClientMessageKey(message: Partial<ActorSource>): string | null {
  if (!message.client_message_id) return null;
  const senderKey = persistedSenderKey(message);
  return senderKey ? `${senderKey}:${message.client_message_id}` : null;
}

export function canUseHumanMessageControls(
  message: Partial<ActorSource>,
  currentUserId: string | null | undefined,
): boolean {
  const actor = resolveMessageActor(message);
  return Boolean(currentUserId && actor.kind === "user" && actor.id === currentUserId);
}

export function isIncomingMessage(
  message: { type?: string | null; user_id: string | null; bot_id: string | null },
  currentUserId: string,
): boolean {
  if (message.type === "system") return false;
  if (message.user_id !== null && message.bot_id === null) {
    return message.user_id !== currentUserId;
  }
  return message.bot_id !== null && message.user_id === null;
}

function isResolvedActor(value: Partial<ActorSource> | MessageActor): value is MessageActor {
  return typeof (value as MessageActor).kind === "string";
}

function persistedSenderKey(message: Partial<ActorSource>): string | null {
  if (message.type === "system") return null;
  const userId = message.user_id ?? null;
  const botId = message.bot_id ?? null;
  if (userId !== null && botId === null) return `user:${userId}`;
  if (botId !== null && userId === null) return `bot:${botId}`;
  return null;
}
