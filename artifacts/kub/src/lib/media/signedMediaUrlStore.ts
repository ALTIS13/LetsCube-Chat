/**
 * One shared answer to "what is the address of this stored object right now".
 *
 * D-208, step two. Signing is per-request work with an expiry attached, so it
 * needs the two things a public URL never did: somewhere to *keep* an answer,
 * and something to replace it before it dies.
 *
 * ## Why a store and not component state
 *
 * The same object reaches the screen three times over — the bubble's picture,
 * the info panel's grid tile, and the full-screen viewer all address one file.
 * A signature held in component state would be three signatures for one object,
 * and since a re-sign a second later is a different string (see
 * `signedUrlLifetime`), three different cache keys and three downloads of the
 * same bytes. Keyed by the object, they are one.
 *
 * It also makes the request cost survivable. `createSignedUrls` signs many
 * paths of one bucket in a single POST — measured working against production on
 * 2026-09-19, with a per-path error slot — so a screenful of pictures is one
 * request, exactly as `avatarVariantStore` makes a screenful of avatars one
 * query. This store follows that one deliberately: same `request` / `get` /
 * `isSettled` / `subscribe` shape, same injected scheduler, same rule that a
 * failure is forgotten rather than cached.
 *
 * ## What renews a signature
 *
 * Reading does. There is no timer, because a timer over a cache would re-sign
 * every object a long-lived tab had ever seen, forever. `get` is called on
 * render; if the answer it is about to give has passed its renewal point it
 * queues a replacement and returns the current one anyway — which is still
 * valid, so the picture does not blink while the new address arrives. An object
 * that has scrolled out of the tree stops being read, so it stops being
 * renewed, and is signed afresh when it comes back.
 *
 * ## What a failure does
 *
 * A signature can fail for two quite different reasons and the wire says the
 * same thing about both: the object is not there, or this account may not read
 * it. Either way the answer is "no URL", and either way retrying on the next
 * render would spin. So a failure is remembered with a cooldown — long enough
 * not to spin, short enough that a membership that has just been granted heals
 * without a reload.
 */

import {
  isSignedUrlUsable,
  shouldRenewSignedUrl,
  signedUrlLifetime,
  SIGNED_URL_TTL_SECONDS,
  type SignedUrlLifetime,
} from "./signedUrlLifetime.ts";
import { mediaObjectRefKey, type MediaObjectRef } from "./mediaObjectRef.ts";

/** How long a refused or missing object is left alone before being asked again. */
export const SIGN_FAILURE_COOLDOWN_MS = 30_000;

/** Paths per POST. The service takes a JSON array; this keeps the body sane. */
export const SIGN_BATCH_SIZE = 100;

/** Objects remembered at once. Past this the least recently read is dropped. */
export const SIGN_CACHE_LIMIT = 512;

export interface SignedPathResult {
  path: string;
  signedUrl: string | null;
  error?: string | null;
}

/** Signs many paths of one bucket at once. Injected, so tests need no network. */
export type MediaUrlSigner = (
  bucket: string,
  paths: string[],
  expiresInSeconds: number,
) => Promise<SignedPathResult[]>;

export interface SignedMediaUrlStoreOptions {
  sign: MediaUrlSigner;
  /** Defaults to `Date.now`. */
  now?: () => number;
  /** Defaults to a microtask, so one render's objects coalesce into one POST. */
  schedule?: (run: () => void) => void;
  ttlSeconds?: number;
  batchSize?: number;
  cacheLimit?: number;
  failureCooldownMs?: number;
}

interface CacheEntry {
  url: string | null;
  lifetime: SignedUrlLifetime | null;
  /** When a failed entry may be asked about again. */
  retryAtMs: number;
  /** Last read, for eviction. */
  touchedAtMs: number;
}

