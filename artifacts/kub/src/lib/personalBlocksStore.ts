/**
 * The shared state behind «кого я заблокировал».
 *
 * Kept apart from the React hook for the reason `privacyPreferences.ts` is:
 * more than one surface reads it and they must never disagree. Three do — a
 * private chat's header menu, its contact card, and the list in settings — and
 * with state per caller, blocking somebody from the header would leave the card
 * beside it offering «Заблокировать» until a reload. A single store also
 * collapses what would otherwise be a query per mounted surface.
 *
 * The storage calls are injected, so every branch below — including the two
 * that put an optimistic row back when the write is refused — is reachable from
 * `node --test` without a network, a browser or a Supabase client.
 *
 * The rows are the reader's own and nobody else's: `user_blocks` is readable
 * only by its `blocker_id`, so this store holds one person's list and is reset
 * whenever that person changes.
 */

import {
  blockRefusalText,
  blocksReadFailureText,
  unblockRefusalText,
} from "./personalModeration.ts";

export interface BlockedPerson {
  readonly id: string;
  readonly fullName: string;
  readonly username: string | null;
  readonly avatarUrl: string | null;
  /** When the block was made. The list is newest first. */
  readonly createdAt: string;
}

export interface PersonalBlocksState {
  readonly people: readonly BlockedPerson[];
  /** The same list as a membership test, which is what the chat surfaces ask. */
  readonly ids: ReadonlySet<string>;
  readonly loading: boolean;
  readonly error: string | null;
}

/** What the store needs from storage, and nothing more. */
export interface PersonalBlocksGateway {
  /** Every person this user has blocked, with enough profile to draw a row. */
  read(userId: string): Promise<readonly BlockedPerson[]>;
  block(userId: string, blockedId: string): Promise<void>;
  unblock(userId: string, blockedId: string): Promise<void>;
}

export interface PersonalBlocksWriteResult {
  readonly ok: boolean;
  readonly error: string | null;
}

const NO_IDS: ReadonlySet<string> = new Set<string>();

const SIGNED_OUT: PersonalBlocksState = Object.freeze({
  people: Object.freeze([]) as readonly BlockedPerson[],
  ids: NO_IDS,
  loading: false,
  error: null,
});

const INITIAL: PersonalBlocksState = Object.freeze({
  people: Object.freeze([]) as readonly BlockedPerson[],
  ids: NO_IDS,
  loading: true,
  error: null,
});

/** Newest first, and by id where two rows carry the same instant. */
function ordered(people: readonly BlockedPerson[]): readonly BlockedPerson[] {
  return [...people].sort((a, b) => {
    const byTime = String(b.createdAt).localeCompare(String(a.createdAt));
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  });
}

function withIds(people: readonly BlockedPerson[], loading: boolean, error: string | null): PersonalBlocksState {
  const list = ordered(people);
  return { people: list, ids: new Set(list.map((person) => person.id)), loading, error };
}

/** The message of a thrown thing, without letting a non-Error through raw. */
function thrownMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : null;
}

export function createPersonalBlocksStore(gateway: PersonalBlocksGateway) {
  let state: PersonalBlocksState = INITIAL;
  let activeUserId: string | null = null;
  let loadedFor: string | null = null;
  let inFlight: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  function emit(next: PersonalBlocksState): void {
    state = next;
    for (const listener of [...listeners]) listener();
  }

  async function load(userId: string): Promise<void> {
    emit(withIds(state.people, true, null));
    try {
      const people = await gateway.read(userId);
      // The person may have changed while the read was in flight; an answer
      // for somebody else must not become this person's list.
      if (activeUserId !== userId) return;
      loadedFor = userId;
      emit(withIds(people, false, null));
    } catch (error) {
      if (activeUserId !== userId) return;
      emit(withIds([], false, blocksReadFailureText(thrownMessage(error))));
    }
  }

  /**
   * Load once per person. Signing out empties the list rather than leaving the
   * previous person's blocks on screen behind a spinner.
   */
  function sync(userId: string | null): Promise<void> {
    if (!userId) {
      activeUserId = null;
      loadedFor = null;
      if (state !== SIGNED_OUT) emit(SIGNED_OUT);
      return Promise.resolve();
    }
    if (activeUserId !== userId) {
      activeUserId = userId;
      loadedFor = null;
      inFlight = null;
      emit(withIds([], true, null));
    }
    if (loadedFor === userId) return Promise.resolve();
    if (!inFlight) {
      inFlight = load(userId).finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot(): PersonalBlocksState {
      return state;
    },

    sync,

    /** Ask again — after a failure, or when a surface wants the list current. */
    refresh(userId: string | null): Promise<void> {
      loadedFor = null;
      return sync(userId);
    },

    /**
     * Add the row, and show it at once.
     *
     * Optimistic because the control that starts it is a menu item that closes
     * behind the press: waiting for the round trip leaves the card beside it
     * still saying «Заблокировать». A refusal takes the row back out, so the
     * screen never keeps a block the database does not have.
     */
    async block(userId: string | null, person: BlockedPerson): Promise<PersonalBlocksWriteResult> {
      if (!userId) return { ok: false, error: blockRefusalText(null) };
      if (state.ids.has(person.id)) return { ok: true, error: null };
      const before = state.people;
      emit(withIds([...before, person], state.loading, null));
      try {
        await gateway.block(userId, person.id);
        return { ok: true, error: null };
      } catch (error) {
        const message = blockRefusalText(thrownMessage(error));
        emit(withIds(before, state.loading, message));
        return { ok: false, error: message };
      }
    },

    /** The same, downwards. */
    async unblock(userId: string | null, blockedId: string): Promise<PersonalBlocksWriteResult> {
      if (!userId) return { ok: false, error: unblockRefusalText(null) };
      const before = state.people;
      if (!state.ids.has(blockedId)) return { ok: true, error: null };
      emit(withIds(before.filter((person) => person.id !== blockedId), state.loading, null));
      try {
        await gateway.unblock(userId, blockedId);
        return { ok: true, error: null };
      } catch (error) {
        const message = unblockRefusalText(thrownMessage(error));
        emit(withIds(before, state.loading, message));
        return { ok: false, error: message };
      }
    },

    /** Drops the banner without asking again. */
    clearError(): void {
      if (state.error === null) return;
      emit({ ...state, error: null });
    },

    /** For tests: forget everything, including who was loaded. */
    reset(): void {
      activeUserId = null;
      loadedFor = null;
      inFlight = null;
      emit(INITIAL);
    },
  };
}

export type PersonalBlocksStore = ReturnType<typeof createPersonalBlocksStore>;
