"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { createClient, getRealtimeClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import { bumpFetch, registerChannel, unregisterChannel } from "@/lib/dev/instrumentation";
import type { Topic } from "@/types/database";
import { TOPIC_NAME_MAX_LENGTH, limitText } from "@/lib/entityLimits";
import { CHANNEL_RAIL_UNREADABLE } from "@/lib/channelRail";
import { mapPgError } from "@/lib/errors";
import {
  heldListCleared,
  heldListPending,
  heldListRefused,
  heldListStarted,
  heldListSucceeded,
  listReadView,
  type HeldList,
} from "@/lib/listReadState";
import { plainFailure } from "@/lib/plainMessages";

/**
 * Loads and watches a forum's topics or a group's text channels.
 *
 * Forum mode keeps `selectedTopicId = null` as the visible "Общие" stream.
 * That pseudo-topic shows legacy/general messages with `messages.topic_id IS NULL`.
 *
 * A group can have text channels even when `is_forum` is false. Chats that
 * are neither groups nor forums have no topic navigation.
 *
 * **A refused read is not a forum with no channels** (F-6). This hook read
 * `const { data } = await …` and wrote `data ?? []`, so a chat whose `topics`
 * read was refused — which the restrictive «block banned» policy on that table
 * does silently, with no error at all, and a missing grant does loudly — drew
 * itself as an ordinary conversation: no strip, no rail, nothing anywhere
 * saying a channel list existed. The read's answer is now carried out of here,
 * and `ChatWindow` folds it into the rail's own `failed`, which has said this
 * for the rooms since 2026-09-14.
 */

/**
 * The channels each reader was last given for each chat, this session (D-320).
 *
 * Every chat the chat window was given — reopened after none, or switched to
 * from another — started with its scope unknown: the conversation was read
 * once for the unknown scope and again when this hook's read answered, and
 * the conversation's channel was joined twice with it. Starting from the last
 * answer, a chat seen before knows its scope at once and draws the
 * conversation from the store; the read still runs, in the background, and
 * replaces it. Keyed by reader as well as by chat, so another account never
 * starts from what this one was shown, and forgotten when a read is refused.
 */
const lastTopicReads = new Map<string, readonly Topic[]>();

function topicReadKey(chatId: string): string {
  return `${useAppStore.getState().currentUser?.id ?? ""}:${chatId}`;
}

export function useTopics(chatId: string | null, hasTopicNavigation: boolean) {
  const supabase = useMemo(() => createClient(), []);
  const rt = useMemo(() => getRealtimeClient(), []);
  const [ownRead, setRead] = useState<HeldList<Topic>>(() => heldListPending<Topic>());
  // This hook's own answer once it has one for this chat; until then, the
  // last one this session had for it. The window is not remounted between
  // chats, so this is decided on every render rather than once at mount.
  const lastRead = chatId && hasTopicNavigation ? lastTopicReads.get(topicReadKey(chatId)) : undefined;
  const read = useMemo(
    () => (ownRead.subject === chatId || !lastRead ? ownRead : heldListSucceeded(lastRead, chatId)),
    [chatId, lastRead, ownRead],
  );
  const readRef = useRef(read);
  readRef.current = read;
  const topics = useMemo(() => read.rows.filter((topic) => !topic.archived), [read.rows]);
  // Two slices, not the store. A selector-less read subscribes the chat window
  // that calls this hook to every change anywhere in the store, so every
  // message, receipt and read in the chat list rendered the open conversation
  // (D-088).
  const selectedTopicId = useAppStore((s) => s.selectedTopicId);
  const setSelectedTopicId = useAppStore((s) => s.setSelectedTopicId);

  const fetchTopics = useCallback(async (options: { background?: boolean } = {}) => {
    // No topic navigation, or no chat open: there is nothing here to read, which is a
    // different fact from a read that failed and must not be told as one.
    if (!chatId || !hasTopicNavigation) { setRead(heldListCleared<Topic>()); return; }
    bumpFetch("useTopics");
    const background = options.background === true;
    setRead((previous) => heldListStarted(previous, { background }));
    const { data, error } = await supabase
      .from("topics")
      .select("*")
      .eq("chat_id", chatId)
      .order("is_general", { ascending: false }) // general first
      .order("position", { ascending: true });
    if (error) {
      // The read said nothing about this chat's channels, so the channels are
      // left exactly as they were and the surface is told the answer is old.
      // What the mapper made of it goes to the log, where somebody who can act
      // on a policy name reads it; the screen gets the product's sentence.
      if (import.meta.env.DEV) console.error("[useTopics] read refused", error);
      lastTopicReads.delete(topicReadKey(chatId));
      setRead((previous) =>
        heldListRefused(previous, {
          subject: chatId,
          message: plainFailure(mapPgError(error), CHANNEL_RAIL_UNREADABLE),
        }),
      );
      return;
    }
    const rows = (data ?? []) as Topic[];
    lastTopicReads.set(topicReadKey(chatId), rows);
    setRead(heldListSucceeded(rows, chatId));
  }, [chatId, hasTopicNavigation, supabase]);

  // Initial load + when chat changes. Where what is held already answers this
  // chat — the last answer, above — the read is a refresh and blanks nothing.
  useEffect(() => {
    const held = readRef.current;
    void fetchTopics({ background: held.loadedOnce && held.subject === chatId });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchTopics]);

  // Keep legacy/general messages visible by default. If the selected topic was
  // removed, fall back to the pseudo-topic "Общие" (`selectedTopicId = null`).
  useEffect(() => {
    if (!hasTopicNavigation) {
      if (selectedTopicId !== null) setSelectedTopicId(null);
      return;
    }
    const selectedTopic = selectedTopicId ? topics.find((t) => t.id === selectedTopicId) : null;
    if (selectedTopic?.is_general || (selectedTopicId && !selectedTopic)) {
      setSelectedTopicId(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topics, hasTopicNavigation, selectedTopicId]);

  // Realtime: react to topic create / update / delete in this chat.
  // Three separate `.on` calls because supabase-js's typings disallow event="*".
  useEffect(() => {
    if (!chatId || !hasTopicNavigation) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debouncedFetch = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        // A notification, not somebody asking: it may not blank what is there.
        void fetchTopics({ background: true });
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
  }, [chatId, hasTopicNavigation, rt, fetchTopics]);

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

  return {
    topics,
    /** An archived text channel still owns its retained messages. */
    hasTextChannelHistory: read.subject === chatId && read.rows.some((topic) => !topic.is_general),
    /** A successful, current read is required before an ordinary group may use the unscoped legacy stream. */
    scopeKnown: read.loadedOnce && read.subject === chatId && !read.error,
    loading: read.loading,
    /** The refused read's sentence, or null. Already in a person's words. */
    error: read.error,
    /** `loading | unavailable | stale | ready` — see `lib/listReadState.ts`. */
    view: listReadView(read),
    createTopic,
    renameTopic,
    archiveTopic,
    refetch: fetchTopics,
  };
}
