import type { ActionFeedbackInput } from "./actionFeedback.ts";

/**
 * What a forward came to, and what a person is told about it.
 *
 * Kept apart from the hook and the dialog on purpose. The hook talks to
 * Supabase and the chat window mounts half the application, so neither can be
 * loaded by `node --test`; the decision about what to say is pure, and this is
 * where it is pinned.
 *
 * It exists because forwarding said nothing either way. The hook sent a refusal
 * to the console and returned null, and its caller closed the dialog without
 * reading the answer, so a forward the server refused and one it delivered
 * looked exactly alike.
 */

/** The outcome of one forward. `error` is already a sentence a person can read. */
export type ForwardMessageResult =
  | { ok: true; error: null }
  | { ok: false; error: string };

/**
 * One key for every forward. A retry that works replaces the failure it follows
 * instead of standing beside it and contradicting it.
 */
export const FORWARD_FEEDBACK_KEY = "message-forward";

/** Said when a failure arrives without a reason, so it still reads as one. */
const REASON_UNKNOWN = "Попробуйте ещё раз.";

export function forwardFeedback(
  result: ForwardMessageResult,
  targetChatName: string | null | undefined,
  /** How many were forwarded together, since several now go with one send. */
  count = 1,
): ActionFeedbackInput {
  if (result.ok) {
    const name = targetChatName?.trim();
    return {
      kind: "success",
      title: count > 1 ? "Сообщения пересланы" : "Сообщение переслано",
      detail: name ? `В чат «${name}»` : undefined,
      key: FORWARD_FEEDBACK_KEY,
    };
  }
  return {
    kind: "error",
    title: "Не удалось переслать сообщение",
    detail: result.error.trim() || REASON_UNKNOWN,
    key: FORWARD_FEEDBACK_KEY,
  };
}
