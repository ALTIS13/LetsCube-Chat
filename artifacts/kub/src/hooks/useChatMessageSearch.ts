"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { parseAdvancedSearchQuery, searchFiltersToRpc, type ParsedSearchQuery } from "@/lib/searchQuery";
import type { MessageWithSender } from "@/types/database";
import {
  canRunSearch,
  isMissingChatSearchError,
  mapRpcChatSearchRow,
  searchLoadedMessages,
  type ChatSearchResult,
  type RpcChatSearchRow,
} from "@/lib/chatMessageSearch";

/**
 * One search, two presentations.
 *
 * The phone's overlay (`ChatSearchBar`) and the list column's panel
 * (`ChatSearchPanel`) both take their state from here, so the counter, the
 * step-through order, the debounce, the fallback to loaded messages and the
 * jump to the first match cannot drift between the two forms. Only one of the
 * two is ever mounted — the gate is `useIsMobile()` at both call sites rather
 * than a CSS `hidden`, because two mounted copies would run two queries and
 * both would jump the conversation.
 *
 * `chatSearchRpcAvailability` stays module-level, as it was inside the bar:
 * once a deployment is known to be missing `search_chat_messages`, every
 * subsequent search in the session skips the round trip.
 */
let chatSearchRpcAvailability: "unknown" | "available" | "missing" = "unknown";

export interface ChatMessageSearch {
  query: string;
  setQuery: (value: string) => void;
  parsed: ParsedSearchQuery;
  canSearch: boolean;
  results: ChatSearchResult[];
  total: number;
  idx: number;
  jumpTo: (index: number) => void;
  loading: boolean;
  rpcMissing: boolean;
  allTopics: boolean;
  setAllTopics: (value: boolean | ((current: boolean) => boolean)) => void;
}

export function useChatMessageSearch({
  chatId,
  currentTopicId,
  isForum = false,
  messages,
  onJumpTo,
}: {
  chatId: string;
  currentTopicId?: string | null;
  isForum?: boolean;
  messages: MessageWithSender[];
  onJumpTo: (messageId: string, topicId?: string | null) => void | Promise<void>;
}): ChatMessageSearch {
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

  return {
    query,
    setQuery,
    parsed,
    canSearch,
    results,
    total,
    idx,
    jumpTo,
    loading,
    rpcMissing,
    allTopics,
    setAllTopics,
  };
}
