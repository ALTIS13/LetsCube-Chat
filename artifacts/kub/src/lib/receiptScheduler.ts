import { timestampMicros } from "./readMarkWatermark.ts";
import type { RpcAvailability } from "./rpcAvailability.ts";

/**
 * When this device tells the server what it has received and read.
 *
 * Each chat keeps a watermark per lane — delivered and read — and a report is
 * sent after a short quiet period with the newest watermark scheduled. A
 * watermark at or behind what is already scheduled or confirmed sends nothing,
 * which is how a stale render cannot report an older read.
 *
 * A read goes to `mark_chat_read_through` with the newest drawn message's own
 * `created_at` string, so the server marks as read what this device drew and
 * not whatever arrived while the request was in flight. Where that function is
 * not deployed the report goes to `mark_chat_read`, as before, and the
 * fallback is remembered (see `rpcAvailability`). A failed report clears its
 * schedule so the next render reports again — which is how a reconnect
 * reconciles: the refetch that follows it schedules the read once more.
 *
 * Kept free of React, Supabase and timers so `node --test` can drive it.
 */

export const DELIVERED_DEBOUNCE_MS = 2500;
export const READ_DEBOUNCE_MS = 700;
export const READ_THROUGH_RPC = "mark_chat_read_through";
export const READ_RPC = "mark_chat_read";
export const DELIVERED_RPC = "mark_chat_delivered";

export interface ReceiptRpcClient {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
}

export interface ReceiptSchedulerDeps {
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** Milliseconds, for a report made without a message to date it by. */
  now: () => number;
  availability: RpcAvailability;
  isMissingRpc: (error: unknown) => boolean;
  /** A read the server accepted, up to the string it was reported with. */
  onRead?: (detail: { chatId: string; readUntil: string | null }) => void;
  onError?: (rpcName: string, error: unknown) => void;
}

interface Watermark {
  micros: number;
  /** The server's own string, or null when the report is "now". */
  raw: string | null;
}

interface Lane {
  timers: Map<string, unknown>;
  scheduled: Map<string, Watermark>;
  confirmed: Map<string, number>;
}

type SendResult = { error: unknown; rpcName: string };

function emptyLane(): Lane {
  return { timers: new Map(), scheduled: new Map(), confirmed: new Map() };
}

export function createReceiptScheduler(deps: ReceiptSchedulerDeps) {
  const delivered = emptyLane();
  const read = emptyLane();

  const watermarkOf = (value: string | null | undefined): Watermark => {
    const micros = timestampMicros(value);
    return micros === null ? { micros: deps.now() * 1000, raw: null } : { micros, raw: value as string };
  };

  async function call(client: ReceiptRpcClient, rpcName: string, args: Record<string, unknown>): Promise<SendResult> {
    try {
      const { error } = await client.rpc(rpcName, args);
      return { error: error ?? null, rpcName };
    } catch (error) {
      return { error: error ?? new Error(`${rpcName} failed`), rpcName };
    }
  }

  async function sendRead(client: ReceiptRpcClient, chatId: string, raw: string | null): Promise<SendResult> {
    if (deps.availability.shouldTry(READ_THROUGH_RPC)) {
      const result = await call(client, READ_THROUGH_RPC, { p_chat_id: chatId, p_read_through: raw });
      if (!result.error) {
        deps.availability.markPresent(READ_THROUGH_RPC);
        return result;
      }
      if (!deps.isMissingRpc(result.error)) return result;
      deps.availability.markMissing(READ_THROUGH_RPC);
    }
    return call(client, READ_RPC, { p_chat_id: chatId });
  }

  function sendDelivered(client: ReceiptRpcClient, chatId: string): Promise<SendResult> {
    return call(client, DELIVERED_RPC, { p_chat_id: chatId });
  }

  function schedule(
    lane: Lane,
    client: ReceiptRpcClient,
    chatId: string | null | undefined,
    value: string | null | undefined,
    delayMs: number,
    send: (client: ReceiptRpcClient, chatId: string, raw: string | null) => Promise<SendResult>,
    onConfirmed?: (chatId: string, raw: string | null) => void,
  ): void {
    if (!chatId) return;
    const mark = watermarkOf(value);
    const known = Math.max(lane.scheduled.get(chatId)?.micros ?? 0, lane.confirmed.get(chatId) ?? 0);
    if (mark.micros <= known) return;

    lane.scheduled.set(chatId, mark);
    const existing = lane.timers.get(chatId);
    if (existing !== undefined) deps.clearTimer(existing);

    const timer = deps.setTimer(() => {
      lane.timers.delete(chatId);
      const pending = lane.scheduled.get(chatId) ?? mark;
      void send(client, chatId, pending.raw).then(({ error, rpcName }) => {
        if (error) {
          if (lane.scheduled.get(chatId) === pending) lane.scheduled.delete(chatId);
          deps.onError?.(rpcName, error);
          return;
        }
        lane.confirmed.set(chatId, Math.max(lane.confirmed.get(chatId) ?? 0, pending.micros));
        if (lane.scheduled.get(chatId) === pending) lane.scheduled.delete(chatId);
        onConfirmed?.(chatId, pending.raw);
      });
    }, delayMs);
    lane.timers.set(chatId, timer);
  }

  return {
    scheduleDelivered(client: ReceiptRpcClient, chatId: string | null | undefined, latestIncomingCreatedAt?: string | null) {
      schedule(delivered, client, chatId, latestIncomingCreatedAt, DELIVERED_DEBOUNCE_MS, (c, id) => sendDelivered(c, id));
    },
    scheduleRead(client: ReceiptRpcClient, chatId: string | null | undefined, latestVisibleCreatedAt?: string | null) {
      schedule(read, client, chatId, latestVisibleCreatedAt, READ_DEBOUNCE_MS, sendRead, (id, raw) =>
        deps.onRead?.({ chatId: id, readUntil: raw }),
      );
    },
  };
}
