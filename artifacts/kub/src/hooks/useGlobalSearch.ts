"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getChatDisplayInfo } from "@/lib/chatDisplay";
import { useAppStore } from "@/store/app.store";
import type { ChatWithLastMessage, Location, MessageWithSender, Profile, TaskStatus } from "@/types/database";

export type GlobalSearchResultType = "user" | "chat" | "message" | "task" | "location" | "command";
export type GlobalSearchDataType = Exclude<GlobalSearchResultType, "command">;
export type GlobalSearchSource = "rpc" | "fallback" | "command";

export interface GlobalSearchResult {
  resultType: GlobalSearchResultType;
  id: string;
  title: string;
  subtitle?: string | null;
  snippet?: string | null;
  avatarUrl?: string | null;
  chatId?: string | null;
  messageId?: string | null;
  taskId?: string | null;
  locationId?: string | null;
  createdAt?: string | null;
  rank?: number | null;
  source: GlobalSearchSource;
  profile?: Pick<Profile, "id" | "full_name" | "username" | "avatar_url" | "role" | "bio" | "online_at"> | null;
}

type RpcGlobalSearchRow = {
  result_type: string;
  id: string;
  title: string;
  subtitle: string | null;
  snippet: string | null;
  avatar_url: string | null;
  chat_id: string | null;
  message_id: string | null;
  task_id: string | null;
  location_id: string | null;
  created_at: string | null;
  rank: number | null;
};

type FallbackTaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  due_at: string | null;
  location_id: string | null;
  chat_id: string | null;
  updated_at: string;
  deleted_at: string | null;
  location?: { name: string | null } | null;
};

type FallbackLocationRow = Pick<Location, "id" | "name" | "description" | "address" | "updated_at">;

interface UseGlobalSearchOptions {
  query: string;
  type: GlobalSearchDataType | "all";
  enabled: boolean;
  limit?: number;
}

interface UseGlobalSearchResult {
  query: string;
  results: GlobalSearchResult[];
  loading: boolean;
  migrationMissing: boolean;
  usedFallback: boolean;
  error: string | null;
}

let rpcAvailability: "unknown" | "available" | "missing" = "unknown";

const DATA_TYPES: GlobalSearchDataType[] = ["user", "chat", "message", "task", "location"];

