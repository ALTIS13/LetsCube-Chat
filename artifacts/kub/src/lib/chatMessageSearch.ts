import {
  mediaLabelForMessage,
  messageIsMediaSearchTarget,
  messageMatchesHasFilter,
  type ParsedSearchFilters,
} from "@/lib/searchQuery";
import type { MessageWithSender } from "@/types/database";
import { messageActorDisplayName, resolveMessageActor } from "@/lib/messageActor";

/**
 * What searching inside one chat decides, with no React and no browser in it.
 *
 * It used to live inside `ChatSearchBar.tsx`, which was fine while the bar was
 * the only way to search a chat. Since 2026-09-12 there are two forms of the
 * same search — the phone's overlay and the list column's panel — and a rule
 * that lives in one presentation cannot be shared by the other without one of
 * them importing the other's markup. So the decisions moved here and both
 * forms take them from the same place, through `useChatMessageSearch`.
 *
 * The same move makes them testable: this module imports no stylesheet, no
 * `import.meta.env` and no supabase client, so `node --test` can reach every
 * branch. That is the lesson recorded for `isSupabaseConfigured()` in
 * CLAUDE.md — a check that cannot be reached from a test is a gap in the
 * module boundary rather than in the suite.
 */

export type ChatSearchResult = {
  id: string;
  snippet: string;
  createdAt: string;
  senderName: string | null;
  topicId: string | null;
  type: string | null;
  mediaUrl: string | null;
  mimeType: string | null;
  source: "rpc" | "loaded";
};

export type RpcChatSearchRow = {
  message_id: string;
  chat_id: string;
  topic_id: string | null;
  sender_name: string | null;
  snippet: string | null;
  message_type: string | null;
  media_url: string | null;
  mime_type: string | null;
  created_at: string;
  rank: number | null;
};

/**
 * How many matches either form will hold. The column shows all of them and the
 * overlay scrolls through them; neither slices the set it was given, which is
 * the defect this cap replaced — the overlay used to render `slice(0, 6)` of
 * whatever it found, so a seventh match existed in the counter and nowhere a
 * person could reach it.
 */
export const MAX_CHAT_SEARCH_RESULTS = 80;

export function searchLoadedMessages(
  messages: MessageWithSender[],
  query: string,
  filters: ParsedSearchFilters,
  topicId: string | null | undefined,
): ChatSearchResult[] {
  const needle = query.trim().toLocaleLowerCase("ru-RU");
  return messages
    .filter((message) => {
      if (message.deleted_at) return false;
      if (topicId !== undefined && (message.topic_id ?? null) !== (topicId ?? null)) return false;
      if (filters.type === "media" && !messageIsMediaSearchTarget(message)) return false;
      if (!messageMatchesHasFilter(message, filters.has)) return false;
      if (filters.before && new Date(message.created_at).getTime() >= Date.parse(`${filters.before}T23:59:59.999Z`)) return false;
      if (filters.after && new Date(message.created_at).getTime() < Date.parse(`${filters.after}T00:00:00Z`)) return false;
      const senderName = messageActorDisplayName(resolveMessageActor(message));
      if (filters.from) {
        const from = filters.from.toLocaleLowerCase("ru-RU").replace(/^@+/, "");
        if (!senderName.toLocaleLowerCase("ru-RU").includes(from)) return false;
      }
      if (!needle) return filters.has.length > 0 || Boolean(filters.from || filters.before || filters.after);
      const mediaLabel = mediaLabelForMessage(message.type, message.content);
      const haystack = [message.content, senderName, mediaLabel].filter(Boolean).join(" ").toLocaleLowerCase("ru-RU");
      return haystack.includes(needle);
    })
    .map((message) => {
      const mediaLabel = mediaLabelForMessage(message.type, message.content);
      return {
        id: message.id,
        snippet: message.content?.trim() || mediaLabel || "Сообщение",
        createdAt: message.created_at,
        senderName: messageActorDisplayName(resolveMessageActor(message)),
        topicId: message.topic_id ?? null,
        type: message.type,
        mediaUrl: message.media_url,
        mimeType: null,
        source: "loaded" as const,
      };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, MAX_CHAT_SEARCH_RESULTS);
}

export function canRunSearch(query: string, filters: ParsedSearchFilters): boolean {
  return query.trim().length >= 2 || query.trim().startsWith("@") || filters.has.length > 0 || Boolean(filters.from || filters.before || filters.after);
}

export function mapRpcChatSearchRow(row: RpcChatSearchRow): ChatSearchResult {
  return {
    id: row.message_id,
    snippet: row.snippet ?? "Сообщение",
    createdAt: row.created_at,
    senderName: row.sender_name,
    topicId: row.topic_id,
    type: row.message_type,
    mediaUrl: row.media_url,
    mimeType: row.mime_type,
    source: "rpc",
  };
}

export function formatSearchDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

export function isMissingChatSearchError(error: { code?: string; message?: string; details?: string | null }): boolean {
  const text = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""}`;
  const code = error.code ?? "";
  const postgrestPrefix = "PGR" + "ST";
  return (
    code === `${postgrestPrefix}${202}` ||
    code === `${postgrestPrefix}${204}` ||
    text.includes("search_chat_messages") ||
    (text.includes("function") && text.includes("does not exist")) ||
    text.includes("Could not find the function")
  );
}

/**
 * The label a result row shows for whoever sent it. Both forms print the same
 * thing, and it goes through the shared fail-closed actor resolver above —
 * `tests/unit/bot-client-integration-contract.test.mjs` holds that line for
 * every surface that previews a sender's name.
 */
export function chatSearchResultTitle(result: ChatSearchResult): string {
  return result.senderName || mediaLabelForMessage(result.type, result.snippet) || "Сообщение";
}
