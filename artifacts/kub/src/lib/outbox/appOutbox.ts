/**
 * The application's one outbox (tracker item 52): the runner of
 * `outboxRunner.ts`, given the real server, the real store and the device's
 * storage.
 *
 * `useMessages` puts every text and media row through `enqueue`, so a message
 * is on the device before its first attempt; `useOutbox` starts it for the
 * signed-in account, puts back on screen what a restart left waiting, and
 * retries on every moment the connection may be back.
 */

import type { MessageWithSender } from "@/types/database";
import { MESSAGE_SELECT_WITH_JOINS } from "@/lib/messageProjection";
import { getMessageAckUserMessage, sanitizeMessageAckError } from "@/lib/messageAckError";
import { reportError } from "@/lib/monitoring";
import { blockedSendRefusal } from "@/lib/personalModeration";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import type { OutboxEntry } from "./outboxRules";
import { browserOutboxStorage } from "./outboxStorage";
import { createOutboxRunner, type SendAttempt } from "./outboxRunner";

/** How long one attempt waits for its answer before asking whether it landed. */
const SEND_ACK_TIMEOUT_MS = 12_000;

type Timed<T> = T | { timedOut: true };

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<Timed<T>> {
  return Promise.race<Timed<T>>([
    Promise.resolve(promise),
    new Promise<{ timedOut: true }>((resolve) => setTimeout(() => resolve({ timedOut: true }), ms)),
  ]);
}

function timedOut<T>(value: Timed<T>): value is { timedOut: true } {
  return Boolean(value && typeof value === "object" && "timedOut" in value);
}

function isMissingMediaMetadataError(error: unknown): boolean {
  const record = error as { code?: unknown; message?: unknown; details?: unknown } | null;
  const text = `${String(record?.code ?? "")} ${String(record?.message ?? "")} ${String(record?.details ?? "")}`.toLowerCase();
  return text.includes("media_metadata") && (text.includes("column") || text.includes("schema cache") || text.includes("pgrst204") || text.includes("42703"));
}

async function landedCopy(entry: OutboxEntry): Promise<MessageWithSender | null> {
  try {
    const { data } = await createClient()
      .from("messages")
      .select(MESSAGE_SELECT_WITH_JOINS)
      .eq("chat_id", entry.chatId)
      .eq("user_id", entry.userId)
      .eq("client_message_id", entry.clientMessageId)
      .maybeSingle();
    return data ? (data as unknown as MessageWithSender) : null;
  } catch {
    return null;
  }
}

/**
 * One attempt at one message: insert it, and when the answer does not say it
 * landed, ask the server whether it did — a retry after an attempt that landed
 * and lost its answer finds the row by `client_message_id` rather than making
 * a second one, which the unique index would refuse anyway.
 */
async function sendEntry(entry: OutboxEntry): Promise<SendAttempt<MessageWithSender>> {
  const basePayload = {
    chat_id: entry.chatId,
    topic_id: entry.topicId,
    user_id: entry.userId,
    content: entry.content,
    type: entry.type,
    media_bucket: entry.mediaBucket,
    media_path: entry.mediaPath,
    media_url: entry.mediaUrl,
    reply_to_id: entry.replyToId,
    forwarded_from_id: entry.forwardedFromId,
    client_message_id: entry.clientMessageId,
    client_sent_at: entry.clientSentAt,
  };
  const insert = (withMetadata: boolean) =>
    createClient()
      .from("messages")
      .insert(withMetadata && entry.mediaMetadata !== undefined ? { ...basePayload, media_metadata: entry.mediaMetadata } : basePayload)
      .select(MESSAGE_SELECT_WITH_JOINS)
      .single();

  let result = await withTimeout(insert(true), SEND_ACK_TIMEOUT_MS);
  if (timedOut(result)) {
    const landed = await landedCopy(entry);
    return landed ? { sent: landed } : { failed: { timedOut: true } };
  }
  if (result.error && entry.mediaMetadata !== undefined && isMissingMediaMetadataError(result.error)) {
    result = await withTimeout(insert(false), SEND_ACK_TIMEOUT_MS);
    if (timedOut(result)) {
      const landed = await landedCopy(entry);
      return landed ? { sent: landed } : { failed: { timedOut: true } };
    }
  }
  if (result.data) return { sent: result.data as unknown as MessageWithSender };
  const landed = await landedCopy(entry);
  if (landed) return { sent: landed };
  return { failed: { status: result.status, error: result.error } };
}

function rowOnScreen(entry: OutboxEntry): MessageWithSender | null {
  const messages = useAppStore.getState().messages[entry.chatId] ?? [];
  return messages.find((message) => message.id === entry.tempId) ?? null;
}

/** The sentence a refused send shows, decided as the send path always has. */
export function refusalSentence(chatId: string, error: unknown): string {
  const refusal = blockedSendRefusal({
    chatType: useAppStore.getState().chats.find((item) => item.id === chatId)?.type ?? null,
    error: error as Parameters<typeof blockedSendRefusal>[0]["error"],
  });
  return refusal ?? getMessageAckUserMessage(error as Parameters<typeof getMessageAckUserMessage>[0]);
}

export const appOutbox = createOutboxRunner<MessageWithSender>({
  storage: browserOutboxStorage(),
  send: sendEntry,
  onSent: (entry, row) => {
    const store = useAppStore.getState();
    store.replaceMessage(entry.chatId, entry.tempId, row);
    store.updateChatLastMessage(entry.chatId, row);
    // As the send path always has, and not awaited: see `touchChatUpdatedAt`.
    void createClient()
      .from("chats")
      .update({ updated_at: row.created_at })
      .eq("id", entry.chatId)
      .lt("updated_at", row.created_at)
      .then(() => undefined, () => undefined);
  },
  onWaiting: (entry) => {
    const shown = rowOnScreen(entry);
    if (!shown) return;
    // The clock, not red: nothing has refused it, the network has not answered.
    useAppStore.getState().replaceMessage(entry.chatId, entry.tempId, {
      ...shown,
      pending: true,
      checking: false,
      failed: false,
      send_error: null,
    });
  },
  onRefused: (entry, error) => {
    const safe = sanitizeMessageAckError(error as Parameters<typeof sanitizeMessageAckError>[0]);
    reportError(safe.error, {
      category: "message_send_failed",
      errorCode: safe.code,
      errorName: safe.name,
      type: entry.type,
      hasMedia: Boolean(entry.mediaUrl),
    });
    const shown = rowOnScreen(entry);
    if (!shown) return;
    const failed: MessageWithSender = {
      ...shown,
      pending: false,
      checking: false,
      failed: true,
      send_error: refusalSentence(entry.chatId, error),
    };
    const store = useAppStore.getState();
    store.replaceMessage(entry.chatId, entry.tempId, failed);
    store.updateChatLastMessage(entry.chatId, failed);
  },
});
