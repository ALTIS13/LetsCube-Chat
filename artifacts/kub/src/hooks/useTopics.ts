"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient, getRealtimeClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import { bumpFetch, registerChannel, unregisterChannel } from "@/lib/dev/instrumentation";
import type { Topic } from "@/types/database";
import { TOPIC_NAME_MAX_LENGTH, limitText } from "@/lib/entityLimits";

/**
 * Loads and watches the topic list for a forum chat.
 *
 * Forum mode keeps `selectedTopicId = null` as the visible "Общие" stream.
 * That pseudo-topic shows legacy/general messages with `messages.topic_id IS NULL`.
 *
 * For non-forum chats the hook is a no-op: `topics` stays empty and
 * selectedTopicId stays null, so the rest of the UI behaves like before.
 */
export function useTopics(chatId: string | null, isForum: boolean) {
  const supabase = useMemo(() => createClient(), []);
  const rt = useMemo(() => getRealtimeClient(), []);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(false);
  const { selectedTopicId, setSelectedTopicId } = useAppStore();

  const fetchTopics = useCallback(async () => {
    if (!chatId || !isForum) { setTopics([]); return; }
    bumpFetch("useTopics");
    setLoading(true);
    const { data } = await supabase
      .from("topics")
      .select("*")
      .eq("chat_id", chatId)
      .eq("archived", false)
      .order("is_general", { ascending: false }) // general first
      .order("position", { ascending: true });
    setTopics((data ?? []) as Topic[]);
    setLoading(false);
  }, [chatId, isForum, supabase]);

  // Initial load + when chat changes.
  useEffect(() => { fetchTopics(); }, [fetchTopics]);

  // Keep legacy/general messages visible by default. If the selected topic was
  // removed, fall back to the pseudo-topic "Общие" (`selectedTopicId = null`).
  useEffect(() => {
    if (!isForum) {
      if (selectedTopicId !== null) setSelectedTopicId(null);
      return;
    }
    const selectedTopic = selectedTopicId ? topics.find((t) => t.id === selectedTopicId) : null;
    if (selectedTopic?.is_general || (selectedTopicId && !selectedTopic)) {
      setSelectedTopicId(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topics, isForum, selectedTopicId]);

  // Realtime: react to topic create / update / delete in this chat.
  // Three separate `.on` calls because supabase-js's typings disallow event="*".
  useEffect(() => {
    if (!chatId || !isForum) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debouncedFetch = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void fetchTopics();
      }, 250);
    };
    const refetchIfRelevant = (payload: { new?: Partial<Topic>; old?: Partial<Topic> }) => {
      const changed = payload.new ?? payload.old;
      if (changed && changed.chat_id === chatId) debouncedFetch();
    };
    const channelName = `topics:${chatId}`;
    const filter = `chat_id=eq.${chatId}`;
    const ch = rt.channel(channelName)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "topics", filter }, refetchIfRelevant)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "topics", filter }, refetchIfRelevant)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "topics", filter }, refetchIfRelevant)
      .subscribe();
    registerChannel(channelName);
    return () => {
      if (timer) clearTimeout(timer);
      rt.removeChannel(ch);
      unregisterChannel(channelName);
    };
  }, [chatId, isForum, rt, fetchTopics]);

  // ── Mutations ────────────────────────────────────────────────────────────
  const createTopic = useCallback(async (
    name: string,
    emoji: string | null = null,
  ): Promise<Topic | null> => {
    if (!chatId) return null;
    const trimmed = limitText(name.trim(), TOPIC_NAME_MAX_LENGTH);
    if (!trimmed) return null;
    const { data, error } = await supabase
      .from("topics")
      .insert({ chat_id: chatId, name: trimmed, emoji })
      .select("*")
      .single();
    if (error) { console.error("createTopic:", error); return null; }
    return data as Topic;
  }, [chatId, supabase]);

  const renameTopic = useCallback(async (id: string, name: string, emoji?: string | null) => {
    const { error } = await supabase
      .from("topics")
      .update({
        name: limitText(name.trim(), TOPIC_NAME_MAX_LENGTH),
        emoji: emoji ?? undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) console.error("renameTopic:", error);
  }, [supabase]);

  const archiveTopic = useCallback(async (id: string) => {
    const { error } = await supabase
      .from("topics")
      .update({ archived: true, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) console.error("archiveTopic:", error);
  }, [supabase]);

  return { topics, loading, createTopic, renameTopic, archiveTopic, refetch: fetchTopics };
}
