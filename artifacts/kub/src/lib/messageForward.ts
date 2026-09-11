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

export const FORWARD_RPC = "forward_message";

/** What a forward reads from the message it forwards. */
export interface ForwardSource {
  id: string;
  content: string | null;
  type: string;
  media_url: string | null;
  media_bucket?: string | null;
  media_path?: string | null;
  media_metadata?: unknown;
}

export interface ForwardTarget {
  chatId: string;
  userId: string;
  clientMessageId: string;
  clientSentAt: string;
}

/**
 * The server makes the copy from its own row of the source, with the media and
 * the source's previews (`forward_message`, 20260911144000), so the client
 * sends ids and nothing it could get wrong.
 */
export function forwardRpcArgs(source: Pick<ForwardSource, "id">, target: ForwardTarget) {
  return {
    p_source_message_id: source.id,
    p_target_chat_id: target.chatId,
    p_client_message_id: target.clientMessageId,
    p_client_sent_at: target.clientSentAt,
  };
}

/**
 * The copy this client inserts where `forward_message` is not deployed. It used
 * to carry `media_url` only, and a forwarded photo lost its previews (D-083): it
 * now carries the bucket, the path and the whole metadata — an original's
 * `uncompressed` flag and its preview path included — so the bubble and the
 * viewer have what they need, and the variant worker renders the copy's
 * previews on its next pass.
 */
export function forwardInsertPayload(source: ForwardSource, target: ForwardTarget) {
  const payload = {
    chat_id: target.chatId,
    user_id: target.userId,
    content: source.content,
    type: source.type,
    media_url: source.media_url ?? null,
    media_bucket: source.media_bucket ?? null,
    media_path: source.media_path ?? null,
    forwarded_from_id: source.id,
    client_message_id: target.clientMessageId,
    client_sent_at: target.clientSentAt,
  };
  return source.media_metadata === undefined ? payload : { ...payload, media_metadata: source.media_metadata };
}

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
