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

function isPostgrest(input: RequestInfo | URL): boolean {
  try {
    return new URL(urlOf(input), "http://localhost").pathname.startsWith("/rest/v1/");
  } catch {
    return false;
  }
}

function withResponseMetadata(response: Response, original: Response, errorFor: (error: unknown) => unknown): Response {
  Object.defineProperties(response, {
    url: { value: original.url },
    type: { value: original.type },
    redirected: { value: original.redirected },
    clone: { value: function (this: Response) {
      return withResponseMetadata(Response.prototype.clone.call(this), this, errorFor);
    } },
  });
  // Chromium's Body loader can turn even caller-owned stream errors into a
  // generic TypeError. Restore the request's cause at the SDK consumption edge.
  for (const method of ["arrayBuffer", "blob", "bytes", "formData", "json", "text"]) {
    const consume = Reflect.get(Response.prototype, method) as ((this: Response) => Promise<unknown>) | undefined;
    if (typeof consume !== "function") continue;
    Object.defineProperty(response, method, { value: function (this: Response) {
      return consume.call(this).catch((error: unknown) => { throw errorFor(error); });
    } });
  }
  return response;
}

// Stream through the SDK's existing parser without buffering or changing its
// Response API. The request owns cancellation until EOF, error or explicit cancel.
function trackResponseBody(
  response: Response,
  signal: AbortSignal,
  errorFor: (error: unknown) => unknown,
  settle: () => void,
): Response {
  const reader = response.body!.getReader();
  let finished = false;
  let output: ReadableStreamDefaultController<Uint8Array>;
  const finish = () => {
    signal.removeEventListener("abort", abort);
    settle();
  };
  const abort = () => {
    if (finished) return;
    finished = true;
    const reason = errorFor(signal.reason);
    output.error(reason);
    finish();
    void reader.cancel(reason).catch(() => undefined).finally(() => reader.releaseLock());
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      output = controller;
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    },
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (finished) return;
        if (chunk.done) {
          finished = true;
          finish();
          controller.close();
        } else {
          controller.enqueue(chunk.value);
        }
      } catch (error) {
        if (!finished) {
          finished = true;
          finish();
          controller.error(errorFor(error));
        }
      } finally {
        if (finished) reader.releaseLock();
      }
    },
    cancel(reason) {
      if (finished) return;
      finished = true;
      finish();
      return reader.cancel(reason).finally(() => reader.releaseLock());
    },
  }, { highWaterMark: 0 });
  return withResponseMetadata(new Response(body, {
    status: response.status, statusText: response.statusText, headers: response.headers,
  }), response, errorFor);
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

    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      if (timer !== null) timers.clear(timer);
      outer?.removeEventListener("abort", forwardAbort);
      waiting.delete(entry);
    };

    return base(input, { ...init, signal: controller.signal }).then(
      (response) => {
        // Auth has its own error-body classification; Storage may stream for
        // minutes. Only finite PostgREST responses take this completion boundary.
        if (isPostgrest(input) && response.body && response.status !== 0) {
          try {
            return trackResponseBody(response, controller.signal,
              error => cutReason ? cutError(cutReason) : controller.signal.aborted ? controller.signal.reason : error,
              settle);
          } catch (error) {
            settle();
            throw error;
          }
        }
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
