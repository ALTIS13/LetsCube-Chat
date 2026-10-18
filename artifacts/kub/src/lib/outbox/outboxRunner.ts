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

export type RetainOutcome = { ok: true } | { ok: false; error: unknown };

export interface OutboxRunnerDeps<Row> {
  storage: OutboxStorage;
  send: (entry: OutboxEntry) => Promise<SendAttempt<Row>>;
  /** The server has it: replace the bubble with the server's row. */
  onSent: (entry: OutboxEntry, row: Row) => void;
  /** Unanswered: the bubble waits with its clock. */
  onWaiting: (entry: OutboxEntry) => void;
  /** Refusal or failed local persistence: show failure, not a saved clock. */
  onRefused: (entry: OutboxEntry, error: unknown) => void;
  /** Remote ACK remains valid even if its local cleanup could not commit. */
  onStorageError?: (error: unknown) => void;
  /** Hold quiet reload while a write or cancellation has no committed copy. */
  holdPersistence?: () => (() => void);
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
  // A failed write keeps the work present, but only an explicit enqueue may
  // put it back in the live queue. A persistence-only retain does not do that.
  const requiresExplicitRetry = new Set<string>();
  const waiters = new Map<string, (outcome: SendOutcome<Row>) => void>();
  const discardedDuringRestore = new Set<string>();
  // Commit permits a new explicit enqueue, never an automatic old-prefix
  // retain. Keep that distinction across this singleton's stop/start.
  const cancellations = new Map<string, "pending" | "committed" | "requeued">();
  const discarding = new Map<string, Promise<{ ok: boolean }>>();
  const persistenceHolds = new Map<string, () => void>();
  const writes = new Map<string, Promise<void>>();
  let wake: unknown = null;
  let userId: string | null = null;
  let accountEpoch = 0;
  let restored = false;
  let restoring: Promise<OutboxEntry[]> | null = null;
  const keyFor = (entry: Pick<OutboxEntry, "userId" | "clientMessageId">) => `${entry.userId}:${entry.clientMessageId}`;
  const cancelled = (entry: OutboxEntry) => {
    const state = cancellations.get(keyFor(entry));
    return state === "pending" || state === "committed";
  };
  const holdPersistence = (key: string) => {
    if (!persistenceHolds.has(key) && deps.holdPersistence) persistenceHolds.set(key, deps.holdPersistence());
  };
  const releasePersistence = (key: string) => {
    persistenceHolds.get(key)?.();
    persistenceHolds.delete(key);
  };
  const readyAt = (at: number) => entriesToSend([...entries.values()], at,
    new Set([...busy, ...[...entries.values()].filter(cancelled).map((entry) => entry.clientMessageId)]));
  const persist = (entry: OutboxEntry): Promise<void> => {
    const key = keyFor(entry);
    holdPersistence(key);
    const writing = Promise.resolve(writes.get(key)).catch(() => undefined).then(() => {
      if (cancelled(entry)) throw new Error("OUTBOX_DISCARD_PENDING");
      return deps.storage.put(entry);
    });
    writes.set(key, writing);
    const finished = (committed: boolean) => {
      if (writes.get(key) !== writing) return;
      writes.delete(key);
      if (committed && !cancelled(entry)) releasePersistence(key);
    };
    void writing.then(() => finished(true), () => finished(false));
    return writing;
  };

  const settle = (id: string, outcome: SendOutcome<Row>) => {
    const resolve = waiters.get(id);
    waiters.delete(id);
    resolve?.(outcome);
  };

