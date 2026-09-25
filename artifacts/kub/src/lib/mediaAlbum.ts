import type { MessageWithSender } from "../types/database.ts";
import { resolveMessageActor } from "./messageActor.ts";

export type MediaAlbumGroup =
  | { kind: "single"; messages: [MessageWithSender]; startIndex: number; albumId?: never }
  | { kind: "album"; messages: MessageWithSender[]; startIndex: number; albumId: string };

interface AlbumIdentity {
  albumId: string;
  index: number;
  count: number;
  chatId: string;
  actor: string;
}

const ALBUM_ID = /^[A-Za-z0-9][A-Za-z0-9-]{6,78}[A-Za-z0-9]$/;

function albumIdentity(message: MessageWithSender): AlbumIdentity | null {
  if (
    (message.type !== "image" && message.type !== "video") ||
    !message.media_url || !message.chat_id || message.deleted_at || message.failed
  ) return null;

  const metadata = message.media_metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const { album_id, album_index, album_count } = metadata as Record<string, unknown>;
  if (
    typeof album_id !== "string" || !ALBUM_ID.test(album_id) ||
    !Number.isInteger(album_count) || (album_count as number) < 2 || (album_count as number) > 10 ||
    !Number.isInteger(album_index) || (album_index as number) < 0 || (album_index as number) >= (album_count as number)
  ) return null;

  const actor = resolveMessageActor(message);
  if (actor.kind !== "user" && actor.kind !== "bot") return null;
  return {
    albumId: album_id,
    index: album_index as number,
    count: album_count as number,
    chatId: message.chat_id,
    actor: `${actor.kind}:${actor.id}`,
  };
}

/** Build runs from the visible render order; an absent or failed item never hides its neighbors. */
export function groupVisibleMediaAlbums(
  messages: readonly MessageWithSender[],
  breakBeforeIds: ReadonlySet<string> = new Set(),
): MediaAlbumGroup[] {
  const groups: MediaAlbumGroup[] = [];
  for (let position = 0; position < messages.length;) {
    const first = messages[position];
    const identity = albumIdentity(first);
    if (!identity) {
      groups.push({ kind: "single", messages: [first], startIndex: position });
      position += 1;
      continue;
    }

    const run = [{ message: first, index: identity.index }];
    const ids = new Set([first.id]);
    const indices = new Set([identity.index]);
    while (position + run.length < messages.length && run.length < identity.count) {
      const next = messages[position + run.length];
      const nextIdentity = albumIdentity(next);
      if (
        breakBeforeIds.has(next.id) || !nextIdentity || ids.has(next.id) || indices.has(nextIdentity.index) ||
        nextIdentity.albumId !== identity.albumId || nextIdentity.chatId !== identity.chatId ||
        nextIdentity.actor !== identity.actor || nextIdentity.count !== identity.count
      ) break;
      run.push({ message: next, index: nextIdentity.index });
      ids.add(next.id);
      indices.add(nextIdentity.index);
    }

    if (run.length > 1) groups.push({
      kind: "album",
      albumId: identity.albumId,
      messages: run.sort((left, right) => left.index - right.index).map((item) => item.message),
      startIndex: position,
    });
    else groups.push({ kind: "single", messages: [first], startIndex: position });
    position += run.length;
  }
  return groups;
}
