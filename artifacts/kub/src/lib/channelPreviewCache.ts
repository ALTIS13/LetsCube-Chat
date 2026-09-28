import type { MessageWithSender } from "../types/database.ts";
import { channelOfMessage, channelPreviewOf, laterPreview, type ChannelPreview } from "./channelPreview.ts";

/**
 * The channel list's last lines, kept for as long as the application runs
 * rather than for as long as the list is on screen (tracker item 54).
 *
 * Measured 2026-09-28 by `chat-list-event-cost.spec`: reading every channel's
 * last line each time the list mounted made reopening a server cost one read
 * per channel on top of the conversation's own, and the three gates that say
 * a reopened chat reads its history once went red. Telegram keeps a forum's
 * topic list and moves it by updates rather than asking again; so does this.
 * The chat list's socket hears every chat's messages, so an entry stays
 * current while its server is closed.
 *
 * An entry is dropped, to be read again the next time its list is shown, when
 * the connection comes back after a gap (anything may have been missed), when
 * the reader clears the chat, and when the message a line quotes is deleted —
 * the line under it is then the one before, which only a read can find. An
 * edit changes the line in place.
 *
 * Pure apart from its own state, so `node --test` drives every case.
 */

export interface ChannelPreviewScope {
  selfId: string;
  /** The text channels the entry answers for, as `useChannelPreviews` keys them. */
  channelsKey: string;
  generalChannelId: string | null;
  general: readonly string[];
}

interface Entry extends ChannelPreviewScope {
  previews: ReadonlyMap<string, ChannelPreview>;
  /** False while its first read is in flight: what is heard meanwhile is kept, not shown as the answer. */
  complete: boolean;
}

/** `"*"` when every entry went at once. */
type Listener = (chatId: string) => void;

export type ChannelPreviewLoad = object;

export interface ChannelPreviewCache {
  /** The lines held for this chat and these channels, or null when they have to be read. */
  read(chatId: string, scope: Pick<ChannelPreviewScope, "selfId" | "channelsKey">): ReadonlyMap<string, ChannelPreview> | null;
  /**
   * A read is starting. Messages heard from now on are kept, so a line written
   * while the read is in flight is not lost to it.
   */
  begin(chatId: string, scope: ChannelPreviewScope): ChannelPreviewLoad;
  /** The read answered. Ignored when the entry was dropped or replaced meanwhile. */
  complete(chatId: string, load: ChannelPreviewLoad, found: readonly ChannelPreview[]): ReadonlyMap<string, ChannelPreview> | null;
  /** A new message, from either socket. */
  hear(message: MessageWithSender): void;
  /** A message changed: an edit rewrites its line, a deletion drops the chat's entry. */
  hearUpdate(message: Pick<MessageWithSender, "id" | "chat_id" | "deleted_at"> & Partial<MessageWithSender>): void;
  evict(chatId: string): void;
  clear(): void;
  subscribe(listener: Listener): () => void;
}

export function createChannelPreviewCache(): ChannelPreviewCache {
  const entries = new Map<string, Entry>();
  const listeners = new Set<Listener>();

  const notify = (chatId: string) => {
    for (const listener of listeners) {
      try {
        listener(chatId);
      } catch {
        // One list's failure is its own.
      }
    }
  };

  const textChannelIds = (channelsKey: string) =>
    channelsKey ? channelsKey.split(",").map((part) => part.split(":")[0]) : [];

  return {
    read(chatId, scope) {
      const entry = entries.get(chatId);
      if (!entry || !entry.complete) return null;
      if (entry.selfId !== scope.selfId || entry.channelsKey !== scope.channelsKey) return null;
      return entry.previews;
    },

    begin(chatId, scope) {
      const entry: Entry = { ...scope, general: [...scope.general], previews: new Map(), complete: false };
      entries.set(chatId, entry);
      return entry;
    },

    complete(chatId, load, found) {
      const entry = entries.get(chatId);
      if (!entry || entry !== load) return null;
      const next = new Map(entry.previews);
      for (const preview of found) next.set(preview.channelId, laterPreview(next.get(preview.channelId), preview));
      entry.previews = next;
      entry.complete = true;
      return next;
    },

    hear(message) {
      const entry = entries.get(message.chat_id);
      if (!entry || message.deleted_at) return;
      const channelId = channelOfMessage(message, entry.generalChannelId, entry.general);
      if (!channelId || !textChannelIds(entry.channelsKey).includes(channelId)) return;
      const preview = channelPreviewOf(message, channelId, entry.selfId);
      if (!preview) return;
      const held = entry.previews.get(channelId);
      // The same message heard twice — once from each socket — keeps the line
      // it has, unless the second copy is the row read back with its bot's
      // name, which a socket row never carries.
      const next = held?.messageId === preview.messageId ? (message.bot ? preview : held) : laterPreview(held, preview);
      if (next === held) return;
      const previews = new Map(entry.previews);
      previews.set(channelId, next);
      entry.previews = previews;
      if (entry.complete) notify(message.chat_id);
    },

    hearUpdate(message) {
      const entry = entries.get(message.chat_id);
      if (!entry) return;
      const held = [...entry.previews.values()].find((preview) => preview.messageId === message.id);
      if (!held) return;
      if (message.deleted_at) {
        entries.delete(message.chat_id);
        notify(message.chat_id);
        return;
      }
      if (message.content === undefined) return;
      const rewritten = channelPreviewOf(
        { ...(message as MessageWithSender), created_at: held.at, topic_id: message.topic_id ?? null },
        held.channelId,
        entry.selfId,
      );
      if (!rewritten || rewritten.text === held.text) return;
      const previews = new Map(entry.previews);
      // The name stays the one already drawn: an update row carries no sender.
      previews.set(held.channelId, { ...held, text: rewritten.text });
      entry.previews = previews;
      if (entry.complete) notify(message.chat_id);
    },

    evict(chatId) {
      if (!entries.delete(chatId)) return;
      notify(chatId);
    },

    clear() {
      if (!entries.size) return;
      entries.clear();
      notify("*");
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const channelPreviewCache = createChannelPreviewCache();