export function useGlobalSearch({
  query,
  type,
  enabled,
  limit = 20,
}: UseGlobalSearchOptions): UseGlobalSearchResult {
  const supabase = useMemo(() => createClient(), []);
  const currentUserId = useAppStore((s) => s.currentUser?.id ?? null);
  const chats = useAppStore((s) => s.chats);
  const messagesByChat = useAppStore((s) => s.messages);
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [migrationMissing, setMigrationMissing] = useState(rpcAvailability === "missing");
  const [usedFallback, setUsedFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setDebouncedQuery("");
      return;
    }
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300);
    return () => window.clearTimeout(timer);
  }, [enabled, query]);

  const runFallback = useCallback(
    async (searchQuery: string, activeType: GlobalSearchDataType | "all", currentRequestId: number) => {
      const local = buildLocalResults({
        query: searchQuery,
        type: activeType,
        currentUserId,
        chats,
        messagesByChat,
        limit,
      });

  const remote = await fetchFallbackRemoteResults({
        supabase,
        query: searchQuery,
        type: activeType,
        currentUserId,
        limit,
      });

      if (requestIdRef.current !== currentRequestId) return;
      setResults(mergeResults([...local, ...remote], limit));
      setUsedFallback(true);
      setMigrationMissing(rpcAvailability === "missing");
      setError(null);
      setLoading(false);
    },
    [chats, currentUserId, limit, messagesByChat, supabase],
  );

  useEffect(() => {
    const searchQuery = normalizeQuery(debouncedQuery);
    const canSearch = enabled && shouldSearch(searchQuery);
    const currentRequestId = requestIdRef.current + 1;
    requestIdRef.current = currentRequestId;

    if (!canSearch) {
      setResults([]);
      setLoading(false);
      setUsedFallback(false);
      setError(null);
      setMigrationMissing(rpcAvailability === "missing");
      return;
    }

    setLoading(true);
    setError(null);

    const activeTypes = type === "all" ? DATA_TYPES : [type];

    if (rpcAvailability === "missing") {
      void runFallback(searchQuery, type, currentRequestId);
      return;
    }

    void (async () => {
      try {
        const { data, error } = await supabase.rpc("global_search", {
          p_query: searchQuery,
          p_limit: limit,
          p_types: type === "all" ? null : activeTypes,
        });
        if (requestIdRef.current !== currentRequestId) return;

        if (error) {
          if (isMissingGlobalSearchError(error)) {
            rpcAvailability = "missing";
            setMigrationMissing(true);
            await runFallback(searchQuery, type, currentRequestId);
            return;
          }
          if (import.meta.env.DEV) console.warn("[global-search] rpc failed", error);
          setError("Поиск по всей истории временно недоступен.");
          await runFallback(searchQuery, type, currentRequestId);
          return;
        }

        rpcAvailability = "available";
        setMigrationMissing(false);
        setUsedFallback(false);
        setResults(
          ((data ?? []) as RpcGlobalSearchRow[])
            .map(mapRpcRow)
            .filter((result) => type === "all" || result.resultType === type)
            .slice(0, limit),
        );
        setLoading(false);
      } catch (error) {
        if (requestIdRef.current !== currentRequestId) return;
        if (import.meta.env.DEV) console.warn("[global-search] request failed", error);
        setError("Поиск временно недоступен.");
        await runFallback(searchQuery, type, currentRequestId);
      }
    })();
  }, [debouncedQuery, enabled, limit, runFallback, supabase, type]);

  return {
    query: debouncedQuery,
    results,
    loading,
    migrationMissing,
    usedFallback,
    error,
  };
}

function mapRpcRow(row: RpcGlobalSearchRow): GlobalSearchResult {
  return {
    resultType: normalizeResultType(row.result_type),
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    snippet: row.snippet,
    avatarUrl: row.avatar_url,
    chatId: row.chat_id,
    messageId: row.message_id,
    taskId: row.task_id,
    locationId: row.location_id,
    createdAt: row.created_at,
    rank: row.rank,
    source: "rpc",
  };
}

function normalizeResultType(value: string): GlobalSearchDataType {
  return DATA_TYPES.includes(value as GlobalSearchDataType) ? (value as GlobalSearchDataType) : "chat";
}

function shouldSearch(query: string): boolean {
  const stripped = query.replace(/^@+/, "").trim();
  return stripped.length >= (query.trim().startsWith("@") ? 1 : 2);
}

function normalizeQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function buildLocalResults({
  query,
  type,
  currentUserId,
  chats,
  messagesByChat,
  limit,
}: {
  query: string;
  type: GlobalSearchDataType | "all";
  currentUserId: string | null;
  chats: ChatWithLastMessage[];
  messagesByChat: Record<string, MessageWithSender[]>;
  limit: number;
}): GlobalSearchResult[] {
  const needle = searchableNeedle(query);
  const includeType = (target: GlobalSearchDataType) => type === "all" || type === target;
  const results: GlobalSearchResult[] = [];

  if (includeType("chat")) {
    results.push(...getLocalChatSearchResults({ query, currentUserId, chats, limit }));
  }

  if (includeType("message")) {
    for (const [chatId, messages] of Object.entries(messagesByChat)) {
      const chat = chats.find((item) => item.id === chatId);
      const info = chat ? getChatDisplayInfo(chat, currentUserId) : null;
      for (const message of messages) {
        if (message.deleted_at || !message.content) continue;
        const senderName = message.sender?.full_name ?? message.sender?.username ?? "";
        const rank = scoreText([message.content, senderName, info?.title].filter(Boolean).join(" "), needle);
        if (rank <= 0) continue;
        results.push({
          resultType: "message",
          id: message.id,
          title: info?.title ?? "Сообщение",
          subtitle: senderName || "Сообщение",
          snippet: message.content,
          avatarUrl: message.sender?.avatar_url ?? null,
          chatId,
          messageId: message.id,
          createdAt: message.created_at,
          rank,
          source: "fallback",
        });
      }
    }
  }

  return results.sort(compareResults).slice(0, limit);
}

