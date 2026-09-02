import { feedbackDuration } from "./motion.ts";

export type AsyncPhase = "idle" | "loading" | "success" | "error";

/**
 * The timer functions, injected so the machine can be driven without waiting.
 * A leaked timer is then a fact a test can assert rather than an intermittent
 * failure somebody notices months later.
 */
export interface AsyncActionTimers {
  set: (fn: () => void, ms: number) => number;
  clear: (id: number) => void;
}

export interface AsyncAction {
  phase: () => AsyncPhase;
  /** Runs the task once. Returns whether it succeeded; refuses to overlap. */
  run: (task: () => Promise<unknown>) => Promise<boolean>;
  subscribe: (listener: () => void) => () => void;
  /** Clears anything pending. Call on unmount. */
  dispose: () => void;
}

/**
 * The state a control passes through while it is doing something.
 *
 * Written ad hoc at each call site this goes wrong two ways, both present in
 * the product: the control changes size between "Сохранить" and "Сохранение…",
 * so the row moves under the pointer; and the success timer keeps running when
 * a second action starts, so the button flickers back to a stale tick.
 *
 * An error does not clear itself. A success is a confirmation and can fade; a
 * failure is the state a person has to act on, so it stays until they try
 * again.
 */
export function createAsyncAction(
  timers: AsyncActionTimers,
  options: { reducedMotion?: boolean } = {},
): AsyncAction {
  let phase: AsyncPhase = "idle";
  let timer: number | null = null;
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const clearTimer = () => {
    if (timer === null) return;
    timers.clear(timer);
    timer = null;
  };

  const set = (next: AsyncPhase) => {
    if (phase === next) return;
    phase = next;
    emit();
  };

  return {
    phase: () => phase,

    async run(task) {
      // Double-clicking a save button must not send two saves.
      if (phase === "loading") return false;
      clearTimer();
      set("loading");
      try {
        await task();
      } catch {
        set("error");
        return false;
      }
      set("success");
      timer = timers.set(() => {
        timer = null;
        set("idle");
      }, feedbackDuration("success", options.reducedMotion ?? false));
      return true;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose() {
      clearTimer();
      listeners.clear();
    },
  };
}

/** The real timers, for everything that is not a test. */
export const browserTimers: AsyncActionTimers = {
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (id) => window.clearTimeout(id),
};
