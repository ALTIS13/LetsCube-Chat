import { dispatchChatNotificationsRead } from "@/lib/notificationEvents";
import { createReceiptScheduler, type ReceiptRpcClient } from "@/lib/receiptScheduler";
import { isMissingRpcError, rpcAvailability } from "@/lib/rpcAvailability";
import { useAppStore } from "@/store/app.store";

/**
 * This application's delivered and read reports.
 *
 * The rules — the quiet periods, what counts as newer, which function a read
 * goes to and what happens where it is not deployed — are
 * `lib/receiptScheduler.ts`, where `node --test` pins them. This binds them to
 * the browser's timers, to the one record of which functions the server has,
 * and to the notification centre's read sync.
 */

type ReceiptOwner = {
  userId: string;
  accountEpoch: number;
  scheduler: ReturnType<typeof createReceiptScheduler>;
};
let owner: ReceiptOwner | null = null;

function isCurrentOwner(candidate: ReceiptOwner): boolean {
  const state = useAppStore.getState();
  return owner === candidate && state.currentUser?.id === candidate.userId
    && state.accountEpoch === candidate.accountEpoch;
}

function retireOwner() {
  owner?.scheduler.dispose();
  owner = null;
}

// Cancel waiting timers immediately; request continuations also read the store
// directly, so batching/delayed observers cannot extend an old owner's authority.
useAppStore.subscribe(() => {
  if (owner && !isCurrentOwner(owner)) retireOwner();
});

function currentScheduler() {
  if (owner && !isCurrentOwner(owner)) retireOwner();
  const state = useAppStore.getState();
  const userId = state.currentUser?.id;
  if (!userId) return null;
  if (!owner) {
    const candidate: ReceiptOwner = {
      userId,
      accountEpoch: state.accountEpoch,
      scheduler: createReceiptScheduler({
        setTimer: (callback, ms) => setTimeout(callback, ms),
        clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        now: () => Date.now(),
        availability: rpcAvailability,
        isMissingRpc: isMissingRpcError,
        isCurrent: () => isCurrentOwner(candidate),
        onRead: ({ chatId, readUntil }) => dispatchChatNotificationsRead({ chatId, readUntil }),
        onError: (rpcName, error) => {
          if (import.meta.env.DEV) console.warn(`[${rpcName}] failed`, error);
        },
      }),
    };
    owner = candidate;
  }
  return owner.scheduler;
}

/** Any client whose `rpc` answers with an error field — the Supabase client included. */
type RpcCapable = { rpc: (fn: never, args: never) => PromiseLike<{ error: unknown }> };

export function scheduleMarkChatDelivered(
  client: RpcCapable,
  chatId: string | null | undefined,
  latestIncomingCreatedAt?: string | null,
) {
  currentScheduler()?.scheduleDelivered(client as unknown as ReceiptRpcClient, chatId, latestIncomingCreatedAt);
}

export function scheduleMarkChatRead(
  client: RpcCapable,
  chatId: string | null | undefined,
  latestVisibleCreatedAt?: string | null,
) {
  currentScheduler()?.scheduleRead(client as unknown as ReceiptRpcClient, chatId, latestVisibleCreatedAt);
}
