"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KubIcon } from "@/components/kub";
import { SearchFilterChips } from "@/components/search/SearchShared";
import { createClient } from "@/lib/supabase/client";
import {
  mediaLabelForMessage,
  messageIsMediaSearchTarget,
  messageMatchesHasFilter,
  parseAdvancedSearchQuery,
  searchFiltersToRpc,
  type ParsedSearchFilters,
} from "@/lib/searchQuery";
import type { MessageWithSender } from "@/types/database";
import { messageActorDisplayName, resolveMessageActor } from "@/lib/messageActor";

interface ChatSearchBarProps {
  chatId: string;
  currentTopicId?: string | null;
  isForum?: boolean;
  messages: MessageWithSender[];
  onClose: () => void;
  onJumpTo: (messageId: string, topicId?: string | null) => void | Promise<void>;
}

type ChatSearchResult = {
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

type RpcChatSearchRow = {
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

let chatSearchRpcAvailability: "unknown" | "available" | "missing" = "unknown";

export function ChatSearchBar({ chatId, currentTopicId, isForum = false, messages, onClose, onJumpTo }: ChatSearchBarProps) {
  const supabase = useMemo(() => createClient(), []);
  const [query, setQuery] = useState("");
  const [idx, setIdx] = useState(0);
  const [allTopics, setAllTopics] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rpcMissing, setRpcMissing] = useState(chatSearchRpcAvailability === "missing");
  const [remoteResults, setRemoteResults] = useState<ChatSearchResult[]>([]);
  const requestIdRef = useRef(0);

  const parsed = useMemo(() => parseAdvancedSearchQuery(query, "message"), [query]);
  const canSearch = canRunSearch(parsed.query, parsed.filters);

  const loadedResults = useMemo(
    () => searchLoadedMessages(messages, parsed.query, parsed.filters, allTopics ? undefined : currentTopicId),
    [allTopics, currentTopicId, messages, parsed.filters, parsed.query],
  );

  const results = chatSearchRpcAvailability === "available" ? remoteResults : loadedResults;
  const total = results.length;

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!canSearch) {
      setRemoteResults([]);
      setLoading(false);
      setIdx(0);
      return;
    }

    if (chatSearchRpcAvailability === "missing") {
      setRpcMissing(true);
      setRemoteResults([]);
      return;
    }

    setLoading(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        const { data, error } = await supabase.rpc("search_chat_messages", {
          p_chat_id: chatId,
          p_query: parsed.query,
          p_filters: searchFiltersToRpc(parsed.filters),
          p_limit: 80,
          p_topic_id: isForum && !allTopics ? currentTopicId ?? null : null,
          p_all_topics: !isForum || allTopics,
        });
        if (requestIdRef.current !== requestId) return;
        setLoading(false);

        if (error) {
          if (isMissingChatSearchError(error)) {
            chatSearchRpcAvailability = "missing";
            setRpcMissing(true);
            setRemoteResults([]);
            return;
          }
          if (import.meta.env.DEV) console.warn("[chat-search] rpc failed", error);
          setRemoteResults([]);
          return;
        }

        chatSearchRpcAvailability = "available";
        setRpcMissing(false);
        setRemoteResults(((data ?? []) as RpcChatSearchRow[]).map(mapRpcChatSearchRow));
      })();
    }, 250);

    return () => window.clearTimeout(timer);
  }, [allTopics, canSearch, chatId, currentTopicId, isForum, parsed.filters, parsed.query, supabase]);

  useEffect(() => {
    setIdx(0);
  }, [parsed.query, parsed.filters, allTopics]);

  useEffect(() => {
    if (!canSearch || total === 0) return;
    const first = results[0];
    if (first) void onJumpTo(first.id, first.topicId);
  }, [canSearch, onJumpTo, results, total]);

  const jumpTo = useCallback((i: number) => {
    const target = results[i];
    if (!target) return;
    setIdx(i);
    void onJumpTo(target.id, target.topicId);
  }, [onJumpTo, results]);

  return (
    <div className="flex flex-shrink-0 flex-col border-b border-[color:var(--kub-border-color)] bg-[var(--kub-surface)]">
      <div className="flex items-center gap-2 px-3 py-2">
        <KubIcon name="search" size={14} className="text-[color:var(--kub-muted)]" />
        <input
          autoFocus
          type="text"
          placeholder="Поиск в чате…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm text-[color:var(--kub-text)] outline-none placeholder:text-[color:var(--kub-muted)]"
        />

        {loading && <KubIcon name="spinner" size={14} tone="accent" />}

        {canSearch && (
          <span className="flex-shrink-0 text-xs tabular-nums text-[color:var(--kub-muted)]">
            {total > 0 ? `${idx + 1}/${total}` : "ничего не найдено"}
          </span>
        )}

        <div className="flex items-center gap-0">
          <button
            type="button"
            onClick={() => jumpTo(Math.max(0, idx - 1))}
            disabled={total === 0 || idx === 0}
            className="rounded-lg p-1.5 text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-cyan)] disabled:opacity-30"
            aria-label="Предыдущий"
          >
            <KubIcon name="chevronUp" size={16} />
          </button>
          <button
            type="button"
            onClick={() => jumpTo(Math.min(total - 1, idx + 1))}
            disabled={total === 0 || idx === total - 1}
            className="rounded-lg p-1.5 text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-cyan)] disabled:opacity-30"
            aria-label="Следующий"
          >
            <KubIcon name="chevronDown" size={16} />
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-[color:var(--kub-muted)] transition-colors kub-raise-hover"
          aria-label="Закрыть"
        >
          <KubIcon name="close" size={16} />
        </button>
      </div>

      <SearchFilterChips parsed={parsed} query={query} onChangeQuery={setQuery} compact />

      <div className="flex flex-wrap items-center gap-2 px-3 pb-2 text-[11px] text-[color:var(--kub-muted)]">
        {isForum && (
          <button
            type="button"
            onClick={() => setAllTopics((value) => !value)}
            className="rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-2 py-1 font-semibold transition hover:border-[color:var(--kub-cyan)] hover:text-[color:var(--kub-accent-text)]"
          >
            {allTopics ? "Все темы" : "Текущая тема"}
          </button>
        )}
        {rpcMissing && (
          <span>Поиск сейчас выполняется по загруженным сообщениям.</span>
        )}
      </div>

      {canSearch && total > 0 && (
        <div className="max-h-36 space-y-1 overflow-y-auto px-3 pb-2">
          {results.slice(0, 6).map((result, resultIndex) => {
            const active = resultIndex === idx;
            return (
              <button
                key={result.id}
                type="button"
                onClick={() => jumpTo(resultIndex)}
                className={[
                  "flex w-full min-w-0 items-start gap-2 rounded-xl px-2 py-1.5 text-left text-xs transition-colors",
                  active
                    ? "bg-[color-mix(in_srgb,var(--kub-cyan)_14%,var(--kub-surface-2))] text-[color:var(--kub-text)]"
                    : "kub-raise-hover",
                ].join(" ")}
              >
                <span className="mt-0.5 shrink-0 text-[10px] tabular-nums text-[color:var(--kub-muted)]">
                  {resultIndex + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-[color:var(--kub-text)]">
                    {result.senderName || mediaLabelForMessage(result.type, result.snippet) || "Сообщение"}
                  </span>
                  <span className="mt-0.5 block truncate text-[color:var(--kub-muted)]">
                    {result.snippet}
                  </span>
                </span>
                <span className="shrink-0 text-[10px] text-[color:var(--kub-muted)]">
                  {formatSearchDate(result.createdAt)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function searchLoadedMessages(
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
    .slice(0, 80);
}

function canRunSearch(query: string, filters: ParsedSearchFilters): boolean {
  return query.trim().length >= 2 || query.trim().startsWith("@") || filters.has.length > 0 || Boolean(filters.from || filters.before || filters.after);
}

function mapRpcChatSearchRow(row: RpcChatSearchRow): ChatSearchResult {
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

function formatSearchDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

function isMissingChatSearchError(error: { code?: string; message?: string; details?: string | null }): boolean {
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
