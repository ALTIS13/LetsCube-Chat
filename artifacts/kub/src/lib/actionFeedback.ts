import { MOTION_MS, feedbackDuration, prefersReducedMotion } from "./motion.ts";

export type ActionFeedbackKind = "success" | "info" | "warning" | "error";

export interface ActionFeedbackInput {
  kind: ActionFeedbackKind;
  /** One short line: what happened. */
  title: string;
  /** Optional second line. Bounded, because it may carry a message from elsewhere. */
  detail?: string;
  /**
   * Groups repeats of the same action. A second copy replaces the first rather
   * than stacking beside it: pressing a button twice is one result, not two.
   */
  key?: string;
}

export interface ActionFeedbackItem extends ActionFeedbackInput {
  id: string;
  /** When it was shown, by the clock the store was given. */
  shownAt: number;
  /** When it stops being worth showing. */
  expiresAt: number;
}

/**
 * How long an error stays. Deliberately longer than a success and unaffected by
 * reduced motion: a failure has to be readable, and reduced motion is a
 * statement about movement, not about reading speed.
 */
const ERROR_MS = 5000;

/** At most three at once. A fourth would start covering what it is confirming. */
const MAX_VISIBLE = 3;

/** A detail may come from a caught error, so it is cut rather than trusted. */
const MAX_DETAIL = 160;

export interface ActionFeedbackStore {
  show: (input: ActionFeedbackInput) => string;
  dismiss: (id: string) => void;
  /** Drops whatever has outlived its duration, by the store's own clock. */
  prune: () => void;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => readonly ActionFeedbackItem[];
}

/**
 * The action-feedback queue.
 *
 * Built as an external store rather than React state because the callers are
 * not components: a copy helper, a save handler, a catch block. Passing a clock
 * in makes every duration testable without waiting for real time to pass.
 */
export function createActionFeedbackStore(
  now: () => number,
  options: { reducedMotion?: boolean } = {},
): ActionFeedbackStore {
  let items: readonly ActionFeedbackItem[] = Object.freeze([]);
  const listeners = new Set<() => void>();
  let sequence = 0;

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const commit = (next: ActionFeedbackItem[]) => {
    // Frozen, so a render cannot mutate the queue it is drawing; and a new
    // object only when something actually changed, because
    // `useSyncExternalStore` re-renders on identity.
    items = Object.freeze(next);
    emit();
  };

  const durationFor = (kind: ActionFeedbackKind) =>
    kind === "error" ? ERROR_MS : feedbackDuration(kind, options.reducedMotion ?? false);

  return {
    show(input) {
      const at = now();
      const id = `feedback-${++sequence}`;
      const item: ActionFeedbackItem = {
        ...input,
        detail: input.detail?.slice(0, MAX_DETAIL),
        id,
        shownAt: at,
        expiresAt: at + durationFor(input.kind),
      };

      const withoutKeyed = input.key
        ? items.filter((existing) => existing.key !== input.key)
        : [...items];
      const next = [...withoutKeyed, item];
      commit(next.slice(Math.max(0, next.length - MAX_VISIBLE)));
      return id;
    },

    dismiss(id) {
      if (!items.some((item) => item.id === id)) return;
      commit(items.filter((item) => item.id !== id));
    },

    prune() {
      const at = now();
      const next = items.filter((item) => item.expiresAt > at);
      if (next.length === items.length) return;
      commit(next);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot() {
      return items;
    },
  };
}

/**
 * The one store the application uses.
 *
 * Its clock is the real one and it reads the reduced-motion preference at
 * construction; components that need to react to a change in that preference
 * read it themselves rather than expecting the store to be rebuilt.
 */
export const actionFeedback = createActionFeedbackStore(() => Date.now(), {
  reducedMotion: prefersReducedMotion(),
});

/** Shows one confirmation. Safe to call from anywhere, including a catch block. */
export function showActionFeedback(input: ActionFeedbackInput): string {
  return actionFeedback.show(input);
}

/**
 * Copies text and says whether it worked.
 *
 * Five call sites copied to the clipboard and said nothing, which leaves a
 * person pressing the button again to find out whether the first press did
 * anything. The failure branch matters as much: a clipboard write can be
 * refused outright, and silence then reads as success.
 */
export async function copyWithFeedback(
  text: string,
  options: { success: string; error: string; key: string },
): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    showActionFeedback({ kind: "success", title: options.success, key: options.key });
    return true;
  } catch {
    showActionFeedback({ kind: "error", title: options.error, key: `${options.key}:error` });
    return false;
  }
}

export { MOTION_MS };