export function getLocalChatSearchResults({
  query,
  currentUserId,
  chats,
  limit,
}: {
  query: string;
  currentUserId: string | null;
  chats: ChatWithLastMessage[];
  limit: number;
}): GlobalSearchResult[] {
  const needle = searchableNeedle(query);
  const isHandleQuery = query.trim().startsWith("@");
  const results: GlobalSearchResult[] = [];
  for (const chat of chats) {
    const info = getChatDisplayInfo(chat, currentUserId);
    const username = chat.other_user?.username ? `@${chat.other_user.username}` : "";
    const haystack = [info.title, info.subtitle, chat.description, username, chat.last_message?.content].filter(Boolean).join(" ");
    const rank = scoreText(haystack, needle, isHandleQuery ? username : "");
    if (rank <= 0) continue;
    results.push({
      resultType: "chat",
      id: chat.id,
      title: info.title,
      subtitle: info.subtitle,
      snippet: chat.last_message?.content ?? chat.description ?? null,
      avatarUrl: chat.avatar_url,
      chatId: chat.id,
      createdAt: chat.updated_at,
      rank,
      source: "fallback",
    });
  }
  return results.sort(compareResults).slice(0, limit);
}

async function fetchFallbackRemoteResults({
  supabase,
  query,
  type,
  currentUserId,
  limit,
}: {
  supabase: ReturnType<typeof createClient>;
  query: string;
  type: GlobalSearchDataType | "all";
  currentUserId: string | null;
  limit: number;
}): Promise<GlobalSearchResult[]> {
  const safe = sanitizePostgrestSearch(query);
  if (!safe) return [];
  const isHandleQuery = query.trim().startsWith("@");
  const includeType = (target: GlobalSearchDataType) => type === "all" || type === target;
  const promises: Promise<GlobalSearchResult[]>[] = [];

  if (includeType("user")) {
    promises.push(fetchFallbackUsers(supabase, safe, currentUserId, limit, isHandleQuery));
  }
  if (includeType("task")) {
    promises.push(fetchFallbackTasks(supabase, safe, limit));
  }
  if (includeType("location")) {
    promises.push(fetchFallbackLocations(supabase, safe, limit));
  }

  if (promises.length === 0) return [];
  const settled = await Promise.all(promises);
  return mergeResults(settled.flat(), limit);
}

async function fetchFallbackUsers(
  supabase: ReturnType<typeof createClient>,
  query: string,
  currentUserId: string | null,
  limit: number,
  isHandleQuery: boolean,
): Promise<GlobalSearchResult[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,username,full_name,avatar_url,bio,online_at,role,created_at,updated_at")
    .or(`full_name.ilike.%${query}%,username.ilike.%${query}%`)
    .limit(Math.min(limit, 12));

  if (error) {
    if (import.meta.env.DEV) console.warn("[global-search] fallback profiles failed", error);
    return [];
  }

  return ((data ?? []) as Profile[]).map((profile) => {
    const username = profile.username ? `@${profile.username}` : null;
    return {
      resultType: "user",
      id: profile.id,
      title: profile.full_name?.trim() || username || "Пользователь",
      subtitle: username,
      snippet: profile.id === currentUserId ? "Это вы" : null,
      avatarUrl: profile.avatar_url,
      createdAt: profile.updated_at,
      rank: scoreText([profile.full_name, profile.username].filter(Boolean).join(" "), searchableNeedle(query), isHandleQuery ? profile.username ?? "" : ""),
      source: "fallback",
      profile,
    };
  });
}

