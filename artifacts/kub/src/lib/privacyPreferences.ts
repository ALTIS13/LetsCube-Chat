/**
 * The shared state behind a person's privacy preferences.
 *
 * Kept apart from the React hook for one reason: two components read this — the
 * settings panel and the heartbeat — and they must never disagree. With state
 * per caller, turning presence off in settings left the heartbeat publishing
 * until the next reload, which is the one thing a privacy setting may not do.
 * A single store also collapses what would otherwise be a second identical
 * query every time the settings panel opens.
 *
 * The storage calls are injected so the store can be exercised without a
 * network, a browser or a Supabase client.
 */

export interface PrivacyPreferences {
  /** Publish "last seen" and the online dot to other people. */
  presenceVisible: boolean;
}

export interface PrivacyPreferencesState {
  preferences: PrivacyPreferences;
  loading: boolean;
  error: string | null;
}

/** What the store needs from storage, and nothing more. */
export interface PrivacyGateway {
  /** `null` when the person has no row yet, which means the default. */
  read(userId: string): Promise<{ presenceVisible: boolean } | null>;
  write(userId: string, presenceVisible: boolean): Promise<void>;
  /** Erase what was already published. Only called when hiding presence. */
  clearPresence(userId: string): Promise<void>;
}

export const PRIVACY_DEFAULTS: Readonly<PrivacyPreferences> = Object.freeze({
  presenceVisible: true,
});

const INITIAL: PrivacyPreferencesState = {
  preferences: PRIVACY_DEFAULTS,
  loading: true,
  error: null,
};

const SIGNED_OUT: PrivacyPreferencesState = {
  preferences: PRIVACY_DEFAULTS,
  loading: false,
  error: null,
};

export function createPrivacyPreferencesStore(gateway: PrivacyGateway) {
  let state: PrivacyPreferencesState = INITIAL;
  let activeUserId: string | null = null;
  let loadedFor: string | null = null;
  let inFlight: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  function emit(next: PrivacyPreferencesState): void {
    state = next;
    for (const listener of [...listeners]) listener();
  }

  /**
   * Forget everything on an account change. Without this a second account in
   * the same tab would inherit the first one's answer, which for a privacy
   * setting means publishing presence the person had turned off.
   */
  function reset(userId: string | null): void {
    activeUserId = userId;
    loadedFor = null;
    inFlight = null;
    emit(userId ? INITIAL : SIGNED_OUT);
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot(): PrivacyPreferencesState {
      return state;
    },

    /** Idempotent: repeated calls for the same account do not re-query. */
    sync(userId: string | null): Promise<void> {
      if (!userId) {
        if (activeUserId !== null || state.loading) reset(null);
        return Promise.resolve();
      }
      if (loadedFor === userId) return Promise.resolve();
      if (activeUserId !== userId) reset(userId);
      if (inFlight) return inFlight;

      inFlight = (async () => {
        try {
          const row = await gateway.read(userId);
          // A reply that arrives after the account changed belongs to nobody.
          if (activeUserId !== userId) return;
          emit({
            preferences: { presenceVisible: row ? row.presenceVisible : true },
            loading: false,
            error: null,
          });
          loadedFor = userId;
        } catch (error) {
          if (activeUserId !== userId) return;
          // A failed read leaves the defaults in place rather than guessing at
          // something more private or less private than the person chose.
          emit({
            preferences: PRIVACY_DEFAULTS,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },

    async setPresenceVisible(userId: string | null, visible: boolean): Promise<boolean> {
      if (!userId) return false;
      const previous = state.preferences;
      emit({ preferences: { presenceVisible: visible }, loading: false, error: null });
      try {
        await gateway.write(userId, visible);
      } catch (error) {
        emit({
          preferences: previous,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
      loadedFor = userId;

      // Turning it off clears what was already published, so the change is
      // immediate for everyone rather than only for what happens next. A
      // failure here is not a failed setting — the preference is saved and the
      // heartbeat has stopped — so the stale value is left to expire.
      if (!visible) {
        try {
          await gateway.clearPresence(userId);
        } catch {
          /* noop: see above */
        }
      }
      return true;
    },
  };
}

export type PrivacyPreferencesStore = ReturnType<typeof createPrivacyPreferencesStore>;
