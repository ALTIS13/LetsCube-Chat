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

import type { ManualStatus } from "./presenceStatus.ts";
import type { PhoneFindableBy } from "./phoneFindability.ts";

export interface PrivacyPreferences {
  /** Publish "last seen" and the online dot to other people. */
  presenceVisible: boolean;
  /**
   * Let this person's name travel with a message of theirs that somebody
   * forwards (20260921120000).
   *
   * Disclosed by default, as in Telegram, and the control belongs to the person
   * being disclosed rather than to the reader's access. It is read by the
   * database at the moment of forwarding and written onto the copy there;
   * turning it off later reaches into nothing already sent, and turning it back
   * on does not un-hide anything either. So this switch governs what happens
   * next, and only that — which is what the row under it says on the screen.
   */
  forwardOriginVisible: boolean;
  /**
   * The status this person chose (tracker item 37) — theirs alone, beside
   * presence, because «Невидимый» and when a status runs out are nobody
   * else's to read. «online» is the absence of a choice.
   */
  manualStatus: ManualStatus;
  /** When it runs out, as ISO; null for «навсегда», and always for «online». */
  manualStatusUntil: string | null;
  /**
   * Who can find this person by their verified number (tracker item 74):
   * everybody, as in Telegram when nothing is stored, or only the people they
   * have saved. The lookup reads it in the database; nothing here enforces it.
   */
  phoneFindableBy: PhoneFindableBy;
}

export interface PrivacyPreferencesState {
  preferences: PrivacyPreferences;
  loading: boolean;
  error: string | null;
  /**
   * Whose answer this is: null signed out, and before any account has been
   * asked about. The heartbeat beats only on an answer that is its own
   * account's (`presencePublished`); from the signed-out default it published
   * presence for people who had turned it off (2026-09-30).
   */
  userId: string | null;
}

/** What the store needs from storage, and nothing more. */
export interface PrivacyGateway {
  /** `null` when the person has no row yet, which means the defaults. */
  read(userId: string): Promise<PrivacyPreferences | null>;
  /** Only the changed fields: another device may have changed the others. */
  write(userId: string, preferences: PrivacyPreferencePatch): Promise<void>;
  /** Erase what was already published. Only called when hiding presence. */
  clearPresence(userId: string): Promise<void>;
  /**
   * The chosen status, through `presence_set_status`: kept for every device of
   * this person and published at once. For «Невидимый» the database clears what
   * was published, so there is nothing left for the client to erase.
   */
  setStatus(userId: string, status: ManualStatus, until: string | null): Promise<void>;
}

export type PrivacyPreferencePatch = Partial<Pick<PrivacyPreferences,
  "presenceVisible" | "forwardOriginVisible" | "phoneFindableBy"
>>;

export const PRIVACY_DEFAULTS: Readonly<PrivacyPreferences> = Object.freeze({
  presenceVisible: true,
  // Disclosed by default: this is the owner's decision of 2026-09-20 and
  // Telegram's own behaviour, not a convenience. A default of `false` would
  // mean every forward made before anybody touched the setting carries no name,
  // which is the opposite of what «изначально все видят изначального
  // отправителя» says.
  forwardOriginVisible: true,
  manualStatus: "online",
  manualStatusUntil: null,
  phoneFindableBy: "everybody",
});

const INITIAL: PrivacyPreferencesState = {
  preferences: PRIVACY_DEFAULTS,
  loading: true,
  error: null,
  userId: null,
};

const SIGNED_OUT: PrivacyPreferencesState = {
  preferences: PRIVACY_DEFAULTS,
  loading: false,
  error: null,
  userId: null,
};

