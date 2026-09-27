/**
 * A send the reader has committed to (D-314): «Отправить» was pressed, so the
 * row goes to the chat it was sent from — the caller names it — whether or not
 * that chat is still on screen, and leaving it is not a cancellation. What
 * still stops it is the account changing under it: a row must never go out
 * as somebody who did not press the button.
 *
 * A module of its own, with no imports, so the rule can be tested directly.
 */
export type CommittedSendResult<T> =
  | { status: "sent"; value: T }
  | { status: "failed" }
  | { status: "stale" };

export async function runCommittedStagedSendAttempt<T>(
  sameAccount: () => boolean,
  send: () => Promise<T | null | undefined | false>,
): Promise<CommittedSendResult<T>> {
  if (!sameAccount()) return { status: "stale" };
  try {
    const value = await send();
    return value ? { status: "sent", value } : { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}
