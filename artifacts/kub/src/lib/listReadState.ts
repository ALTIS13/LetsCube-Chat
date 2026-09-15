/**
 * What a list should show when a read fails (D-140).
 *
 * The administration's sanctions tab rendered «Активных банов нет» whenever its
 * query was refused, because it looked only at `data ?? []` and never at
 * `error`. A moderator reading that concludes nobody is restricted, and there
 * is nothing on the screen to suggest otherwise. The same shape — treat an
 * empty answer as an answer — is why a probe returning nothing has to be proved
 * to match something known before it is believed.
 *
 * Four states rather than the usual two, because "we have rows and the newest
 * read failed" is genuinely different from both "loading" and "broken": the
 * rows are older than the database, but they are true, and blanking them would
 * replace something true with something false.
 *
 * The second half of the module — everything below `ListReadProgress` — is the
 * same idea for a list a hook holds and re-reads rather than a tab that reads
 * once. It is here and not in a module of its own precisely because it is the
 * same idea: one vocabulary, or the surfaces drift.
 */

import { LIST_UNAVAILABLE } from "./plainMessages.ts";

export type ListReadView =
  /** Nothing to show yet and a read in flight. */
  | "loading"
  /** Nothing has ever loaded and the last read failed. */
  | "unavailable"
  /** Rows are on screen, and the newest read failed, so they may be old. */
  | "stale"
  /** Rows are on screen and current. */
  | "ready";

export interface ListReadState {
  /** A read is in flight that is allowed to replace the screen. */
  readonly loading: boolean;
  /** The last read's refusal, already in a person's words, or null. */
  readonly error: string | null;
  /** Whether any read has ever succeeded. */
  readonly loadedOnce: boolean;
}

export function listReadView(state: ListReadState): ListReadView {
  if (state.loading) return "loading";
  if (state.error) return state.loadedOnce ? "stale" : "unavailable";
  return "ready";
}

/**
 * Whether a read may replace the screen with a spinner.
 *
 * A realtime notification arrives while somebody is reading the list, and the
 * old code answered every one of them by blanking the tab. Only the first read
 * and a deliberate retry are allowed to do that.
 */
export function readReplacesScreen(options: {
  readonly background: boolean;
  readonly loadedOnce: boolean;
}): boolean {
  return !(options.background && options.loadedOnce);
}

// ---------------------------------------------------------------------------
// A list a hook holds between reads (F-6)
// ---------------------------------------------------------------------------

/**
 * The same three facts, plus what the rows on screen are about.
 *
 * `useTasks`, `useChats` and `useTopics` each hold one list and read it again —
 * on a sign-in, on opening another conversation, on a filter, and on every
 * realtime notification. All three turned a refused read into an empty list:
 * «Нет доступных задач», «Чаты не найдены», a forum quietly drawn as an
 * ordinary chat. The three states above are enough for a tab that asks one
 * question; a hook whose question changes needs one fact more, because «these
 * rows are older than the database» and «these rows are about the conversation
 * you just left» are different claims and only the first is worth keeping.
 *
 * `useServerChannels` reached the same conclusion from the other side on
 * 2026-09-14, and for a harder reason: it carries the chat its answer was read
 * for, because `voiceCallLostItsChannel` hangs up a live call on «this chat has
 * no such room».
 *
 * `subject` is whatever names the question — a chat id, the signed-in account,
 * a filter written out as a string. Null before anything has been read.
 */
export interface ListReadProgress extends ListReadState {
  readonly subject: string | null;
}

/** Before the first read of all: nothing known, and a read on its way. */
export const LIST_READ_PENDING: ListReadProgress = {
  loading: true,
  error: null,
  loadedOnce: false,
  subject: null,
};

/**
 * A read is on its way.
 *
 * Whether it may blank the screen is `readReplacesScreen`'s decision rather
 * than a second one written beside it.
 */
