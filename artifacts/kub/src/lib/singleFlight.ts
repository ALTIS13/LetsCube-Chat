/**
 * Runs one operation per key at a time; concurrent callers share the result.
 *
 * Written for the profile load, where the cost of not having it was measured:
 * the profile was fetched from three places at once on a restored session — the
 * mount effect, and again for every auth event Supabase emits while recovering
 * a stored session. Against production, six restores out of ten then ended
 * stuck on the loading screen with all three requests still outstanding, while
 * the same query answers in half a millisecond when the database is asked
 * directly. With one request instead of three, ten out of ten restored in about
 * a second.
 *
 * The entry is dropped as soon as the operation settles, so this is a
 * concurrency guard and never a cache: the next caller starts fresh work.
 */
export function createSingleFlight<T>() {
  const inFlight = new Map<string, Promise<T>>();

  return {
    run(key: string, operation: () => Promise<T>): Promise<T> {
      const existing = inFlight.get(key);
      if (existing) return existing;

      // `finally` rather than `then`: a rejected operation must release the key
      // too, or one failure would wedge that key for the life of the page.
      const started = operation().finally(() => {
        inFlight.delete(key);
      });
      inFlight.set(key, started);
      return started;
    },

    /** How many operations are in flight. For tests and diagnostics. */
    size(): number {
      return inFlight.size;
    },
  };
}
