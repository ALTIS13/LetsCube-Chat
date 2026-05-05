"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient, getRealtimeClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import type { Topic } from "@/types/database";

/**
 * Loads and watches the topic list for a forum chat.
 *
 * Auto-selects the first topic (preferring the `is_general = true` one) when
 * topics arrive and none has been chosen yet — that mirrors the Telegram
 * behaviour of dropping into "General" by default when you open a forum.
 *
 * For non-forum chats the hook is a no-op: `topics` stays empty and
 * selectedTopicId stays null, so the rest of the UI behaves like before.
 */
export function useTopics(chatId: string | null, isForum: boolean) {
  const supabase = createClient();
  const rt = getRealtimeClient();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(false);
  const { selectedTopicId, setSelectedTopicId } = useAppStore();

  const fetchTopics = useCallback(async () => {
    if (!chatId || !isForum) { setTopics([]); return; }
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

  // Auto-select the general topic (or first available) once data arrives.
  useEffect(() => {
    if (!isForum || !topics.length) return;
    const stillThere = topics.some((t) => t.id === selectedTopicId);
    if (!stillThere) {
      const general = topics.find((t) => t.is_general) ?? topics[0];
      setSelectedTopicId(general.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topics, isForum]);

  // Realtime: react to topic create / update / delete in this chat.
  // Three separate `.on` calls because supabase-js's typings disallow event="*".
  useEffect(() => {
    if (!chatId || !isForum) return;
    const refetchIfRelevant = (payload: { new?: Partial<Topic>; old?: Partial<Topic> }) => {
      const changed = payload.new ?? payload.old;
      if (changed && changed.chat_id === chatId) fetchTopics();
    };
    const ch = rt.channel(`topics:${chatId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "topics" }, refetchIfRelevant)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "topics" }, refetchIfRelevant)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "topics" }, refetchIfRelevant)
      .subscribe();
    return () => { rt.removeChannel(ch); };
  }, [chatId, isForum, rt, fetchTopics]);

  // ── Mutations ────────────────────────────────────────────────────────────
  const createTopic = useCallback(async (
    name: string,
    emoji: string | null = null,
  ): Promise<Topic | null> => {
    if (!chatId) return null;
    const trimmed = name.trim();
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
        name: name.trim(),
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
