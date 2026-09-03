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
}

/** Nothing known for this profile. Frozen so a caller cannot poison the cache. */
const NONE: Readonly<AvatarVariantUrls> = Object.freeze({});

export function createAvatarVariantStore(
  fetcher: AvatarVariantFetcher,
  options: AvatarVariantStoreOptions = {},
) {
  const schedule = options.schedule ?? ((run: () => void) => void Promise.resolve().then(run));
  const batchSize = Math.max(1, options.batchSize ?? 100);

  const known = new Map<string, AvatarVariantUrls>();
  const pending = new Set<string>();
  const inFlight = new Set<string>();
  const listeners = new Set<() => void>();
  let flushScheduled = false;

  function emit(): void {
    for (const listener of [...listeners]) listener();
  }

  async function flush(): Promise<void> {
    flushScheduled = false;
    const batch = [...pending].slice(0, batchSize);
    if (batch.length === 0) return;
    for (const id of batch) {
      pending.delete(id);
      inFlight.add(id);
    }

    try {
      const answer = await fetcher(batch);
      for (const id of batch) {
        // An id the answer does not mention has no variant. Recording that is
        // what stops it being asked about on every subsequent render.
        known.set(id, Object.hasOwn(answer, id) ? answer[id] : NONE);
      }
    } catch {
      // A failure is not an answer: the ids are simply forgotten, so a later
      // render may ask again. What must not happen is caching "none" for a
      // network blip and serving originals for the rest of the session.
    } finally {
      for (const id of batch) inFlight.delete(id);
    }

    emit();
    if (pending.size > 0) scheduleFlush();
  }

  function scheduleFlush(): void {
    if (flushScheduled) return;
    flushScheduled = true;
    schedule(() => void flush());
  }

  return {
    /** Ask about a profile. Cheap and idempotent; safe to call every render. */
    request(profileId: string | null | undefined): void {
      if (!profileId) return;
      if (known.has(profileId) || inFlight.has(profileId) || pending.has(profileId)) return;
      pending.add(profileId);
      scheduleFlush();
    },

    /** What is known now. `undefined` means "not answered yet". */
    get(profileId: string | null | undefined): AvatarVariantUrls | undefined {
      if (!profileId) return undefined;
      return known.get(profileId);
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

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** Test seam. */
    __reset(): void {
      known.clear();
      pending.clear();
      inFlight.clear();
      listeners.clear();
      flushScheduled = false;
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
