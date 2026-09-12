/**
 * Hints: the casual, non-blocking kind.
 *
 * The owner asked for these on 2026-09-12, describing Telegram's: a small plate
 * that sits beside a control and says what it can do, closed by hand or left to
 * fade, and once read it never comes back. What it must never be is a tour that
 * takes the screen hostage.
 *
 * This module is only the decision — whether a hint should be on screen now. It
 * holds no markup, no timers and no DOM, so the whole of it can be tested
 * without a browser, which is how `actionFeedback` is built and tested next
 * door. The clock and the storage are handed in for the same reason.
 *
 * Two promises are made here, and both are narrower than they sound. Say them
 * plainly rather than let them be assumed:
 *
 *  - **«Never again once read» is a promise about this device.** Dismissal is
 *    kept in the browser's own storage, so a person who signs in elsewhere, or
 *    clears their data, will meet the hint once more. Keeping it per account
 *    would mean a column in the database, which is a change with its own
 *    approval and its own migration; it is not smuggled in here.
 *  - **«A couple of hours of real use» is accumulated time while the hint was
 *    actually being offered**, not wall-clock time since it first appeared. A
 *    budget that ran on the wall clock would expire overnight while nobody was
 *    looking, which is the opposite of what a budget is for.
 */

/** Where the decisions are kept, named the way the desktop pill names its key. */
export const HINTS_STORAGE_KEY = "letscube:hints";

/**
 * How long a hint may go on being offered, counted only while it is offered.
 * Two hours of use, which is the owner's «пара часов реального использования».
 * Deliberately not in `MOTION_MS`: that contract is five names for transitions
 * and a test pins the object whole, so a sixth entry there would be both wrong
 * and red.
 */
export const DEFAULT_HINT_BUDGET_MS = 2 * 60 * 60 * 1000;

/** A stored decision. Absent means the hint has never been offered here. */
export interface HintRecord {
  /** The person closed it. Nothing brings it back on this device. */
  dismissed: boolean;
  /** Accumulated milliseconds during which it was offered. */
  spentMs: number;
}

export interface HintOffer {
  /** Stable across releases: it is the key the decision is stored under. */
  id: string;
  /** Defaults to two hours of use. */
  budgetMs?: number;
}

/** The narrow slice of `Storage` this needs, so a test can pass a fake. */
export interface HintStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export interface HintStore {
  /** Offer a hint. Ignored if it was dismissed or has spent its budget. */
  offer: (offer: HintOffer) => void;
  /** Withdraw an offer without spending or dismissing it. */
  withdraw: (id: string) => void;
  /** The person closed it: never again on this device. */
  dismiss: (id: string) => void;
  /** Whether this hint should be on screen right now. */
  isVisible: (id: string) => boolean;
  /**
   * Charge elapsed in-app time against every hint currently offered. The caller
   * decides what counts as in-app: this module will not guess at visibility,
   * focus or idleness on the caller's behalf.
   */
  spend: (elapsedMs: number) => void;
  /** What is on screen now, in the order it was offered. */
  getSnapshot: () => readonly string[];
  subscribe: (listener: () => void) => () => void;
  /** What is written down, for a test or a diagnostic. */
  getRecord: (id: string) => HintRecord | null;
}

interface Options {
  /** Present for symmetry with the other stores and for future budgets by date. */
  now?: () => number;
  /**
   * Where decisions are kept. `null` means memory only — which is also what a
   * throwing storage degrades to, because a browser in private mode throws on
   * `setItem` and a hint is not worth an unhandled error.
   */
  storage?: HintStorage | null;
}

function readAll(storage: HintStorage | null): Record<string, HintRecord> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(HINTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, HintRecord> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const record = value as Record<string, unknown>;
      out[id] = {
        dismissed: record.dismissed === true,
        spentMs: typeof record.spentMs === "number" && record.spentMs >= 0 ? record.spentMs : 0,
      };
    }
    return out;
  } catch {
    // Unreadable or unparsable storage is the same as no storage: a hint is a
    // courtesy, and it may not take the application down with it.
    return {};
  }
}

function writeAll(storage: HintStorage | null, records: Record<string, HintRecord>): void {
  if (!storage) return;
  try {
    storage.setItem(HINTS_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Private mode, a full quota, a browser set to refuse site data. The
    // decision stays in memory for this session and is simply not remembered.
  }
}

export function createHintStore({ now = () => Date.now(), storage = null }: Options = {}): HintStore {
  void now;
  const records = readAll(storage);
  const offered = new Map<string, number>();
  const listeners = new Set<() => void>();
  let snapshot: readonly string[] = [];

  const spentOut = (id: string, budgetMs: number): boolean => {
    const record = records[id];
    return Boolean(record && record.spentMs >= budgetMs);
  };

  const eligible = (id: string): boolean => {
    const record = records[id];
    if (record?.dismissed) return false;
    const budgetMs = offered.get(id);
    if (budgetMs === undefined) return false;
    return !spentOut(id, budgetMs);
  };

  const rebuild = (): void => {
    const next = [...offered.keys()].filter((id) => eligible(id));
    const same =
      next.length === snapshot.length && next.every((id, index) => snapshot[index] === id);
    if (same) return;
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  };

  return {
    offer({ id, budgetMs = DEFAULT_HINT_BUDGET_MS }) {
      if (offered.get(id) === budgetMs) return;
      offered.set(id, budgetMs);
      rebuild();
    },

    withdraw(id) {
      if (!offered.delete(id)) return;
      rebuild();
    },

    dismiss(id) {
      const record = records[id] ?? { dismissed: false, spentMs: 0 };
      if (record.dismissed) return;
      records[id] = { ...record, dismissed: true };
      writeAll(storage, records);
      rebuild();
    },

    isVisible(id) {
      return eligible(id);
    },

    spend(elapsedMs) {
      if (!(elapsedMs > 0)) return;
      let changed = false;
      for (const [id, budgetMs] of offered) {
        const record = records[id] ?? { dismissed: false, spentMs: 0 };
        if (record.dismissed || record.spentMs >= budgetMs) continue;
        records[id] = { ...record, spentMs: record.spentMs + elapsedMs };
        changed = true;
      }
      if (!changed) return;
      writeAll(storage, records);
      rebuild();
    },

    getSnapshot() {
      return snapshot;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getRecord(id) {
      const record = records[id];
      return record ? { ...record } : null;
    },
  };
}
