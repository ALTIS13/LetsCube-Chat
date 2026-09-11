import { dispatchChatNotificationsRead } from "@/lib/notificationEvents";
import { createReceiptScheduler, type ReceiptRpcClient } from "@/lib/receiptScheduler";
import { isMissingRpcError, rpcAvailability } from "@/lib/rpcAvailability";

/**
 * This application's delivered and read reports.
 *
 * The rules — the quiet periods, what counts as newer, which function a read
 * goes to and what happens where it is not deployed — are
 * `lib/receiptScheduler.ts`, where `node --test` pins them. This binds them to
 * the browser's timers, to the one record of which functions the server has,
 * and to the notification centre's read sync.
 */

const scheduler = createReceiptScheduler({
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
  availability: rpcAvailability,
  isMissingRpc: isMissingRpcError,
  onRead: ({ chatId, readUntil }) => dispatchChatNotificationsRead({ chatId, readUntil }),
  onError: (rpcName, error) => {
    if (import.meta.env.DEV) console.warn(`[${rpcName}] failed`, error);
  },
});

/** Any client whose `rpc` answers with an error field — the Supabase client included. */
type RpcCapable = { rpc: (fn: never, args: never) => PromiseLike<{ error: unknown }> };

export function scheduleMarkChatDelivered(
  client: RpcCapable,
  chatId: string | null | undefined,
  latestIncomingCreatedAt?: string | null,
) {
  scheduler.scheduleDelivered(client as unknown as ReceiptRpcClient, chatId, latestIncomingCreatedAt);
}

export function scheduleMarkChatRead(
  client: RpcCapable,
  chatId: string | null | undefined,
  latestVisibleCreatedAt?: string | null,
) {
  scheduler.scheduleRead(client as unknown as ReceiptRpcClient, chatId, latestVisibleCreatedAt);
}
