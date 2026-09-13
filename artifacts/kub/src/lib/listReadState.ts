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
 */

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
