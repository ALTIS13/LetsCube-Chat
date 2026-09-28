/**
 * Which of the application's requests may wait how long, and which a change of
 * network may cut short (tracker item 53).
 *
 * The report, 2026-09-28, from an Android owner: switching a VPN off to open
 * another app left the messenger dead until it was restarted. Read in the code
 * the same day: no request had a deadline. A request sent over the old route
 * can wait on a socket nobody will ever answer for as long as the operating
 * system keeps retransmitting — minutes — and the chat list lets only one read
 * run at a time, so every later refresh queued behind the dead one. Restarting
 * the application was the only thing that ended it.
 *
 * So every request that is not a file transfer gets a deadline, and a read
 * that has been waiting since before the network changed is cut the moment the
 * change is noticed rather than when the deadline falls. A cut request fails
 * exactly as a dropped connection does — see `cutError` — so every caller
 * already knows what to do with it.
 *
 * Pure, so `node --test` reads every case; `deadlineFetch.ts` applies it.
 */

export type RequestKind =
  /** GET and HEAD: asking again costs nothing, so a change may cut one. */
  | "read"
  /** Anything that may change something: bounded, never cut mid-flight. */
  | "write"
  /** Storage: a big file on a slow line legitimately takes minutes. */
  | "transfer";

/**
 * How long a request may wait for its answer.
 *
 * Thirty seconds is past anything the application waits for on a working
 * line — the slowest read measured on production is the cold chat list at
 * 505–564 ms (tracker, queue item 2) — and short enough that a dead one ends
 * while the person is still looking at the screen.
 */
export const REQUEST_DEADLINE_MS = 30_000;

/**
 * How long a read must have been waiting before a network change counts as
 * having stranded it. One sent after the change is on the new route and is left
 * alone; the change is noticed a moment after it happens, so a read younger
 * than this may already be the new route's.
 */
export const STRANDED_AFTER_MS = 3_000;

function pathOf(url: string): string {
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return url;
  }
}

export function requestKind(url: string, method: string | undefined): RequestKind {
  if (pathOf(url).includes("/storage/v1/")) return "transfer";
  const verb = (method ?? "GET").toUpperCase();
  return verb === "GET" || verb === "HEAD" ? "read" : "write";
}

/** The deadline for a kind of request, or null for none. */
export function deadlineFor(kind: RequestKind): number | null {
  return kind === "transfer" ? null : REQUEST_DEADLINE_MS;
}

/** Whether a network change has stranded this request. */
export function strandedByNetworkChange(kind: RequestKind, startedAt: number, now: number): boolean {
  return kind === "read" && now - startedAt >= STRANDED_AFTER_MS;
}

export type CutReason = "deadline" | "network-change";

/**
 * The failure a cut request rejects with: the one a dropped connection gives.
 *
 * Deliberately a `TypeError` reading «Failed to fetch», because that is what
 * every layer above already recognises as the network's and nothing else:
 * PostgREST's client reports it as `TypeError: Failed to fetch`, which
 * `mapPgError` turns into «Сетевой сбой…»; the upload rule treats a
 * `TypeError` as unanswered; and the auth client wraps any rejection of its
 * fetch as retryable. That last one is the reason this is not an `AbortError`:
 * a refresh that failed with an error the auth client did not recognise as
 * retryable would drop the session and sign the person out.
 */
export function cutError(reason: CutReason): TypeError {
  return Object.assign(new TypeError("Failed to fetch"), { kubCut: reason });
}