export function createSignedMediaUrlStore(options: SignedMediaUrlStoreOptions) {
  const sign = options.sign;
  const now = options.now ?? (() => Date.now());
  const schedule = options.schedule ?? ((run: () => void) => void Promise.resolve().then(run));
  const ttlSeconds = Math.max(1, options.ttlSeconds ?? SIGNED_URL_TTL_SECONDS);
  const batchSize = Math.max(1, options.batchSize ?? SIGN_BATCH_SIZE);
  const cacheLimit = Math.max(1, options.cacheLimit ?? SIGN_CACHE_LIMIT);
  const failureCooldownMs = Math.max(0, options.failureCooldownMs ?? SIGN_FAILURE_COOLDOWN_MS);

  const known = new Map<string, CacheEntry>();
  const pending = new Map<string, MediaObjectRef>();
  const inFlight = new Set<string>();
  const listeners = new Set<() => void>();
  let flushScheduled = false;

  function emit(): void {
    for (const listener of [...listeners]) listener();
  }

  function evictIfNeeded(): void {
    if (known.size <= cacheLimit) return;
    const byAge = [...known.entries()].sort((a, b) => a[1].touchedAtMs - b[1].touchedAtMs);
    const drop = known.size - cacheLimit;
    for (let i = 0; i < drop; i += 1) known.delete(byAge[i][0]);
  }

  /** Whether this object needs work done about it, at this moment. */
  function needsWork(key: string, nowMs: number): boolean {
    if (inFlight.has(key) || pending.has(key)) return false;
    const entry = known.get(key);
    if (!entry) return true;
    if (!entry.lifetime) return nowMs >= entry.retryAtMs;
    return shouldRenewSignedUrl(entry.lifetime, nowMs);
  }

  function enqueue(ref: MediaObjectRef): void {
    const key = mediaObjectRefKey(ref);
    if (!needsWork(key, now())) return;
    pending.set(key, ref);
    scheduleFlush();
  }

  function scheduleFlush(): void {
    if (flushScheduled) return;
    flushScheduled = true;
    schedule(() => void flush());
  }

  /** One bucket's worth of the queue, so a POST is never mixed across buckets. */
  function takeBatch(): { bucket: string; keys: string[]; paths: string[] } | null {
    const first = pending.entries().next();
    if (first.done) return null;
    const bucket = first.value[1].bucket;
    const keys: string[] = [];
    const paths: string[] = [];
    for (const [key, ref] of pending) {
      if (ref.bucket !== bucket) continue;
      keys.push(key);
      paths.push(ref.path);
      if (keys.length >= batchSize) break;
    }
    for (const key of keys) {
      pending.delete(key);
      inFlight.add(key);
    }
    return { bucket, keys, paths };
  }

  async function flush(): Promise<void> {
    flushScheduled = false;
    const batch = takeBatch();
    if (!batch) return;

    let changed = false;
    try {
      const results = await sign(batch.bucket, batch.paths, ttlSeconds);
      const issuedAtMs = now();
      const byPath = new Map<string, SignedPathResult>();
      for (const result of results) byPath.set(result.path, result);

      for (let i = 0; i < batch.keys.length; i += 1) {
        const key = batch.keys[i];
        const result = byPath.get(batch.paths[i]);
        const url = result && !result.error ? result.signedUrl : null;
        if (url) {
          known.set(key, {
            url,
            lifetime: signedUrlLifetime(issuedAtMs, ttlSeconds),
            retryAtMs: 0,
            touchedAtMs: issuedAtMs,
          });
        } else {
          // Refused, or not there. The wire does not distinguish the two, so
          // neither does this: no URL, and left alone for the cooldown.
          known.set(key, {
            url: null,
            lifetime: null,
            retryAtMs: issuedAtMs + failureCooldownMs,
            touchedAtMs: issuedAtMs,
          });
        }
        changed = true;
      }
      evictIfNeeded();
    } catch {
      // The whole POST failed — offline, or the service is down. That is not an
      // answer about any of these objects, so nothing is written: a previously
      // good URL keeps being served until it actually expires, and an object
      // with no answer yet is asked about again on the next read. Caching
      // "none" for a dropped connection would blank a conversation for the rest
      // of the session.
    } finally {
      for (const key of batch.keys) inFlight.delete(key);
    }

    if (changed) emit();
    if (pending.size > 0) scheduleFlush();
  }

  return {
    /** Ask about an object. Cheap and idempotent; safe to call every render. */
    request(ref: MediaObjectRef | null | undefined): void {
      if (!ref) return;
      enqueue(ref);
    },

    /**
     * The address to use now, or `null`.
     *
     * `null` means one of three things — not asked yet, asked and refused, or
     * the last signature is too near its end to start a download with. All
     * three say the same thing to a consumer: do not put this in a `src` yet.
     * Reading is what queues the work, so a `null` here is always followed by
     * an attempt.
     */
    get(ref: MediaObjectRef | null | undefined): string | null {
      if (!ref) return null;
      const key = mediaObjectRefKey(ref);
      const nowMs = now();
      const entry = known.get(key);
      if (entry) entry.touchedAtMs = nowMs;
      enqueue(ref);
      if (!entry || !entry.url || !entry.lifetime) return null;
      // Past the renewal point but not yet spent: still handed out, because it
      // still works and the replacement is already queued above.
      return isSignedUrlUsable(entry.lifetime, nowMs) ? entry.url : null;
    },

    /**
     * Whether the store has an answer — including "there is none".
     *
     * A consumer waits on this before drawing a placeholder as though the
     * object were missing, exactly as an avatar waits before falling back to
     * the full-size original.
     */
    isSettled(ref: MediaObjectRef | null | undefined): boolean {
      if (!ref) return true;
      const key = mediaObjectRefKey(ref);
      if (inFlight.has(key) || pending.has(key)) return false;
      return known.has(key);
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** Test seam, and what a sign-out calls: no signature outlives a session. */
    reset(): void {
      known.clear();
      pending.clear();
      inFlight.clear();
      flushScheduled = false;
      emit();
    },

    /** Test seam. */
    __debug() {
      return { known: known.size, pending: pending.size, inFlight: inFlight.size };
    },
  };
}

export type SignedMediaUrlStore = ReturnType<typeof createSignedMediaUrlStore>;
