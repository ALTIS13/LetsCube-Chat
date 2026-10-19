/**
 * One shared answer to "what is the small version of this avatar".
 *
 * The pipeline has produced `avatar_128` and `avatar_256` for a long time, and
 * `UserAvatar` has always been able to use them — through an optional prop that
 * only six of forty-two call sites remember to pass. Everywhere else a 32-pixel
 * circle downloads the original: measured on this deployment, avatar originals
 * average 734 kB against 2.7 kB for `avatar_128`.
 *
 * An optional prop was the wrong shape for that. An avatar knows its profile id
 * and the size it draws at, so it can ask for itself — and this store makes
 * asking cheap: every id requested in the same frame becomes one query, an
 * answer is remembered, and an avatar with no variant is remembered as having
 * none rather than being asked about forever.
 *
 * The fetch and the scheduler are injected so the batching, the caching and the
 * failure behaviour can be exercised without a network or a browser.
 */

export interface AvatarVariantUrls {
  avatar128Url?: string;
  avatar128Width?: number | null;
  avatar128Height?: number | null;
  avatar256Url?: string;
  avatar256Width?: number | null;
  avatar256Height?: number | null;
}

export type AvatarVariantFetcher = (
  profileIds: string[],
) => Promise<Record<string, AvatarVariantUrls>>;

export interface AvatarVariantStoreOptions {
  /** Defaults to a microtask, so one render's avatars coalesce into one query. */
  schedule?: (run: () => void) => void;
  /** Ids per query. Postgrest has a URL length limit; this keeps well under it. */
  batchSize?: number;
  /** Idle ids, in addition to the mounted working set. */
  cacheLimit?: number;
  now?: () => number;
  onEvict?: (id: string) => void;
  onRetain?: (id: string) => void;
  onRelease?: (id: string) => void;
  /** Passive, lifetime-aware projection of retained raw rows. */
  project?: (id: string) => AvatarVariantUrls | undefined;
}

export const AVATAR_VARIANT_CACHE_LIMIT = 512;
export const AVATAR_VARIANT_RETRY_MS = 30_000;

/** Nothing known for this profile. Frozen so a caller cannot poison the cache. */
const NONE: Readonly<AvatarVariantUrls> = Object.freeze({});

/**
 * Whether two answers would draw the same picture.
 *
 * Only the addresses and their declared widths — everything this shape carries.
 * Compared field by field rather than by `JSON.stringify`, which would call two
 * equal answers different for writing their keys in a different order.
 */
export function sameAvatarVariantUrls(
  a: AvatarVariantUrls | undefined,
  b: AvatarVariantUrls | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.avatar128Url === b.avatar128Url
    && a.avatar256Url === b.avatar256Url
    && (a.avatar128Width ?? null) === (b.avatar128Width ?? null)
    && (a.avatar128Height ?? null) === (b.avatar128Height ?? null)
    && (a.avatar256Width ?? null) === (b.avatar256Width ?? null)
    && (a.avatar256Height ?? null) === (b.avatar256Height ?? null);
}