export function listReadStarted(
  previous: ListReadProgress,
  options: { readonly background: boolean },
): ListReadProgress {
  return {
    ...previous,
    loading: readReplacesScreen({
      background: options.background,
      loadedOnce: previous.loadedOnce,
    }),
  };
}

/** Rows came back. They answer `subject`, and they are current. */
export function listReadSucceeded(subject: string | null): ListReadProgress {
  return { loading: false, error: null, loadedOnce: true, subject };
}

/**
 * The read was refused, and whatever is on screen is all that is still known.
 *
 * It is kept — and called stale — only when it answers the question that was
 * just asked. Rows read for another conversation are not an old answer to this
 * one; there is no answer to this one, which is what «unavailable» says.
 *
 * A refusal handed over with nothing in it still has to read as a refusal: an
 * empty `error` would make `listReadView` answer «ready», and the surface would
 * draw the empty list this whole module exists to prevent. So the one sentence
 * that fits every list stands in.
 */
export function listReadRefused(
  previous: ListReadProgress,
  failure: { readonly subject: string | null; readonly message: string },
): ListReadProgress {
  const answersThis = previous.loadedOnce && previous.subject === failure.subject;
  return {
    loading: false,
    error: failure.message.trim() || LIST_UNAVAILABLE,
    loadedOnce: answersThis,
    subject: failure.subject,
  };
}

/**
 * There is nothing here to read at all: a chat that is not a forum, a list this
 * account is not shown. An empty list and no failure — which is the one answer
 * a refusal must never give, said where it happens to be true.
 */
export function listReadCleared(): ListReadProgress {
  return { loading: false, error: null, loadedOnce: false, subject: null };
}

/**
 * The read is over, however it ended.
 *
 * For a `finally`, so that a path nobody thought of cannot leave a spinner
 * turning for ever. It returns the state it was given when there is nothing to
 * change, so it costs no render.
 */
export function listReadEnded(previous: ListReadProgress): ListReadProgress {
  return previous.loading ? { ...previous, loading: false } : previous;
}

/** Whether the last read failed, whatever is still on screen. */
export function listReadFailed(view: ListReadView): boolean {
  return view === "unavailable" || view === "stale";
}

/**
 * The rows and how well they are known, held together.
 *
 * Together rather than beside each other, because what survives a refusal is
 * one rule and not two: `listReadRefused` answers «do the rows on screen still
 * answer the question» in its `loadedOnce`, and the rows follow that answer
 * instead of a second copy of it written next to them. `useChats` is the one
 * hook that does not use this — its rows live in the store, where realtime
 * events apply to them one at a time — so it holds `ListReadProgress` alone.
 */
export interface HeldList<T> extends ListReadProgress {
  readonly rows: readonly T[];
}

/** Nothing read yet, and a read on its way. */
export function heldListPending<T>(): HeldList<T> {
  return { ...LIST_READ_PENDING, rows: [] };
}

/** A read is on its way; see `listReadStarted`. */
export function heldListStarted<T>(
  previous: HeldList<T>,
  options: { readonly background: boolean },
): HeldList<T> {
  return { ...previous, ...listReadStarted(previous, options) };
}

/** Rows came back for `subject`. */
export function heldListSucceeded<T>(rows: readonly T[], subject: string | null): HeldList<T> {
  return { ...listReadSucceeded(subject), rows };
}

/**
 * The read was refused.
 *
 * The rows stay when they are still this question's answer, and go when they
 * are the previous conversation's — otherwise a forum that refused its read
 * would draw the channels of the chat before it, which is worse than drawing
 * none.
 */
export function heldListRefused<T>(
  previous: HeldList<T>,
  failure: { readonly subject: string | null; readonly message: string },
): HeldList<T> {
  const next = listReadRefused(previous, failure);
  return { ...next, rows: next.loadedOnce ? previous.rows : [] };
}

/** Nothing here to read at all; see `listReadCleared`. */
export function heldListCleared<T>(): HeldList<T> {
  return { ...listReadCleared(), rows: [] };
}
