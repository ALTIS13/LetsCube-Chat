/**
 * The outbox: messages written and not yet confirmed, kept on the device and
 * sent in order until the server has them (tracker item 52; the rules are
 * `outboxRules.ts`).
 *
 * Every send goes through here, not only the ones that fail: a message is put
 * on the device *before* its first attempt, so a restart in the middle of that
 * attempt loses nothing, and the first attempt and every retry are the same
 * code. `enqueue` answers with the first attempt's outcome, so the composer's
 * caller can go on reading «sent» or «not yet» exactly as it did.
 *
 * What the runner does not know is how a message is sent or drawn: `send` and
 * the three `on…` callbacks are given to it. That keeps it free of React and of
 * the network, so `node --test` drives it with a fake server and a fake clock.
 */

import {
  classifySendFailure,
  entriesToSend,
  nextDueAt,
  retryDelay,
  type OutboxEntry,
  type SendFailure,
} from "./outboxRules.ts";
import type { OutboxStorage } from "./outboxStorage.ts";

export type SendAttempt<Row> =
  | { sent: Row }
  | { failed: { status?: number | null; error?: unknown; timedOut?: boolean; retainForRetry?: boolean } };

export type SendOutcome<Row> =
  | { kind: "sent"; row: Row }
  | { kind: "waiting" }
  | { kind: "refused"; error: unknown };

export interface OutboxRunnerDeps<Row> {
  storage: OutboxStorage;
  send: (entry: OutboxEntry) => Promise<SendAttempt<Row>>;
  /** The server has it: replace the bubble with the server's row. */
  onSent: (entry: OutboxEntry, row: Row) => void;
  /** Unanswered: the bubble waits with its clock. */
  onWaiting: (entry: OutboxEntry) => void;
  /** Refused: the bubble turns red and leaves the outbox. */
  onRefused: (entry: OutboxEntry, error: unknown) => void;
  now?: () => number;
  timers?: { set: (callback: () => void, ms: number) => unknown; clear: (handle: unknown) => void };
}