export function createAvatarVariantStore(
  fetcher: AvatarVariantFetcher,
  options: AvatarVariantStoreOptions = {},
) {
  const schedule = options.schedule ?? ((run: () => void) => void Promise.resolve().then(run));
  const batchSize = Math.max(1, options.batchSize ?? 100);
  const cacheLimit = Math.max(1, options.cacheLimit ?? AVATAR_VARIANT_CACHE_LIMIT);
  const now = options.now ?? (() => Date.now());
  const retryWindow = typeof window === "undefined" ? null : window;

  const known = new Map<string, AvatarVariantUrls>();
  const pending = new Set<string>();
  const inFlight = new Set<string>();
  const listeners = new Set<() => void>();
  const retained = new Map<string, number>();
  const failed = new Map<string, number>();
  let retryTimer: number | null = null;
  let flushScheduled = false;
  let generation = 0;
  let revision = 0;

  function emit(): void {
    revision += 1;
    for (const listener of [...listeners]) listener();
  }

  function evictIfNeeded(): void {
    let idle = known.size - [...retained.keys()].filter((id) => known.has(id)).length;
    for (const id of known.keys()) {
      if (idle <= cacheLimit) break;
      if (retained.has(id)) continue;
      known.delete(id);
      options.onEvict?.(id);
      idle -= 1;
    }
    let idleFailures = failed.size - [...retained.keys()].filter((id) => failed.has(id)).length;
    for (const id of failed.keys()) {
      if (idleFailures <= cacheLimit) break;
      if (retained.has(id)) continue;
      failed.delete(id);
      idleFailures -= 1;
    }
  }

  function clearRetry(): void {
    if (retryTimer !== null) retryWindow?.clearTimeout(retryTimer);
    retryTimer = null;
  }

  function armRetry(): void {
    clearRetry();
    if (!retryWindow) return;
    let nextAt = Infinity;
    for (const [id, retryAt] of failed) {
      if (retained.has(id)) nextAt = Math.min(nextAt, retryAt);
    }
    if (nextAt === Infinity) return;
    const retryGeneration = generation;
    const timer = retryWindow.setTimeout(() => {
      if (retryGeneration !== generation || retryTimer !== timer) return;
      retryTimer = null;
      for (const [id, retryAt] of failed) {
        if (retained.has(id) && retryAt <= now()) request(id);
      }
      armRetry();
    }, Math.max(1, nextAt - now()));
    retryTimer = timer;
  }

  function request(id: string | null | undefined): void {
    if (!id || known.has(id) || inFlight.has(id) || pending.has(id)) return;
    if ((failed.get(id) ?? 0) > now()) return;
    failed.delete(id);
    pending.add(id);
    scheduleFlush();
  }

  async function flush(flushGeneration: number): Promise<void> {
    flushScheduled = false;
    const batch = [...pending].slice(0, batchSize);
    if (batch.length === 0) return;
    for (const id of batch) {
      pending.delete(id);
      inFlight.add(id);
    }

    try {
      const answer = await fetcher(batch);
      if (flushGeneration !== generation) return;
      for (const id of batch) {
        failed.delete(id);
        // An id the answer does not mention has no variant. Recording that is
        // what stops it being asked about on every subsequent render.
        known.set(id, Object.hasOwn(answer, id) ? answer[id] : NONE);
      }
      evictIfNeeded();
    } catch {
      if (flushGeneration !== generation) return;
      // Not NONE: keep any answer and throttle retry before notifying readers.
      // One timer retries mounted demand; historical ids only retain a cooldown.
      for (const id of batch) failed.set(id, now() + AVATAR_VARIANT_RETRY_MS);
      evictIfNeeded();
    } finally {
      if (flushGeneration === generation) for (const id of batch) inFlight.delete(id);
    }

    if (flushGeneration !== generation) return;
    armRetry();
    emit();
    if (pending.size > 0) scheduleFlush();
  }

  function scheduleFlush(): void {
    if (flushScheduled) return;
    flushScheduled = true;
    const scheduledGeneration = generation;
    schedule(() => {
      if (scheduledGeneration === generation) void flush(scheduledGeneration);
    });
  }

  return {
    /** Ask about a profile. Cheap and idempotent; safe to call every render. */
    request,

    retain(id: string | null | undefined): () => void {
      if (!id) return () => {};
      retained.set(id, (retained.get(id) ?? 0) + 1);
      if (retained.get(id) === 1) options.onRetain?.(id);
      request(id);
      armRetry();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const count = retained.get(id);
        if (count && count > 1) retained.set(id, count - 1);
        else {
          retained.delete(id);
          pending.delete(id);
          options.onRelease?.(id);
          evictIfNeeded();
          armRetry();
        }
      };
    },

    isRetained(id: string): boolean {
      return retained.has(id);
    },

    getRevision(): number {
      return revision;
    },

    /** What is known now. `undefined` means "not answered yet". */
    get(profileId: string | null | undefined): AvatarVariantUrls | undefined {
      if (!profileId) return undefined;
      let current = known.get(profileId);
      if (!current) return undefined;
      const projected = options.project?.(profileId);
      if (projected && !sameAvatarVariantUrls(current, projected)) current = projected;
      known.delete(profileId);
      known.set(profileId, current);
      return current;
    },

    /**
     * Whether the store has an answer — including "this profile has none".
     *
     * A caller waits on this before falling back to the original, because
     * starting the original while the answer is still coming downloads both.
     * An id nobody asked about is settled by definition: there is nothing to
     * wait for.
     */
    isSettled(profileId: string | null | undefined): boolean {
      if (!profileId) return true;
      if (known.has(profileId)) return true;
      return !pending.has(profileId) && !inFlight.has(profileId);
    },

    /**
     * Re-derive what is already known, without asking the database again.
     *
     * D-208. This store caches *addresses*, and an address has a lifetime now:
     * a signature is replaced at 80% of its life, and nothing here would ever
     * notice, so every small avatar on screen would keep a dead URL until the
     * surface holding it happened to unmount. The message-variant cache solved
     * the same problem by keeping its last rows and re-projecting them
     * (`projectMessageVariantRows`); this is that, for avatars.
     *
     * Deliberately not "clear the cache and ask again": clearing would make
     * every avatar fall back to its 734 kB original for the length of a query,
     * which is the exact cost this store exists to avoid. The old address is
     * still valid when the new one is derived — that is what the 80% is for —
     * so the picture never blinks.
     *
     * `project` returning `undefined` leaves an id alone, so an id whose rows
     * are not held any more keeps whatever it had, including the frozen "this
     * profile has no variant".
     */
    reproject(project: (id: string) => AvatarVariantUrls | undefined): void {
      let changed = false;
      for (const id of [...known.keys()]) {
        const next = project(id);
        if (!next) continue;
        const current = known.get(id);
        // The identity has to survive an unchanged re-derivation: `get` feeds
        // `useSyncExternalStore`, which compares with `Object.is` and would
        // re-render every avatar on screen for a new object holding the same
        // two strings.
        if (current && sameAvatarVariantUrls(current, next)) continue;
        known.set(id, next);
        changed = true;
      }
      if (changed) emit();
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** Retire old-account answers without dropping current mounted subscriptions. */
    reset(): void {
      generation += 1;
      clearRetry();
      failed.clear();
      for (const id of known.keys()) options.onEvict?.(id);
      known.clear();
      pending.clear();
      inFlight.clear();
      flushScheduled = false;
      for (const id of retained.keys()) request(id);
      emit();
    },

    /** Test seams. */
    __debug() {
      return { known: known.size, retained: retained.size, pending: pending.size, inFlight: inFlight.size,
        failed: failed.size, retryScheduled: retryTimer !== null };
    },
    __reset(): void {
      for (const id of retained.keys()) options.onRelease?.(id);
      retained.clear();
      listeners.clear();
      this.reset();
    },
  };
}

