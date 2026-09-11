import { actorClientMessageKey } from "./messageActor.ts";

/**
 * Merging a page fetched from the server into the conversation the store holds
 * (D-090).
 *
 * The store keeps a conversation after it is left, so reopening it renders at
 * once and revalidates after its channel joins (D-089). That revalidation used
 * to keep the store's copy of every message both sides had: the merge offered
 * the fetched copy first, and the choice returned the second copy it was given.
 * An edit, a deletion or a reaction made while the chat was closed came back in
 * the fetch and was dropped, and the old text stayed on screen until a reload.
 *
 * Two server copies of one message now resolve to the fetched copy, unless the
 * held copy is provably newer — deleted where the fetched one is not, or edited
 * later — which is what a Realtime change that landed after the fetch was taken
 * looks like. A local send that is still pending, checking or failed gives way
 * to its server copy and never replaces one. A reaction that lands between the
 * fetch and the merge carries nothing to order it by, so the fetched reactions
 * stand until the next reaction event.
 */

export interface MergeableMessage {
  id: string;
  created_at: string;
  edited_at?: string | null;
  deleted_at?: string | null;
  pending?: boolean;
  checking?: boolean;
  failed?: boolean;
  user_id?: string | null;
  bot_id?: string | null;
  client_message_id?: string | null;
}

export function isLocalOnlyMessage(message: MergeableMessage): boolean {
  return message.id.startsWith("tmp:") || Boolean(message.pending || message.checking || message.failed);
}

function timeOf(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

/** Two copies from the same side: the later one, unless only one of them reached the server. */
function chooseInOrder<T extends MergeableMessage>(earlier: T, later: T): T {
  if (isLocalOnlyMessage(earlier) && !isLocalOnlyMessage(later)) return later;
  if (!isLocalOnlyMessage(earlier) && isLocalOnlyMessage(later)) return earlier;
  return later;
}

/** The copy in the fetched page against the copy the store held. */
export function chooseMergedMessage<T extends MergeableMessage>(fetched: T, held: T): T {
  const fetchedIsLocal = isLocalOnlyMessage(fetched);
  const heldIsLocal = isLocalOnlyMessage(held);
  if (fetchedIsLocal !== heldIsLocal) return heldIsLocal ? fetched : held;
  if (heldIsLocal) return held;
  if (held.deleted_at && !fetched.deleted_at) return held;
  if (timeOf(held.edited_at) > timeOf(fetched.edited_at)) return held;
  return fetched;
}

export function mergeMessagesById<T extends MergeableMessage>(fetched: T[], existing: readonly T[]): T[] {
  if (!existing.length) return fetched;
  const merged: T[] = [];
  const fromFetch: boolean[] = [];
  const byId = new Map<string, number>();
  const byClientId = new Map<string, number>();

  const take = (message: T, isFetched: boolean) => {
    const clientKey = actorClientMessageKey(message);
    const index = byId.get(message.id) ?? (clientKey ? byClientId.get(clientKey) : undefined);
    if (index === undefined) {
      byId.set(message.id, merged.length);
      if (clientKey) byClientId.set(clientKey, merged.length);
      merged.push(message);
      fromFetch.push(isFetched);
      return;
    }
    const current = merged[index];
    const chosen = fromFetch[index] && !isFetched
      ? chooseMergedMessage(current, message)
      : chooseInOrder(current, message);
    if (chosen !== current) fromFetch[index] = isFetched;
    merged[index] = chosen;
    byId.set(chosen.id, index);
    const chosenClientKey = actorClientMessageKey(chosen);
    if (chosenClientKey) byClientId.set(chosenClientKey, index);
  };

  for (const message of fetched) take(message, true);
  for (const message of existing) take(message, false);

  return merged.sort((a, b) => {
    const byCreatedAt = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (byCreatedAt !== 0) return byCreatedAt;
    return a.id.localeCompare(b.id);
  });
}