  const schedule = () => {
    if (wake !== null) timers.clear(wake);
    wake = null;
    if (!restored) return;
    const due = nextDueAt(readyAt(Number.POSITIVE_INFINITY));
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
    // Cancellation requested while it was out: its late result cannot undo it.
    if (!ownsSession() || entries.get(entry.clientMessageId) !== entry || cancelled(entry)) return;

    if ("sent" in result) {
      // Retain ownership through cleanup: a concurrent discard can commit and
      // remove the bubble while this await is still pending.
      try { await deps.storage.remove(entry.clientMessageId); }
      catch (error) { if (ownsSession()) deps.onStorageError?.(error); }
      if (!ownsSession() || entries.get(entry.clientMessageId) !== entry || cancelled(entry)) return;
      entries.delete(entry.clientMessageId);
      busy.delete(entry.clientMessageId);
      requiresExplicitRetry.delete(entry.clientMessageId);
      deps.onSent(entry, result.sent);
      settle(entry.clientMessageId, { kind: "sent", row: result.sent });
      return;
    }
    busy.delete(entry.clientMessageId);
    const failure: SendFailure = classifySendFailure(result.failed);
    if (failure === "refused") {
      entries.delete(entry.clientMessageId);
      requiresExplicitRetry.delete(entry.clientMessageId);
      // A missing mention schema is retryable without dropping identities.
      // Keep it on disk, but do not loop a refused send in this session.
      try {
        if (result.failed.retainForRetry) await persist(entry);
        else await deps.storage.remove(entry.clientMessageId);
      } catch (error) { if (ownsSession()) deps.onStorageError?.(error); }
      if (!ownsSession()) return;
      deps.onRefused(entry, result.failed.error ?? null);
      settle(entry.clientMessageId, { kind: "refused", error: result.failed.error ?? null });
      return;
    }
    const attempts = entry.attempts + 1;
    const waiting: OutboxEntry = { ...entry, attempts, nextAttemptAt: now() + retryDelay(attempts) };
    entries.set(entry.clientMessageId, waiting);
    busy.add(entry.clientMessageId);
    try { await persist(waiting); }
    catch (error) {
      if (ownsSession() && entries.get(entry.clientMessageId) === waiting && !cancelled(waiting)) {
        requiresExplicitRetry.add(entry.clientMessageId);
        deps.onRefused(waiting, error);
        settle(entry.clientMessageId, { kind: "refused", error });
      }
      return;
    }
    if (!ownsSession() || entries.get(entry.clientMessageId) !== waiting || cancelled(waiting)) return;
    busy.delete(entry.clientMessageId);
    deps.onWaiting(waiting);
    settle(entry.clientMessageId, { kind: "waiting" });
  };

  let drainingEpoch: number | null = null;
  let again = false;
  const drain = async (): Promise<void> => {
    if (!userId || !restored) return;
    const epoch = accountEpoch;
    if (drainingEpoch === epoch) {
      again = true;
      return;
    }
    drainingEpoch = epoch;
    try {
      do {
        again = false;
        const ready = readyAt(now());
        await Promise.all(ready.map((entry) => attempt(entry, epoch)));
        if (epoch !== accountEpoch) return;
        // Whatever went out and landed may have released the next one of its
        // chat, which is due at once.
        if (ready.length > 0 && readyAt(now()).length > 0) again = true;
      } while (again && epoch === accountEpoch);
    } finally {
      if (epoch === accountEpoch) {
        drainingEpoch = null;
        schedule();
      }
    }
  };

  const restore = (forUserId: string, epoch: number): Promise<OutboxEntry[]> => {
    const pending = (async () => {
      // Publish the barrier/promise before even a synchronous storage failure.
      const stored = await Promise.resolve().then(() => deps.storage.list(forUserId)).catch(() => null);
      if (epoch !== accountEpoch || userId !== forUserId) return [];
      restoring = null;
      if (stored === null) {
        // Unknown older entries must not be overtaken. A later explicit start
        // may retry; unknown persistence must not become an empty memory list.
        for (const entry of entries.values()) {
          if (busy.has(entry.clientMessageId)) continue; // Its own put must decide whether it is saved.
          deps.onWaiting(entry);
          settle(entry.clientMessageId, { kind: "waiting" });
        }
      } else {
        for (const entry of stored) {
          if (entry.userId !== forUserId || discardedDuringRestore.has(entry.clientMessageId) || entries.has(entry.clientMessageId)) continue;
          entries.set(entry.clientMessageId, structuredClone({ ...entry, nextAttemptAt: now() }));
        }
        discardedDuringRestore.clear();
        restored = true;
        void drain();
      }
      return [...entries.values()].map((entry) => structuredClone(entry));
    })();
    restoring = pending;
    return pending;
  };

