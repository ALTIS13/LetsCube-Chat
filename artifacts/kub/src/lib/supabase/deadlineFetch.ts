/**
 * The fetch the Supabase client is given: the platform's, with the rules of
 * `requestDeadline.ts` applied (tracker item 53).
 *
 * Every request is registered while it waits, so a change of network can cut
 * the reads it stranded (`cutStrandedReads`). A caller's own signal still
 * cancels as it always did, and is reported as the caller's abort, not as a
 * network failure — only a cut this module made is rewritten into one.
 *
 * Imports nothing that `node --test` cannot load: the base fetch and the clock
 * are parameters, so the tests drive both.
 */

import {
  cutError,
  deadlineFor,
  requestKind,
  strandedByNetworkChange,
  type CutReason,
  type RequestKind,
} from "./requestDeadline.ts";

type Waiting = {
  kind: RequestKind;
  startedAt: number;
  cut: (reason: CutReason) => void;
};

export type DeadlineFetch = typeof fetch & {
  /** Cuts every read waiting since before a network change; returns how many. */
  cutStrandedReads: () => number;
  /** How many requests are waiting now — for tests and diagnostics. */
  waiting: () => number;
};

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function methodOf(input: RequestInfo | URL, init: RequestInit | undefined): string | undefined {
  if (init?.method) return init.method;
  if (typeof input === "object" && !(input instanceof URL)) return input.method;
  return undefined;
}

export function createDeadlineFetch(
  base: typeof fetch,
  now: () => number = () => Date.now(),
  timers: {
    set: (callback: () => void, ms: number) => unknown;
    clear: (handle: unknown) => void;
  } = {
    set: (callback, ms) => setTimeout(callback, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
): DeadlineFetch {
  const waiting = new Set<Waiting>();

  const deadlineFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const kind = requestKind(urlOf(input), methodOf(input, init));
    const controller = new AbortController();
    let cutReason: CutReason | null = null;

    // The caller's own cancellation, wherever it was handed over.
    const outer =
      init?.signal ?? (typeof Request !== "undefined" && input instanceof Request ? input.signal : null);
    const forwardAbort = () => controller.abort(outer?.reason);
    if (outer) {
      if (outer.aborted) forwardAbort();
      else outer.addEventListener("abort", forwardAbort, { once: true });
    }

    const entry: Waiting = {
      kind,
      startedAt: now(),
      cut: (reason) => {
        if (controller.signal.aborted) return;
        cutReason = reason;
        controller.abort(cutError(reason));
      },
    };
    waiting.add(entry);

    const limit = deadlineFor(kind);
    const timer = limit === null ? null : timers.set(() => entry.cut("deadline"), limit);

    const settle = () => {
      if (timer !== null) timers.clear(timer);
      outer?.removeEventListener("abort", forwardAbort);
      waiting.delete(entry);
    };

    return base(input, { ...init, signal: controller.signal }).then(
      (response) => {
        settle();
        return response;
      },
      (error: unknown) => {
        settle();
        // An engine that rejects an aborted fetch with a generic AbortError
        // rather than with the reason it was given still reports a cut as the
        // network's failure.
        if (cutReason) throw cutError(cutReason);
        throw error;
      },
    );
  }) as DeadlineFetch;

  deadlineFetch.cutStrandedReads = () => {
    const at = now();
    let cut = 0;
    for (const entry of [...waiting]) {
      if (!strandedByNetworkChange(entry.kind, entry.startedAt, at)) continue;
      entry.cut("network-change");
      cut += 1;
    }
    return cut;
  };
  deadlineFetch.waiting = () => waiting.size;

  return deadlineFetch;
}