export function createOutboxRunner<Row>(deps: OutboxRunnerDeps<Row>) {
  const now = deps.now ?? (() => Date.now());
  const timers = deps.timers ?? {
    set: (callback: () => void, ms: number): unknown => setTimeout(callback, ms),
    clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };

  const entries = new Map<string, OutboxEntry>();
  const busy = new Set<string>();
  const waiters = new Map<string, (outcome: SendOutcome<Row>) => void>();
  let wake: unknown = null;
  let userId: string | null = null;
  let accountEpoch = 0;

  const settle = (id: string, outcome: SendOutcome<Row>) => {
    const resolve = waiters.get(id);
    waiters.delete(id);
    resolve?.(outcome);
  };

  const schedule = () => {
    if (wake !== null) timers.clear(wake);
    wake = null;
    const due = nextDueAt(entriesToSend([...entries.values()], Number.POSITIVE_INFINITY, busy));
    if (due === null) return;
    wake = timers.set(() => {
      wake = null;
      void drain();
    }, Math.max(due - now(), 0));
  };

  const attempt = async (entry: OutboxEntry, epoch: number) => {
    const ownsSession = () => epoch === accountEpoch && userId === entry.userId;
    if (!ownsSession()) return;
    busy.add(entry.clientMessageId);
    let result: SendAttempt<Row>;
    try {
      result = await deps.send(entry);
    } catch (error) {
      result = { failed: { error } };
    }
    // Discarded while it was out: whatever the server said, the person has
    // already taken it off the screen.
    if (!ownsSession() || entries.get(entry.clientMessageId) !== entry) return;
    busy.delete(entry.clientMessageId);

    if ("sent" in result) {
      entries.delete(entry.clientMessageId);
      await deps.storage.remove(entry.clientMessageId);
      if (!ownsSession()) return;
      deps.onSent(entry, result.sent);
      settle(entry.clientMessageId, { kind: "sent", row: result.sent });
      return;
    }
    const failure: SendFailure = classifySendFailure(result.failed);
    if (failure === "refused") {
      entries.delete(entry.clientMessageId);
      // A missing mention schema is retryable without dropping identities.
      // Keep it on disk, but do not loop a refused send in this session.
      if (result.failed.retainForRetry) await deps.storage.put(entry);
      else await deps.storage.remove(entry.clientMessageId);
      if (!ownsSession()) return;
      deps.onRefused(entry, result.failed.error ?? null);
      settle(entry.clientMessageId, { kind: "refused", error: result.failed.error ?? null });
      return;
    }
    const attempts = entry.attempts + 1;
    const waiting: OutboxEntry = { ...entry, attempts, nextAttemptAt: now() + retryDelay(attempts) };
    entries.set(entry.clientMessageId, waiting);
    await deps.storage.put(waiting);
    if (!ownsSession() || entries.get(entry.clientMessageId) !== waiting) return;
    deps.onWaiting(waiting);
    settle(entry.clientMessageId, { kind: "waiting" });
  };

  let drainingEpoch: number | null = null;
  let again = false;
  const drain = async (): Promise<void> => {
    if (!userId) return;
    const epoch = accountEpoch;
    if (drainingEpoch === epoch) {
      again = true;
      return;
    }
    drainingEpoch = epoch;
    try {
      do {
        again = false;
        const ready = entriesToSend([...entries.values()], now(), busy);
        await Promise.all(ready.map((entry) => attempt(entry, epoch)));
        if (epoch !== accountEpoch) return;
        // Whatever went out and landed may have released the next one of its
        // chat, which is due at once.
        if (ready.length > 0 && entriesToSend([...entries.values()], now(), busy).length > 0) again = true;
      } while (again && epoch === accountEpoch);
    } finally {
      if (epoch === accountEpoch) {
        drainingEpoch = null;
        schedule();
      }
    }
  };

  return {
    /** Whose messages this runner sends; a different account's entries stay on disk. */
    async start(forUserId: string): Promise<OutboxEntry[]> {
      if (userId === forUserId) return [...entries.values()].map((entry) => structuredClone(entry));
      const epoch = ++accountEpoch;
      userId = forUserId;
      entries.clear();
      busy.clear();
      if (wake !== null) timers.clear(wake);
      wake = null;
      for (const id of [...waiters.keys()]) settle(id, { kind: "waiting" });
      const stored = await deps.storage.list(forUserId);
      if (epoch !== accountEpoch || userId !== forUserId) return [];
      // Restored entries are due at once: the restart is itself a moment to try.
      for (const entry of stored) {
        if (entry.userId !== forUserId || entries.has(entry.clientMessageId)) continue;
        entries.set(entry.clientMessageId, structuredClone({ ...entry, nextAttemptAt: now() }));
      }
      void drain();
      return [...entries.values()].map((entry) => structuredClone(entry));
    },

    stop() {
      accountEpoch += 1;
      userId = null;
      entries.clear();
      busy.clear();
      if (wake !== null) timers.clear(wake);
      wake = null;
      for (const id of [...waiters.keys()]) settle(id, { kind: "waiting" });
    },

    /** Keeps a message on the device, then sends it; answers with that first attempt. */
    async enqueue(entry: OutboxEntry): Promise<SendOutcome<Row>> {
      const epoch = accountEpoch;
      const queued: OutboxEntry = structuredClone({ ...entry, nextAttemptAt: now() });
      if (userId !== queued.userId) {
        await deps.storage.put(queued);
        return { kind: "waiting" };
      }
      entries.set(queued.clientMessageId, queued);
      // A concurrently finishing attempt cannot send this before persistence.
      busy.add(queued.clientMessageId);
      const outcome = new Promise<SendOutcome<Row>>((resolve) => waiters.set(queued.clientMessageId, resolve));
      await deps.storage.put(queued);
      if (epoch === accountEpoch && entries.get(queued.clientMessageId) === queued) {
        busy.delete(queued.clientMessageId);
        void drain();
      }
      return outcome;
    },

    /** A moment the connection may be back: everything waiting is due now. */
    retryNow() {
      for (const [id, entry] of entries) {
        if (!busy.has(id)) entries.set(id, { ...entry, nextAttemptAt: now() });
      }
      void drain();
    },

    /** «Удалить» on a waiting message: it will not be sent. */
    async discard(clientMessageId: string) {
      entries.delete(clientMessageId);
      await deps.storage.remove(clientMessageId);
      settle(clientMessageId, { kind: "waiting" });
      schedule();
    },

    has(clientMessageId: string) {
      return entries.has(clientMessageId);
    },

    size() {
      return entries.size;
    },
  };
}

export type OutboxRunner<Row> = ReturnType<typeof createOutboxRunner<Row>>;
