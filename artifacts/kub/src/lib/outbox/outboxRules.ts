/**
 * The outbox's rules: what a message waiting to be sent is, which failures mean
 * «wait and try again» and which mean «the server said no», and in what order
 * waiting messages go (tracker item 52).
 *
 * The report, 2026-09-28, from two testers on their first day: a message
 * written without a connection could not be sent later — it turned red at once,
 * and after a restart it was gone; a voice note had to be recorded again. «Прям
 * сильно пользовательский опыт погубило». Telegram's mechanic, which this
 * adopts: a message written offline appears at once with a clock, is kept on
 * the device, survives a restart, and goes by itself, in order, when the
 * connection returns. Red is reserved for a refusal — the server answered and
 * said no — which no amount of waiting will change.
 *
 * The server half already exists: `client_message_id` is unique per chat and
 * author, so sending the same message again cannot make a second one; a retry
 * that finds its first attempt landed reads that row back instead.
 *
 * Pure, so `node --test` reads every case; `outboxRunner.ts` applies them.
 */

import type { Json } from "../../types/database.ts";
import type { SendableMessageType } from "../optimisticMessage.ts";

export interface OutboxEntry {
  clientMessageId: string;
  userId: string;
  chatId: string;
  topicId: string | null;
  type: SendableMessageType;
  content: string | null;
  replyToId: string | null;
  forwardedFromId: string | null;
  mediaBucket: string | null;
  mediaPath: string | null;
  mediaUrl: string | null;
  /** Absent means «do not send the column» — a server without it refuses it. */
  mediaMetadata?: Json | null;
  clientSentAt: string;
  /** The id of the bubble on screen while it waits. */
  tempId: string;
  /** Attempts that went unanswered. */
  attempts: number;
  /** When the next attempt may go, in epoch milliseconds. */
  nextAttemptAt: number;
}

/**
 * How long to wait after each unanswered attempt. Short first — a connection
 * that blinked is back in seconds — then settling at a minute, because the
 * moments that bring a connection back (`online`, a network change, the return
 * to the app) try again at once anyway and do not wait for this.
 */
export const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 30_000, 60_000] as const;

export function retryDelay(attempts: number): number {
  const index = Math.min(Math.max(attempts - 1, 0), RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[index];
}

export type SendFailure = "unanswered" | "refused";

const UNANSWERED_WORDS = ["failed to fetch", "networkerror", "network error", "load failed", "fetch failed", "network request failed"];

/**
 * Whether a failed send went unanswered — the network's fault, worth waiting
 * out — or was refused by a server that answered.
 *
 * `status` is the HTTP status the client saw: 0 when no response came back,
 * which is what PostgREST's client reports for a fetch that failed. A gateway's
 * 502/503/504 is the network's too: the database never saw the request.
 */
export function classifySendFailure(input: { status?: number | null; error?: unknown; timedOut?: boolean }): SendFailure {
  if (input.timedOut) return "unanswered";
  const status = input.status ?? null;
  if (status === 0) return "unanswered";
  if (status === 502 || status === 503 || status === 504) return "unanswered";
  if (status !== null && status >= 400) return "refused";
  const error = input.error;
  if (error instanceof TypeError) return "unanswered";
  const message =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string"
        ? (error as { message: string }).message
        : "";
  const lower = message.toLowerCase();
  if (UNANSWERED_WORDS.some((word) => lower.includes(word))) return "unanswered";
  return "refused";
}

/**
 * The entries that may go now, in the order they must go: per chat, in the
 * order they were written, and never past an earlier one of the same chat that
 * is still waiting — a later message overtaking an earlier one would reorder
 * the conversation for everyone reading it.
 */
export function entriesToSend(entries: readonly OutboxEntry[], now: number, busy: ReadonlySet<string>): OutboxEntry[] {
  const byChat = new Map<string, OutboxEntry[]>();
  for (const entry of entries) {
    const list = byChat.get(entry.chatId) ?? [];
    list.push(entry);
    byChat.set(entry.chatId, list);
  }
  const ready: OutboxEntry[] = [];
  for (const list of byChat.values()) {
    list.sort((a, b) => a.clientSentAt.localeCompare(b.clientSentAt) || a.clientMessageId.localeCompare(b.clientMessageId));
    const first = list[0];
    if (!first || busy.has(first.clientMessageId) || first.nextAttemptAt > now) continue;
    ready.push(first);
  }
  return ready.sort((a, b) => a.clientSentAt.localeCompare(b.clientSentAt));
}

/** The next moment any entry becomes due, or null when none waits. */
export function nextDueAt(entries: readonly OutboxEntry[]): number | null {
  let soonest: number | null = null;
  for (const entry of entries) {
    if (soonest === null || entry.nextAttemptAt < soonest) soonest = entry.nextAttemptAt;
  }
  return soonest;
}