  return {
    /** Whose messages this runner sends; a different account's entries stay on disk. */
    start(forUserId: string): Promise<OutboxEntry[]> {
      if (userId === forUserId) {
        if (restoring) return restoring;
        if (restored) return Promise.resolve([...entries.values()].map((entry) => structuredClone(entry)));
        return restore(forUserId, accountEpoch);
      }
      const epoch = ++accountEpoch;
      userId = forUserId;
      restored = false;
      restoring = null;
      discardedDuringRestore.clear();
      entries.clear();
      busy.clear();
      requiresExplicitRetry.clear();
      if (wake !== null) timers.clear(wake);
      wake = null;
      for (const id of [...waiters.keys()]) settle(id, { kind: "waiting" });
      return restore(forUserId, epoch);
    },

    stop() {
      accountEpoch += 1;
      userId = null;
      restored = false;
      restoring = null;
      discardedDuringRestore.clear();
      entries.clear();
      busy.clear();
      requiresExplicitRetry.clear();
      if (wake !== null) timers.clear(wake);
      wake = null;
      for (const id of [...waiters.keys()]) settle(id, { kind: "waiting" });
    },

    /** Persist a refused prefix without scheduling or replacing a send waiter. */
    async retain(entry: OutboxEntry): Promise<RetainOutcome> {
      const epoch = accountEpoch;
      const retained = structuredClone(entry);
      const own = () => epoch === accountEpoch && userId === retained.userId;
      if (cancellations.has(keyFor(retained))) return { ok: false, error: new Error("OUTBOX_DISCARD_PENDING") };
      if (!own()) return { ok: false, error: new Error("OUTBOX_SCOPE_CHANGED") };
      try { await persist(retained); }
      catch (error) {
        if (own() && !cancelled(retained)) deps.onStorageError?.(error);
        return { ok: false, error };
      }
      if (cancelled(retained)) return { ok: false, error: new Error("OUTBOX_DISCARD_PENDING") };
      if (!own()) return { ok: false, error: new Error("OUTBOX_SCOPE_CHANGED") };
      return { ok: true };
    },

    /** Keeps a message on the device, then sends it; answers with that first attempt. */
    async enqueue(entry: OutboxEntry): Promise<SendOutcome<Row>> {
      const epoch = accountEpoch;
      const queued: OutboxEntry = structuredClone({ ...entry, nextAttemptAt: now() });
      const key = keyFor(queued), cancellation = cancellations.get(key);
      if (cancellation === "pending" || (cancellation === "committed" && userId !== queued.userId)) {
        return { kind: "refused", error: new Error("OUTBOX_DISCARD_PENDING") };
      }
      if (cancellation === "committed") cancellations.set(key, "requeued");
      if (userId !== queued.userId) {
        try { await persist(queued); return { kind: "waiting" }; }
        catch (error) { return { kind: "refused", error }; }
      }
      entries.set(queued.clientMessageId, queued);
      requiresExplicitRetry.delete(queued.clientMessageId);
      // A concurrently finishing attempt cannot send this before persistence.
      busy.add(queued.clientMessageId);
      const outcome = new Promise<SendOutcome<Row>>((resolve) => waiters.set(queued.clientMessageId, resolve));
      try { await persist(queued); }
      catch (error) {
        if (epoch === accountEpoch && entries.get(queued.clientMessageId) === queued && !cancelled(queued)) {
          requiresExplicitRetry.add(queued.clientMessageId);
          deps.onRefused(queued, error);
          settle(queued.clientMessageId, { kind: "refused", error });
        }
        return outcome;
      }
      if (epoch === accountEpoch && entries.get(queued.clientMessageId) === queued) {
        if (cancelled(queued)) { settle(queued.clientMessageId, { kind: "waiting" }); return outcome; }
        busy.delete(queued.clientMessageId);
        if (!restored && !restoring) {
          deps.onWaiting(queued);
          settle(queued.clientMessageId, { kind: "waiting" });
        } else {
          void drain();
        }
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

    /** Local cancellation is immediate; removal is confirmed only after commit. */
    async discard(clientMessageId: string, forUserId = userId): Promise<{ ok: boolean }> {
      const epoch = accountEpoch;
      if (!forUserId || forUserId !== userId) return { ok: false };
      const held = entries.get(clientMessageId);
      if (held && held.userId !== forUserId) return { ok: false };
      const key = keyFor({ userId: forUserId, clientMessageId });
      const pending = discarding.get(key);
      if (pending) return pending;
      cancellations.set(key, "pending");
      holdPersistence(key);
      const own = () => epoch === accountEpoch && forUserId === userId;
      const operation = (async () => {
        try {
          await writes.get(key)?.catch(() => undefined);
          if (!own()) return { ok: false };
          await deps.storage.remove(clientMessageId);
          cancellations.set(key, "committed");
          // Commit removes the reload risk even if its UI owner has retired.
          releasePersistence(key);
          if (!own()) return { ok: false };
          // An in-progress list may already hold the pre-delete disk snapshot.
          if (!restored) discardedDuringRestore.add(clientMessageId);
          entries.delete(clientMessageId);
          busy.delete(clientMessageId);
          requiresExplicitRetry.delete(clientMessageId);
          settle(clientMessageId, { kind: "waiting" });
          void drain();
          return { ok: true };
        } catch {
          if (own()) settle(clientMessageId, { kind: "waiting" });
          return { ok: false };
        } finally { discarding.delete(key); }
      })();
      discarding.set(key, operation);
      return operation;
    },

    has(clientMessageId: string) {
      return entries.has(clientMessageId);
    },

    /** Live queued work, rather than failed work retained for an explicit retry. */
    isQueued(clientMessageId: string) {
      return entries.has(clientMessageId) && !requiresExplicitRetry.has(clientMessageId);
    },

    size() {
      return entries.size;
    },
  };
}

export type OutboxRunner<Row> = ReturnType<typeof createOutboxRunner<Row>>;