export type AvatarVariantStore = ReturnType<typeof createAvatarVariantStore>;

/**
 * The best source for a given rendered size.
 *
 * `xl` is 80px, so it takes the 256 variant; everything else is 48px or less
 * and takes the 128. The original is never chosen here — a caller that has no
 * variant falls back to it on its own, which is visible in the network log
 * rather than hidden behind a silent preference.
 */
export function avatarVariantSrc(
  variant: AvatarVariantUrls | undefined,
  size: "sm" | "md" | "lg" | "xl",
): string | undefined {
  if (!variant) return undefined;
  if (size === "xl" || size === "lg") return variant.avatar256Url ?? variant.avatar128Url;
  return variant.avatar128Url ?? variant.avatar256Url;
}

/** Which id each store should be asked about, for one picture on screen. */
export interface AvatarVariantSubject {
  profileId: string | null;
  chatId: string | null;
}

/**
 * Whose picture is this — a person's, or the chat's own?
 *
 * A group or channel avatar belongs to the chat and is keyed by `chat_id`. A
 * private chat's is a person's: `useChats` replaces the row's `avatar_url` with
 * the other member's before it ever reaches an avatar, so the variants worth
 * asking for are that person's, and the chat's own row — if the chat happens to
 * have one from before it was private, or from a picture no longer shown — is
 * not what is on screen.
 *
 * Exactly one of the two is ever set. Asking both stores would be harmless but
 * would put a chat id into a query about profiles, and a private chat would
 * take whichever answer arrived first.
 */
export function avatarVariantSubject(
  chatId: string | null | undefined,
  profileId: string | null | undefined,
): AvatarVariantSubject {
  if (profileId) return { profileId, chatId: null };
  return { profileId: null, chatId: chatId ?? null };
}

/**
 * The first candidate that actually has a picture; else the first answer given.
 *
 * A store answers "asked, and there is none" with an empty object rather than
 * `undefined`, so `a ?? b` would let a profile known to have no variant hide a
 * chat that has one.
 */
export function pickAvatarVariant(
  ...candidates: (AvatarVariantUrls | undefined)[]
): AvatarVariantUrls | undefined {
  return (
    candidates.find((candidate) => candidate?.avatar128Url || candidate?.avatar256Url) ??
    candidates.find((candidate) => candidate !== undefined)
  );
}
