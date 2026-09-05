/**
 * Which messages are new enough to be worth animating in.
 *
 * `msg-appear` was applied to every bubble unconditionally, so it played on
 * every mount — including all of history the moment a chat opened. Fifty
 * bubbles fading and sliding at once is what "дёргано, без плавности" is
 * describing; the animation was not missing, it was firing where nothing had
 * happened.
 *
 * The rule is "arrived while I was watching", and it is deliberately decided by
 * identity rather than by a timestamp: `created_at` comes from the server for a
 * received message and from the client for an optimistic one, so comparing it
 * against a local clock would animate or skip messages depending on clock skew.
 * What actually matters is whether this id was on screen a moment ago.
 */
export interface MessageEntranceState {
  /** Ids rendered on the previous pass. */
  seen: ReadonlySet<string>;
  /** False until the first pass has been recorded, so history never animates. */
  primed: boolean;
  /**
   * Which conversation `seen` belongs to.
   *
   * The list component is not remounted between chats, so without this the set
   * carried over: every message of the chat you opened second was an id that
   * had never been seen, and the whole history animated — the exact behaviour
   * `primed` was added to stop, surviving in every case but the first.
   */
  scope: string | null;
  /**
   * The exact input that produced `lastEntering`, and that result.
   *
   * The caller advances this from inside a `useMemo`, which React may invoke
   * more than once for one render — StrictMode does it deliberately. Without
   * this, the second invocation would compare the new ids against a `seen` the
   * first invocation had already updated, find nothing new, and silently drop
   * the animation in development. Repeating the same call returns the same
   * answer instead.
   */
  signature: string | null;
  lastEntering: ReadonlySet<string>;
}

export const EMPTY_ENTRANCE_STATE: MessageEntranceState = {
  seen: new Set<string>(),
  primed: false,
  scope: null,
  signature: null,
  lastEntering: new Set<string>(),
};

/**
 * The identity an entrance is remembered by.
 *
 * A message you send is rendered twice under two different ids: first
 * optimistically as `tmp:<client id>`, then as the server row once the insert
 * comes back. The React key changes with it, so the row is a different DOM node
 * and the CSS animation plays a second time. Measured on a real send, the bubble
 * faded in at t=68ms, finished at t=182ms, and faded in again from zero at
 * t=231ms — a message you just sent blinks.
 *
 * `client_message_id` is written by the sender and comes back on the server row,
 * so it is the one value that is the same on both sides of that swap. Rows
 * without one — history predating the column, bot messages — keep their id.
 */
export function messageEntranceKey(
  message: { id: string; client_message_id?: string | null },
): string {
  return message.client_message_id ? `cid:${message.client_message_id}` : message.id;
}

/**
 * Folds the ids now on screen into the previous state.
 *
 * The first call only records what is there — nothing animates on the first
 * paint of a chat, which is the whole point. Every call after it treats an id
 * that was not in `seen` as newly arrived.
 *
 * `renderIdentity` is what React actually rendered, and it is a separate
 * argument because the two questions it answers are separate. The idempotency
 * cache has to key off what was rendered, since its whole purpose is to answer a
 * repeated `useMemo` invocation identically. Arrival has to key off
 * `messageEntranceKey`, since that is what survives the optimistic swap.
 * Collapsing the two re-animates that swap: the entrance keys do not change
 * across it, so the cache would hand the previous answer — which still lists the
 * message as entering — to a row that has just remounted under its server id.
 */
export function advanceMessageEntrance(
  previous: MessageEntranceState,
  ids: readonly string[],
  renderIdentity: readonly string[] = ids,
  scope: string | null = null,
): { state: MessageEntranceState; entering: ReadonlySet<string> } {
  const signature = renderIdentity.join("\u0000");
  // Asked the same question twice: give the same answer, do not re-diff against
  // a `seen` this call already advanced.
  if (previous.signature === signature && previous.scope === scope) {
    return { state: previous, entering: previous.lastEntering };
  }

  const now = new Set(ids);
  const settle = (entering: Set<string>) => ({
    state: { seen: now, primed: true, scope, signature, lastEntering: entering },
    entering,
  });

  // The first pass records; it never animates. Neither does the first pass of a
  // different conversation, which is the same statement now that the list is
  // known to outlive the chat it is showing.
  if (!previous.primed || previous.scope !== scope) return settle(new Set<string>());

  // D-045. "Arrived while I was watching" is a claim about *where* an id turned
  // up, not only about whether it is new. A history prepend adds a hundred ids
  // that are all new and all older than everything on screen, and the previous
  // rule animated every one of them: measured on one prepend, 91 bubbles
  // carried the class in a single frame and 11 of those were in the viewport.
  //
  // The anchor is the last id that was already on screen. Anything after it
  // arrived at the end of the conversation, which is the only arrival a reader
  // watches happen. Anything before it is history that has just been fetched,
  // or a gap a jump has filled in - nobody saw either of those arrive.
  let lastSeenIndex = -1;
  for (let index = ids.length - 1; index >= 0; index -= 1) {
    if (previous.seen.has(ids[index])) {
      lastSeenIndex = index;
      break;
    }
  }

  // Nothing on screen was on screen a moment ago. Inside one conversation that
  // means the window was replaced wholesale - a jump to a message far from here
  // - so there is no arrival to animate. The exception is a chat that held no
  // messages at all, where the first one really did just arrive.
  if (lastSeenIndex < 0 && previous.seen.size > 0) return settle(new Set<string>());

  const entering = new Set<string>();
  for (let index = lastSeenIndex + 1; index < ids.length; index += 1) {
    if (!previous.seen.has(ids[index])) entering.add(ids[index]);
  }

  return settle(entering);
}