async function fetchFallbackTasks(
  supabase: ReturnType<typeof createClient>,
  query: string,
  limit: number,
): Promise<GlobalSearchResult[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("id,title,description,status,due_at,location_id,chat_id,updated_at,deleted_at,location:locations!tasks_location_id_fkey(name)")
    .is("deleted_at", null)
    .or(`title.ilike.%${query}%,description.ilike.%${query}%`)
    .limit(Math.min(limit, 12));

  if (error) {
    if (import.meta.env.DEV) console.warn("[global-search] fallback tasks failed", error);
    return [];
  }

  return ((data ?? []) as unknown as FallbackTaskRow[]).map((task) => ({
    resultType: "task",
    id: task.id,
    title: task.title,
    subtitle: task.location?.name ?? taskStatusLabel(task.status),
    snippet: task.description,
    chatId: task.chat_id,
    taskId: task.id,
    locationId: task.location_id,
    createdAt: task.updated_at,
    rank: scoreText([task.title, task.description].filter(Boolean).join(" "), searchableNeedle(query)),
    source: "fallback",
  }));
}

async function fetchFallbackLocations(
  supabase: ReturnType<typeof createClient>,
  query: string,
  limit: number,
): Promise<GlobalSearchResult[]> {
  const { data, error } = await supabase
    .from("locations")
    .select("id,name,description,address,updated_at")
    .or(`name.ilike.%${query}%,address.ilike.%${query}%,description.ilike.%${query}%`)
    .limit(Math.min(limit, 12));

  if (error) {
    if (import.meta.env.DEV) console.warn("[global-search] fallback locations failed", error);
    return [];
  }

  return ((data ?? []) as FallbackLocationRow[]).map((location) => ({
    resultType: "location",
    id: location.id,
    title: location.name,
    subtitle: location.address ?? "Локация",
    snippet: location.description,
    locationId: location.id,
    createdAt: location.updated_at,
    rank: scoreText([location.name, location.address, location.description].filter(Boolean).join(" "), searchableNeedle(query)),
    source: "fallback",
  }));
}

function sanitizePostgrestSearch(value: string): string {
  return value
    .trim()
    .replace(/^@+/, "")
    .replace(/[,%()]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function searchableNeedle(value: string): string {
  return value.trim().replace(/^@+/, "").toLocaleLowerCase("ru-RU");
}

function scoreText(haystack: string, needle: string, preferred = ""): number {
  const text = haystack.toLocaleLowerCase("ru-RU");
  const target = needle.toLocaleLowerCase("ru-RU");
  const preferredText = preferred.toLocaleLowerCase("ru-RU").replace(/^@+/, "");
  if (!target) return 0;
  if (preferredText && preferredText.startsWith(target)) return 200;
  if (text === target) return 120;
  if (text.startsWith(target)) return 100;
  const index = text.indexOf(target);
  if (index >= 0) return 80 - Math.min(index, 40);
  return 0;
}

function mergeResults(results: GlobalSearchResult[], limit: number): GlobalSearchResult[] {
  const seen = new Set<string>();
  const merged: GlobalSearchResult[] = [];
  for (const result of results.sort(compareResults)) {
    const key = `${result.resultType}:${result.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(result);
    if (merged.length >= limit) break;
  }
  return merged;
}

function compareResults(a: GlobalSearchResult, b: GlobalSearchResult): number {
  const byRank = (b.rank ?? 0) - (a.rank ?? 0);
  if (byRank !== 0) return byRank;
  return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
}

function isMissingGlobalSearchError(error: { code?: string; message?: string; details?: string | null }): boolean {
  const text = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""}`;
  return /global_search|function .* does not exist|Could not find the function|PGRST202|PGRST204/i.test(text);
}

function taskStatusLabel(status: TaskStatus): string {
  switch (status) {
    case "new":
      return "Новая";
    case "assigned":
      return "Назначена";
    case "accepted":
      return "Принята";
    case "in_progress":
      return "В работе";
    case "waiting_confirmation":
      return "На подтверждении";
    case "confirmed":
      return "Подтверждена";
    case "rejected":
      return "Отклонена";
    case "cancelled":
      return "Отменена";
    default:
      return "Задача";
  }
}
