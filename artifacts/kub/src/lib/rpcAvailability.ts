/**
 * Whether a database function this client calls is on the server yet.
 *
 * The client and the database go out separately and in either order — the
 * message-action functions of 20260911141000–20260911144000 especially. A call
 * to a function the server does not have fails with PostgREST's `PGRST202`, or
 * with Postgres's `42883` once it reaches the database. The caller then does
 * what it did before the function existed, and this says so once.
 *
 * A missing function is remembered, so an action does not cost a failed request
 * every time — for five minutes, after which one call finds out whether the
 * deploy has landed.
 *
 * Kept free of React and Supabase so `node --test` can load it.
 */

export const RPC_RECHECK_AFTER_MS = 5 * 60_000;

/** The server has no such function: PostgREST's `PGRST202`, or Postgres's `42883`. */
export function isMissingRpcError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown };
  const code = typeof record.code === "string" ? record.code.toUpperCase() : "";
  if (code === "PGRST202" || code === "42883") return true;
  const message = typeof record.message === "string" ? record.message.toLowerCase() : "";
  return message.includes("could not find the function");
}

export interface RpcAvailability {
  /** False while the function is known to be missing and the recheck is not due. */
  shouldTry(name: string): boolean;
  /** The server answered that it has no such function. */
  markMissing(name: string): void;
  /** The server answered a call to it. */
  markPresent(name: string): void;
}

export function createRpcAvailability(options: {
  now?: () => number;
  recheckAfterMs?: number;
  /** Called once when a function is first found missing, not on every recheck. */
  onMissing?: (name: string) => void;
} = {}): RpcAvailability {
  const now = options.now ?? (() => Date.now());
  const recheckAfterMs = options.recheckAfterMs ?? RPC_RECHECK_AFTER_MS;
  const missingSince = new Map<string, number>();
  return {
    shouldTry(name) {
      const since = missingSince.get(name);
      return since === undefined || now() - since >= recheckAfterMs;
    },
    markMissing(name) {
      const alreadyKnown = missingSince.has(name);
      missingSince.set(name, now());
      if (!alreadyKnown) options.onMissing?.(name);
    },
    markPresent(name) {
      missingSince.delete(name);
    },
  };
}

/** The application's one record. */
export const rpcAvailability = createRpcAvailability({
  onMissing: (name) => {
    console.warn(`[rpc] ${name} is not on this server yet; using the previous behaviour.`);
  },
});