export function createPrivacyPreferencesStore(gateway: PrivacyGateway) {
  let state: PrivacyPreferencesState = INITIAL;
  let activeUserId: string | null = null;
  let loadedFor: string | null = null;
  let inFlight: Promise<void> | null = null;
  /** Moves on every write, so a read that started before one cannot undo it. */
  let revision = 0;
  let accountEpoch = 0;
  let writeTail: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();

  function emit(next: PrivacyPreferencesState): void {
    state = next;
    for (const listener of [...listeners]) listener();
  }

  /**
   * A settled answer for the account this store is on. An answer that is the
   * one already held changes nothing, and is not handed out again: the
   * heartbeat reads this store at the root of the application, so a new object
   * for the same answer — a window coming back into view, asked again —
   * re-rendered the open conversation for nothing.
   */
  function settle(preferences: PrivacyPreferences, error: string | null = null): void {
    const held = state.preferences;
    const same =
      !state.loading &&
      state.error === error &&
      state.userId === activeUserId &&
      (Object.keys(PRIVACY_DEFAULTS) as (keyof PrivacyPreferences)[]).every((key) => held[key] === preferences[key]);
    if (same) return;
    emit({ preferences, loading: false, error, userId: activeUserId });
  }

  function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function read(userId: string): Promise<void> {
    if (inFlight) return inFlight;
    const startedAt = revision;
    const epoch = accountEpoch;
    const pending = (async () => {
      try {
        const row = await gateway.read(userId);
        // A reply that arrives after the account changed belongs to nobody,
        // and one that started before a write would put the old value back.
        if (activeUserId !== userId || accountEpoch !== epoch || revision !== startedAt) return;
        loadedFor = userId;
        settle(row ? { ...PRIVACY_DEFAULTS, ...row } : { ...PRIVACY_DEFAULTS });
      } catch (error) {
        if (activeUserId !== userId || accountEpoch !== epoch || revision !== startedAt) return;
        // A failed read leaves the defaults in place rather than guessing at
        // something more private or less private than the person chose. On a
        // refresh the answer already held stays.
        if (loadedFor === userId) return;
        settle(PRIVACY_DEFAULTS, messageOf(error));
      }
    })().finally(() => {
      if (inFlight === pending) inFlight = null;
    });
    inFlight = pending;
    return pending;
  }

  /**
   * Forget everything on an account change. Without this a second account in
   * the same tab would inherit the first one's answer, which for a privacy
   * setting means publishing presence the person had turned off.
   */
  function reset(userId: string | null): void {
    accountEpoch += 1;
    revision += 1;
    activeUserId = userId;
    loadedFor = null;
    inFlight = null;
    writeTail = Promise.resolve();
    emit(userId ? { ...INITIAL, userId } : SIGNED_OUT);
  }

  function canEdit(userId: string | null): boolean {
    return userId !== null && activeUserId === userId && loadedFor === userId;
  }

  function writeChoice(
    userId: string | null,
    patch: Partial<PrivacyPreferences>,
    save: (account: string) => Promise<void>,
  ): Promise<boolean> {
    if (!canEdit(userId)) return Promise.resolve(false);
    const account = userId!;
    const epoch = accountEpoch;
    const operation = writeTail.then(async () => {
      if (accountEpoch !== epoch || !canEdit(account)) return false;
      const previous = state.preferences;
      revision += 1;
      settle({ ...previous, ...patch });
      try {
        await save(account);
      } catch (error) {
        if (accountEpoch === epoch && activeUserId === account) settle(previous, messageOf(error));
        return false;
      }
      return accountEpoch === epoch && activeUserId === account;
    });
    writeTail = operation;
    return operation;
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

    canEdit,

    /** Idempotent: repeated calls for the same account do not re-query. */
    sync(userId: string | null): Promise<void> {
      if (!userId) {
        if (activeUserId !== null || state.loading) reset(null);
        return Promise.resolve();
      }
      if (loadedFor === userId) return Promise.resolve();
      if (activeUserId !== userId) reset(userId);
      return read(userId);
    },

    /**
     * Ask again for the account already held, without a loading state: a
     * status chosen on another device reaches this one when it comes back into
     * view. Nothing for an account this store is not on.
     */
    refresh(userId: string | null): Promise<void> {
      if (!userId || activeUserId !== userId || loadedFor !== userId) return Promise.resolve();
      const epoch = accountEpoch;
      // A focus refresh must not read the pre-PATCH row and undo the choice
      // being saved. Reads begun before a newer write still use revision guards.
      return writeTail.then(() => {
        if (accountEpoch !== epoch || !canEdit(userId)) return;
        return read(userId);
      });
    },

    /** A partial update cannot overwrite a choice made on another device. */
    async setPreference<K extends keyof PrivacyPreferencePatch>(
      userId: string | null,
      key: K,
      value: PrivacyPreferences[K],
    ): Promise<boolean> {
      const patch = { [key]: value } as PrivacyPreferencePatch;
      return writeChoice(userId, patch, (account) => gateway.write(account, patch));
    },

    async setPresenceVisible(userId: string | null, visible: boolean): Promise<boolean> {
      // Turning it off clears what was already published, so the change is
      // immediate for everyone rather than only for what happens next. A
      // failure here is not a failed setting — the preference is saved and the
      // heartbeat has stopped — so the stale value is left to expire.
      return writeChoice(userId, { presenceVisible: visible }, async (account) => {
        await gateway.write(account, { presenceVisible: visible });
        if (!visible && activeUserId === account) {
          try { await gateway.clearPresence(account); } catch { /* expires on its own */ }
        }
      });
    },

    /**
     * The chosen status and when it runs out. The database keeps it for every
     * device and publishes it at once, «Невидимый» included, so others see the
     * change now rather than at the next heartbeat.
     */
    async setManualStatus(userId: string | null, status: ManualStatus, until: string | null): Promise<boolean> {
      const end = status === "online" ? null : until;
      return writeChoice(userId, { manualStatus: status, manualStatusUntil: end },
        (account) => gateway.setStatus(account, status, end));
    },
  };
}

export type PrivacyPreferencesStore = ReturnType<typeof createPrivacyPreferencesStore>;
