"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { createClient, getRealtimeClient } from "@/lib/supabase/client";
import type { Json, MessageWithSender, Profile } from "@/types/database";
import { useAppStore } from "@/store/app.store";
import { bumpFetch, registerChannel, unregisterChannel } from "@/lib/dev/instrumentation";
import { mapPgError } from "@/lib/errors";
import { reportError } from "@/lib/monitoring";
import { dispatchChatsRefresh, KUB_CHATS_REFRESH_EVENT, type ChatsRefreshDetail } from "@/lib/chatEvents";
import { isSavedChat } from "@/lib/chatDisplay";
import { scheduleMarkChatDelivered, scheduleMarkChatRead } from "@/lib/deliveryReceipts";
import {
  createMessageSendTimeoutContext,
  getMessageAckUserMessage,
  sanitizeMessageAckError,
} from "@/lib/messageAckError";
import { FORWARD_RPC, forwardInsertPayload, forwardRpcArgs, type ForwardMessageResult } from "@/lib/messageForward";
import { MESSAGE_SELECT_WITH_JOINS } from "@/lib/messageProjection";
import { SET_REACTION_RPC, applyReactionPlan, parseReactionRows, planReactionToggle } from "@/lib/messageReactions";
import { rememberReactionUse } from "@/lib/recentReactions";
import { attachKnownSender } from "@/lib/realtimeMessage";
import { applyProfileToChats } from "@/lib/chatProfilePatch";
import {
  createResumeRevalidationGate,
  RESUME_REVALIDATE_AFTER_HIDDEN_MS,
  RESUME_REVALIDATE_MIN_INTERVAL_MS,
} from "@/lib/resumeRevalidation";
import { canUseHumanMessageControls, isIncomingMessage } from "@/lib/messageActor";
import { mergeMessagesById } from "@/lib/messageMerge";
import { isMissingRpcError, rpcAvailability } from "@/lib/rpcAvailability";
import {
  DELETE_FOR_EVERYONE_RPC,
  deletionBatches,
  keepsDeletedPlaceholder,
  markMessagesDeleted,
  parseDeletedIds,
  splitForPreviousDeletion,
} from "@/lib/deletedMessages";

const MESSAGE_PAGE_SIZE = 100;
const SEND_ACK_TIMEOUT_MS = 12_000;

type SendableMessageType = Extract<MessageWithSender["type"], "text" | "image" | "video" | "audio" | "file">;

type FetchMessagesOptions = {
  background?: boolean;
  /**
   * Show the loading state although messages are cached, because the cache is
   * known to lack what the reader has to land on: the chat has unread messages
   * that arrived while it was closed. Placing the reader from the cache put them
   * at the bottom, past the first unread message, before the fetch landed.
   */
  cacheIsStale?: boolean;
};

const ACTIVE_CHAT_RECONCILE_DELAY_MS = 600;
const ACTIVE_CHAT_RECONNECT_DELAY_MS = 900;
/**
 * How long a reopened chat waits for its channel before revalidating anyway.
 * The channel normally answers in well under a second; this is for a Realtime
 * that does not answer at all.
 */
const REOPENED_CHAT_REVALIDATE_FALLBACK_MS = 2_500;

/** One empty list for every chat without messages, so a selector for one returns the same value. */
const EMPTY_MESSAGES: MessageWithSender[] = [];

/**
 * The chats (and topics) whose messages a full fetch has brought into the store
 * during this session. Reopening one renders from the store at once.
 */
const fetchedMessageScopes = new Set<string>();

/** In-flight `cleared_at` reads, so the message and pinned fetches of one chat share one request. */
const clearedAtRequests = new Map<string, Promise<string | null>>();
/** `cleared_at` reads answered a moment ago. */
const clearedAtAnswers = new Map<string, { value: string | null; at: number }>();
/**
 * How long an answer is reused. A reopened chat reads the mark for its pinned
 * messages as it opens, and read it again for its history when the channel
 * joined, well under a second later. Nothing delivers a change to the mark to
 * this hook in between, so the second read only repeated the first. Clearing
 * the history here forgets the answer.
 */
const CLEARED_AT_REUSE_MS = 3_000;

function loadClearedAt(
  supabase: ReturnType<typeof createClient>,
  chatId: string,
  userId: string,
): Promise<string | null> {
  const key = `${chatId}:${userId}`;
  const pending = clearedAtRequests.get(key);
  if (pending) return pending;
  const answer = clearedAtAnswers.get(key);
  if (answer && Date.now() - answer.at < CLEARED_AT_REUSE_MS) return Promise.resolve(answer.value);
  const request = (async () => {
    const { data: membership, error } = await supabase
      .from("chat_members")
      .select("cleared_at")
      .eq("chat_id", chatId)
      .eq("user_id", userId)
      .maybeSingle();
    const value = membership?.cleared_at ?? null;
    if (!error) clearedAtAnswers.set(key, { value, at: Date.now() });
    return value;
  })().finally(() => {
    clearedAtRequests.delete(key);
  });
  clearedAtRequests.set(key, request);
  return request;
}

function forgetClearedAt(chatId: string) {
  for (const key of Array.from(clearedAtAnswers.keys())) {
    if (key.startsWith(`${chatId}:`)) clearedAtAnswers.delete(key);
  }
}

interface SendMessageInput {
  type: SendableMessageType;
  content: string | null;
  mediaBucket?: string | null;
  mediaPath?: string | null;
  mediaUrl?: string | null;
  replyToId?: string | null;
  forwardedFromId?: string | null;
  topicId?: string | null;
  targetChatId?: string;
  clientMessageId?: string | null;
  clientSentAt?: string | null;
  mediaMetadata?: Json | null;
  tempId?: string;
}

interface SendMessageAck {
  data: MessageWithSender | null;
  error: unknown;
  timedOut: boolean;
}

type TimeoutResult = { timedOut: true };

type EnsureMessageLoadedResult =
  | { ok: true; message: MessageWithSender }
  | { ok: false; reason: "not-found" | "hidden" | "deleted" | "cleared" | "topic" };

export function useMessages(
  chatId: string | null,
  topicId: string | null | undefined = undefined,
  generalTopicIds: string[] = [],
) {
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState<MessageWithSender[]>([]);
  const [pinnedReady, setPinnedReady] = useState(false);
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const [clearedAt, setClearedAt] = useState<string | null>(null);
  const [hiddenMessageIds, setHiddenMessageIds] = useState<Set<string>>(() => new Set());
  // Per-slice selectors: не подписываемся на весь store (раньше любая
  // мутация — chats, selectedChatId — ререндерила хук). Сами
  // setMessages/addMessage/replaceMessage в zustand стабильны по ссылке.
  // NB: removeMessage intentionally not used — soft-deletes keep the row
  // in store so the bubble can render a "сообщение удалено" placeholder.
  //
  // Only this chat's messages: a store holding every chat's history used to
  // render this hook, and the conversation with it, for a change to any chat.
  const chatMessages = useAppStore((s) => (chatId ? s.messages[chatId] : undefined) ?? EMPTY_MESSAGES);
  const setMessages = useAppStore((s) => s.setMessages);
  const addMessage = useAppStore((s) => s.addMessage);
  const replaceMessage = useAppStore((s) => s.replaceMessage);
  const removeMessage = useAppStore((s) => s.removeMessage);
  const updateChat = useAppStore((s) => s.updateChat);
  const updateChatLastMessage = useAppStore((s) => s.updateChatLastMessage);
  const currentUser = useAppStore((s) => s.currentUser);
  const userId = currentUser?.id ?? null;

  const supabase = createClient(); // REST-операции
  const rt = getRealtimeClient();  // WebSocket каналы

  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingChannelRef = useRef<ReturnType<typeof rt.channel> | null>(null);

  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;
  const chatIdRef = useRef(chatId);
  useEffect(() => { chatIdRef.current = chatId; }, [chatId]);
  const clearedAtRef = useRef(clearedAt);
  useEffect(() => { clearedAtRef.current = clearedAt; }, [clearedAt]);
  const hiddenMessageIdsRef = useRef(hiddenMessageIds);
  useEffect(() => { hiddenMessageIdsRef.current = hiddenMessageIds; }, [hiddenMessageIds]);
  const loadingOlderRef = useRef(loadingOlder);
  useEffect(() => { loadingOlderRef.current = loadingOlder; }, [loadingOlder]);
  const hasMoreOlderRef = useRef(hasMoreOlder);
  useEffect(() => { hasMoreOlderRef.current = hasMoreOlder; }, [hasMoreOlder]);
  // topicId is passed into INSERTs and used to filter the realtime stream so
  // we only show messages from the active topic in forum chats. Undefined
  // means "topics disabled": show the whole chat without topic scoping.
  const topicIdRef = useRef(topicId);
  useEffect(() => { topicIdRef.current = topicId; }, [topicId]);
  const generalTopicIdsRef = useRef(generalTopicIds);
  useEffect(() => { generalTopicIdsRef.current = generalTopicIds; }, [generalTopicIds]);
  /** The chat whose message channel has joined, so a reopened chat knows its revalidation is on the way. */
  const subscribedChatIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Each of these is a render of the conversation when it changes value, so
    // one that already holds its reset value is left alone.
    setPinnedMessages((current) => (current.length ? [] : current));
    setPinnedReady(false);
    setPinnedKey(null);
    setClearedAt(null);
    setLoadingOlder(false);
    setHasMoreOlder(false);
    setOlderError(null);
    setIsTyping(false);
    if (typingTimer.current) {
      clearTimeout(typingTimer.current);
      typingTimer.current = null;
    }
  }, [chatId, topicId]);

  useEffect(() => {
    setHiddenMessageIds((current) => (current.size ? new Set() : current));
  }, [chatId]);

  const rememberHiddenMessageIds = useCallback((ids: Iterable<string>) => {
    const incoming = Array.from(ids).filter(Boolean);
    if (!incoming.length) return;
    setHiddenMessageIds((current) => {
      const next = new Set(current);
      let changed = false;
      for (const id of incoming) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, []);

  const shouldMarkDeliveredForPrivateChat = useCallback((targetChatId: string, targetUserId: string) => {
    const chat = useAppStore.getState().chats.find((item) => item.id === targetChatId);
    return Boolean(chat && chat.type === "private" && !isSavedChat(chat, targetUserId));
  }, []);

  const fetchMessages = useCallback(async (options: FetchMessagesOptions = {}) => {
    if (!chatId) return;
    const background = options.background === true;
    const hasCachedMessages = (useAppStore.getState().messages[chatId] ?? []).some((message) =>
      messageBelongsToTopic(message, topicId, generalTopicIds)
    );
    bumpFetch("useMessages");
    if (!background) setLoading(options.cacheIsStale === true || !hasCachedMessages);
    try {
      let localClearedAt: string | null = null;
      const user = currentUserRef.current;
      if (user) {
        localClearedAt = await loadClearedAt(supabase, chatId, user.id);
        setClearedAt(localClearedAt);
      }
      // A group keeps soft-deleted rows in its timeline, so MessageBubble can
      // render «Сообщение удалено» in the slot they occupied and nothing shifts
      // when a message is removed. A private chat draws none — delete for both
      // leaves no trace (lib/deletedMessages.ts) — so it does not fetch them
      // either: a page of a hundred rows that were nearly all deleted drew two
      // messages that could not scroll, and older history was never asked for.
      // Measured on production on 2026-09-11, 98 of a chat's latest 100 (D-108).
      // The kind of chat is read from the store; before the list has loaded it
      // is unknown, and the page comes as it always did.
      let query = supabase
        .from("messages")
        .select(MESSAGE_SELECT_WITH_JOINS)
        .eq("chat_id", chatId);
      if (!keepsDeletedPlaceholder(useAppStore.getState().chats.find((item) => item.id === chatId)?.type)) {
        query = query.is("deleted_at", null);
      }
      // Forum chats: scope to the selected topic.  Non-forum: all messages
      // have topic_id = null, so the filter is a no-op when topicId is null.
      if (topicId !== undefined) {
        if (topicId) query = query.eq("topic_id", topicId);
        else query = applyGeneralTopicFilter(query, generalTopicIds);
      }
      if (localClearedAt) query = query.gt("created_at", localClearedAt);
      const { data, error } = await query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(MESSAGE_PAGE_SIZE + 1);
      if (error) {
        console.error("Messages fetch error:", error);
        return;
      }
      if (data) {
        const rawFetched = data as unknown as MessageWithSender[];
        const fetched = rawFetched.slice(0, MESSAGE_PAGE_SIZE).reverse();
        const nextHasMoreOlder = rawFetched.length > MESSAGE_PAGE_SIZE;
        hasMoreOlderRef.current = nextHasMoreOlder;
        setHasMoreOlder(nextHasMoreOlder);
        setOlderError(null);
        const fetchedHiddenIds = await fetchHiddenMessageIdSet(supabase, getMessageAndReplyIds(fetched));
        rememberHiddenMessageIds(fetchedHiddenIds);
        const effectiveHiddenIds = new Set([...hiddenMessageIdsRef.current, ...fetchedHiddenIds]);
        const visibleFetched = sanitizeHiddenReplies(
          fetched.filter((message) => !effectiveHiddenIds.has(message.id)),
          effectiveHiddenIds,
        );
        const existing = useAppStore.getState().messages[chatId] ?? [];
        const visibleExisting = sanitizeHiddenReplies(existing.filter((message) => {
          if (effectiveHiddenIds.has(message.id)) return false;
          if (!messageBelongsToTopic(message, topicId, generalTopicIds)) return false;
          if (!localClearedAt) return true;
          return new Date(message.created_at).getTime() > new Date(localClearedAt).getTime();
        }), effectiveHiddenIds);
        setMessages(chatId, mergeMessagesById(visibleFetched, visibleExisting));
        fetchedMessageScopes.add(getPinnedKey(chatId, topicId));
        if (user) {
          const latestVisible = visibleFetched[visibleFetched.length - 1] ?? visibleExisting[visibleExisting.length - 1] ?? null;
          const latestIncoming = [...visibleFetched].reverse().find((message) =>
            !message.deleted_at && isIncomingMessage(message, user.id)
          );
          if (latestVisible && document.visibilityState === "visible") {
            scheduleMarkChatRead(supabase, chatId, latestVisible.created_at);
          } else if (latestIncoming && shouldMarkDeliveredForPrivateChat(chatId, user.id)) {
            scheduleMarkChatDelivered(supabase, chatId, latestIncoming.created_at);
          }
        }
      }
    } catch (error) {
      console.error("Messages fetch error:", error);
      reportError(error, { category: "messages_fetch_failed", chatId, background });
    } finally {
      if (!background) setLoading(false);
    }
  }, [chatId, topicId, generalTopicIds, supabase, setMessages, rememberHiddenMessageIds, shouldMarkDeliveredForPrivateChat]);

  // Opening a chat. One this session has already fetched renders from the
  // store and is revalidated once, when its channel has joined (the handler
  // below): fetching here as well brought the same history down twice, and a
  // fetch that lands before the join cannot see what arrives in between anyway.
  // A chat opened for the first time has nothing to show, so it fetches now and
  // is reconciled again once the channel is live (D-089).
  useEffect(() => {
    if (!chatId) return;
    const scope = getPinnedKey(chatId, topicId);
    const cached = (useAppStore.getState().messages[chatId] ?? []).some((message) =>
      messageBelongsToTopic(message, topicId, generalTopicIds)
    );
    // Messages that arrived while the chat was closed are not in the store, and
    // the reader has to land on the first of them (CLAUDE.md section 11). This
    // effect runs before the chat window zeroes the count, so the count still
    // says whether there are any.
    const unreadWhileClosed = (useAppStore.getState().chats.find((item) => item.id === chatId)?.unread_count ?? 0) > 0;
    if (fetchedMessageScopes.has(scope) && cached && !unreadWhileClosed) {
      setLoading(false);
      if (subscribedChatIdRef.current === chatId) {
        // Same chat, channel already live: a topic switch, or new general topic ids.
        void fetchMessages({ background: true });
        return undefined;
      }
      const fallback = window.setTimeout(() => {
        if (chatIdRef.current === chatId && subscribedChatIdRef.current !== chatId) {
          void fetchMessages({ background: true });
        }
      }, REOPENED_CHAT_REVALIDATE_FALLBACK_MS);
      return () => window.clearTimeout(fallback);
    }
    void fetchMessages({ cacheIsStale: cached && unreadWhileClosed });
    return undefined;
  }, [fetchMessages]);

  const refreshMessageById = useCallback(async (messageId: string) => {
    const activeChatId = chatIdRef.current;
    if (!activeChatId) return;
    const current = useAppStore.getState().messages[activeChatId] ?? [];
    if (!current.some((message) => message.id === messageId)) return;

    const { data } = await supabase
      .from("messages")
      .select(MESSAGE_SELECT_WITH_JOINS)
      .eq("id", messageId)
      .single();
    if (!data) return;

    const nextMessage = data as MessageWithSender;
    if (nextMessage.chat_id !== activeChatId) return;
    if (
      topicIdRef.current !== undefined &&
      !messageBelongsToTopic(nextMessage, topicIdRef.current, generalTopicIdsRef.current)
    ) return;
    const localClearedAt = clearedAtRef.current;
    if (localClearedAt && new Date(nextMessage.created_at).getTime() <= new Date(localClearedAt).getTime()) return;

    const fetchedHiddenIds = await fetchHiddenMessageIdSet(supabase, getMessageAndReplyIds([nextMessage]));
    rememberHiddenMessageIds(fetchedHiddenIds);
    const effectiveHiddenIds = new Set([...hiddenMessageIdsRef.current, ...fetchedHiddenIds]);
    if (effectiveHiddenIds.has(nextMessage.id)) return;
    const [visibleMessage] = sanitizeHiddenReplies([nextMessage], effectiveHiddenIds);
    if (!visibleMessage) return;

    setMessages(activeChatId, current.map((message) => (
      message.id === messageId ? visibleMessage : message
    )));
  }, [rememberHiddenMessageIds, setMessages, supabase]);

  const loadOlderMessages = useCallback(async () => {
    const activeChatId = chatIdRef.current;
    if (!activeChatId || loadingOlderRef.current || !hasMoreOlderRef.current) return { loaded: 0 };
    const activeTopicId = topicIdRef.current;
    const activeGeneralTopicIds = generalTopicIdsRef.current;
    const localClearedAt = clearedAtRef.current;
    const hiddenIds = hiddenMessageIdsRef.current;
    const currentMessages = useAppStore.getState().messages[activeChatId] ?? [];
    const visibleCurrent = currentMessages.filter((message) => {
      if (hiddenIds.has(message.id)) return false;
      if (!messageBelongsToTopic(message, activeTopicId, activeGeneralTopicIds)) return false;
      if (!localClearedAt) return true;
      return new Date(message.created_at).getTime() > new Date(localClearedAt).getTime();
    });
    const oldest = visibleCurrent[0];
    if (!oldest) {
      hasMoreOlderRef.current = false;
      setHasMoreOlder(false);
      return { loaded: 0 };
    }

    loadingOlderRef.current = true;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      let query = supabase
        .from("messages")
        .select(MESSAGE_SELECT_WITH_JOINS)
        .eq("chat_id", activeChatId);
      // The rule of the first page: a private chat's pages hold what it draws.
      if (!keepsDeletedPlaceholder(useAppStore.getState().chats.find((item) => item.id === activeChatId)?.type)) {
        query = query.is("deleted_at", null);
      }
      if (activeTopicId !== undefined) {
        if (activeTopicId) query = query.eq("topic_id", activeTopicId);
        else query = applyGeneralTopicFilter(query, activeGeneralTopicIds);
      }
      if (localClearedAt) query = query.gt("created_at", localClearedAt);

      const { data, error } = await query
        .lt("created_at", oldest.created_at)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(MESSAGE_PAGE_SIZE + 1);

      if (error) throw error;
      const rawFetched = (data ?? []) as unknown as MessageWithSender[];
      if (chatIdRef.current !== activeChatId || topicIdRef.current !== activeTopicId) return { loaded: 0 };
      const fetched = rawFetched.slice(0, MESSAGE_PAGE_SIZE).reverse();
      const nextHasMoreOlder = rawFetched.length > MESSAGE_PAGE_SIZE;
      hasMoreOlderRef.current = nextHasMoreOlder;
      setHasMoreOlder(nextHasMoreOlder);
      if (!fetched.length) return { loaded: 0 };

      const fetchedHiddenIds = await fetchHiddenMessageIdSet(supabase, getMessageAndReplyIds(fetched));
      rememberHiddenMessageIds(fetchedHiddenIds);
      const effectiveHiddenIds = new Set([...hiddenMessageIdsRef.current, ...fetchedHiddenIds]);
      const visibleFetched = sanitizeHiddenReplies(fetched.filter((message) => {
        if (effectiveHiddenIds.has(message.id)) return false;
        if (!messageBelongsToTopic(message, activeTopicId, activeGeneralTopicIds)) return false;
        if (!localClearedAt) return true;
        return new Date(message.created_at).getTime() > new Date(localClearedAt).getTime();
      }), effectiveHiddenIds);
      const existing = useAppStore.getState().messages[activeChatId] ?? [];
      const visibleExisting = sanitizeHiddenReplies(existing.filter((message) => {
        if (effectiveHiddenIds.has(message.id)) return false;
        if (!messageBelongsToTopic(message, activeTopicId, activeGeneralTopicIds)) return false;
        if (!localClearedAt) return true;
        return new Date(message.created_at).getTime() > new Date(localClearedAt).getTime();
      }), effectiveHiddenIds);
      setMessages(activeChatId, mergeMessagesById(visibleFetched, visibleExisting));
      return { loaded: visibleFetched.length };
    } catch (error) {
      console.error("Older messages fetch error:", error);
      setOlderError("Не удалось загрузить более ранние сообщения.");
      return { loaded: 0 };
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [rememberHiddenMessageIds, setMessages, supabase]);

  const fetchMessageById = useCallback(async (messageId: string): Promise<EnsureMessageLoadedResult> => {
    const activeChatId = chatIdRef.current;
    if (!activeChatId) return { ok: false, reason: "not-found" };
    const { data } = await supabase
      .from("messages")
      .select(MESSAGE_SELECT_WITH_JOINS)
      .eq("id", messageId)
      .eq("chat_id", activeChatId)
      .maybeSingle();
    if (!data) return { ok: false, reason: "not-found" };
    const message = data as unknown as MessageWithSender;
    const hiddenIds = await fetchHiddenMessageIdSet(supabase, [message.id, message.reply_to_id].filter(Boolean) as string[]);
    if (hiddenIds.has(message.id)) {
      rememberHiddenMessageIds(hiddenIds);
      return { ok: false, reason: "hidden" };
    }
    if (hiddenIds.size) rememberHiddenMessageIds(hiddenIds);
    if (message.deleted_at) {
      return { ok: false, reason: "deleted" };
    }
    const localClearedAt = clearedAtRef.current;
    if (localClearedAt && new Date(message.created_at).getTime() <= new Date(localClearedAt).getTime()) {
      return { ok: false, reason: "cleared" };
    }
    if (!messageBelongsToTopic(message, topicIdRef.current, generalTopicIdsRef.current)) {
      return { ok: false, reason: "topic" };
    }
    const visibleMessage = sanitizeHiddenReply(message, hiddenIds);
    addMessage(activeChatId, visibleMessage);
    return { ok: true, message: visibleMessage };
  }, [addMessage, rememberHiddenMessageIds, supabase]);

  const fetchMessageByClientId = useCallback(async (
    targetChatId: string,
    targetUserId: string,
    clientMessageId: string,
  ): Promise<MessageWithSender | null> => {
    const { data } = await supabase
      .from("messages")
      .select(MESSAGE_SELECT_WITH_JOINS)
      .eq("chat_id", targetChatId)
      .eq("user_id", targetUserId)
      .eq("client_message_id", clientMessageId)
      .maybeSingle();
    return data ? data as unknown as MessageWithSender : null;
  }, [supabase]);

  useEffect(() => {
    if (!chatId) return;
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleReconcile = (delay = ACTIVE_CHAT_RECONCILE_DELAY_MS) => {
      if (reconcileTimer) clearTimeout(reconcileTimer);
      reconcileTimer = setTimeout(() => {
        reconcileTimer = null;
        if (!chatIdRef.current) return;
        void fetchMessages({ background: true });
      }, delay);
    };
    const handleRefresh = (event: Event) => {
      const detail = (event as CustomEvent<ChatsRefreshDetail>).detail;
      if (detail?.reason !== "message-realtime" || detail.chatId !== chatIdRef.current) return;
      if (!detail.messageId) {
        scheduleReconcile();
        return;
      }
      if (timers.has(detail.messageId)) return;
      const timer = setTimeout(() => {
        timers.delete(detail.messageId!);
        const current = useAppStore.getState().messages[chatIdRef.current ?? ""] ?? [];
        if (current.some((message) => message.id === detail.messageId)) return;
        void fetchMessageById(detail.messageId!).then((result) => {
          if (!result.ok && result.reason === "not-found") scheduleReconcile(ACTIVE_CHAT_RECONNECT_DELAY_MS);
        });
      }, 900);
      timers.set(detail.messageId, timer);
    };
    window.addEventListener(KUB_CHATS_REFRESH_EVENT, handleRefresh);
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      if (reconcileTimer) clearTimeout(reconcileTimer);
      window.removeEventListener(KUB_CHATS_REFRESH_EVENT, handleRefresh);
    };
  }, [chatId, fetchMessageById, fetchMessages]);

  // Coming back. Back online always reconciles — that is a real reconnect, and
  // it is one handler now rather than two timers fetching the same history. A
  // visibility change reconciles only after the page was away long enough for
  // its socket to have been suspended; a socket that dropped reports
  // `SUBSCRIBED` again when it rejoins, and that reconciles on its own.
  useEffect(() => {
    if (!chatId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const gate = createResumeRevalidationGate({
      minHiddenMs: RESUME_REVALIDATE_AFTER_HIDDEN_MS,
      minIntervalMs: RESUME_REVALIDATE_MIN_INTERVAL_MS,
    });
    if (document.visibilityState === "hidden") gate.hidden();
    const scheduleReconcile = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (!chatIdRef.current) return;
        void fetchMessages({ background: true });
      }, ACTIVE_CHAT_RECONNECT_DELAY_MS);
    };
    const handleOnline = () => {
      if (gate.online()) scheduleReconcile();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        gate.hidden();
        return;
      }
      if (gate.visible()) scheduleReconcile();
    };
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [chatId, fetchMessages]);

  const fetchPinnedMessages = useCallback(async () => {
    if (!chatId) {
      setPinnedMessages([]);
      setPinnedReady(true);
      setPinnedKey(null);
      return;
    }
    setPinnedReady(false);
    const fetchKey = getPinnedKey(chatId, topicId);
    let localClearedAt = clearedAtRef.current;
    const user = currentUserRef.current;
    if (user) {
      localClearedAt = await loadClearedAt(supabase, chatId, user.id);
      setClearedAt(localClearedAt);
    }
    let query = supabase
      .from("messages")
      .select(MESSAGE_SELECT_WITH_JOINS)
      .eq("chat_id", chatId)
      .eq("pinned", true)
      .is("deleted_at", null);
    if (topicId !== undefined) {
      if (topicId) query = query.eq("topic_id", topicId);
      else query = applyGeneralTopicFilter(query, generalTopicIds);
    }
    if (localClearedAt) query = query.gt("created_at", localClearedAt);
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      console.error("Pinned messages fetch error:", error);
      setPinnedMessages([]);
      setPinnedReady(true);
      setPinnedKey(fetchKey);
      return;
    }
    const pinnedRows = (data ?? []) as unknown as MessageWithSender[];
    const pinnedHiddenIds = await fetchHiddenMessageIdSet(supabase, getMessageAndReplyIds(pinnedRows));
    rememberHiddenMessageIds(pinnedHiddenIds);
    const effectiveHiddenIds = new Set([...hiddenMessageIdsRef.current, ...pinnedHiddenIds]);
    setPinnedMessages(sortPinnedMessages(sanitizeHiddenReplies(
      pinnedRows.filter((message) => !effectiveHiddenIds.has(message.id)),
      effectiveHiddenIds,
    )));
    setPinnedKey(fetchKey);
    setPinnedReady(true);
    // `clearedAt` is read through its ref: as a dependency, the message fetch
    // setting it made this whole fetch run a second time for any chat that had
    // ever been cleared.
  }, [chatId, topicId, generalTopicIds, supabase, rememberHiddenMessageIds]);

  useEffect(() => { fetchPinnedMessages(); }, [fetchPinnedMessages]);

  // Typing broadcast — one channel per chat, stable name, dev-only diag.
  // Зависимости — на примитив `userId`, не на объект `currentUser`, чтобы
  // канал не пересоздавался на каждое heartbeat-echo (Task #48).
  useEffect(() => {
    if (!chatId || !userId) return;
    const channelName = `messages:chat:${chatId}:typing`;
    const ch = rt.channel(channelName, { config: { broadcast: { ack: false } } });
    ch.on("broadcast", { event: "typing" }, (payload: { payload?: { userId?: string; topicId?: string | null } }) => {
      const activeTopicId = topicIdRef.current;
      const incomingTopicId = payload.payload?.topicId ?? null;
      const topicMatches = activeTopicId === undefined || incomingTopicId === activeTopicId;
      if (topicMatches && payload.payload?.userId !== currentUserRef.current?.id) {
        setIsTyping(true);
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setIsTyping(false), 3000);
      }
    }).subscribe((status: string) => {
      if (import.meta.env.DEV) console.debug("[messages:typing]", chatId, status);
    });
    typingChannelRef.current = ch;
    registerChannel(channelName);
    return () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
      setIsTyping(false);
      rt.removeChannel(ch);
      typingChannelRef.current = null;
      unregisterChannel(channelName);
    };
  }, [chatId, userId, rt]);

  const sendTyping = useCallback(() => {
    const ch = typingChannelRef.current;
    const user = currentUserRef.current;
    if (!chatIdRef.current || !user || !ch) return;
    ch.send({
      type: "broadcast",
      event: "typing",
      payload: { userId: user.id, topicId: topicIdRef.current ?? null },
    });
  }, []);

  // postgres_changes for new/updated messages.
  //
  // Channel name is stable per-chat (`messages:chat:{id}`) and we set a
  // server-side `chat_id=eq.X` filter on each subscription so the realtime
  // backend doesn't shower us with rows from chats we aren't viewing.  The
  // RLS layer additionally guarantees we only ever see rows we're allowed
  // to read, but the explicit filter keeps the wire chatter down.
  useEffect(() => {
    if (!chatId || !userId) return;

    const channelName = `messages:chat:${chatId}`;
    const channel = rt
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
        async (payload: { new: MessageWithSender }) => {
          if (payload.new.chat_id !== chatIdRef.current) return;
          const localClearedAt = clearedAtRef.current;
          const clearedAtMs = localClearedAt ? new Date(localClearedAt).getTime() : null;
          if (clearedAtMs && new Date(payload.new.created_at).getTime() <= clearedAtMs) return;
          // Filter by topic — ignore messages from other topics in the same chat.
          if (
            topicIdRef.current !== undefined &&
            !messageBelongsToTopic(payload.new, topicIdRef.current, generalTopicIdsRef.current)
          ) return;
          if (hiddenMessageIdsRef.current.has(payload.new.id)) return;
          const user = currentUserRef.current;
          // Realtime carries the raw row, so `sender` — a client-side join — is
          // absent, and a message with a `user_id` but no sender resolves as an
          // INVALID actor rather than a user. `isMe` is false for that, so your
          // own message painted on the left and hopped right when the joined
          // fetch landed. Fill the sender in from what is already known.
          const provisional = attachKnownSender(
            buildRealtimeMessage(payload.new),
            user,
            useAppStore.getState().messages[payload.new.chat_id] ?? [],
          );
          // Render every realtime row immediately. The joined REST fetch below
          // can lag under rapid sends; keeping this provisional row prevents an
          // active chat from missing a message that the sidebar already saw.
          addMessage(payload.new.chat_id, provisional);
          updateChatLastMessage(payload.new.chat_id, provisional);
          if (user && isIncomingMessage(payload.new, user.id)) {
            // Receipt state follows what was rendered, not the optional joined
            // enrichment below. That fetch can legitimately lag Realtime under
            // rapid sends, especially while a PWA is resuming on iOS.
            if (document.visibilityState === "visible") {
              scheduleMarkChatRead(supabase, payload.new.chat_id, payload.new.created_at);
            } else if (shouldMarkDeliveredForPrivateChat(payload.new.chat_id, user.id)) {
              scheduleMarkChatDelivered(supabase, payload.new.chat_id, payload.new.created_at);
            }
          }
          // The joined row adds only what the provisional one cannot know: a
          // bot, the message replied to, or a sender with nothing on screen.
          // A plain message from someone already in the conversation is
          // complete as it arrived, and a new message cannot be hidden yet, so
          // asking for it again cost two requests per message and a second
          // render of its bubble for nothing.
          if (!needsJoinedRow(provisional)) return;
          const { data } = await supabase
            .from("messages")
            .select(MESSAGE_SELECT_WITH_JOINS)
            .eq("id", payload.new.id)
            .maybeSingle();
          if (!data) return;
          const nextMessage = data as unknown as MessageWithSender;
          const fetchedHiddenIds = await fetchHiddenMessageIdSet(supabase, getMessageAndReplyIds([nextMessage]));
          if (fetchedHiddenIds.size) rememberHiddenMessageIds(fetchedHiddenIds);
          const effectiveHiddenIds = new Set([...hiddenMessageIdsRef.current, ...fetchedHiddenIds]);
          if (effectiveHiddenIds.has(nextMessage.id)) return;
          if (!messageBelongsToTopic(nextMessage, topicIdRef.current, generalTopicIdsRef.current)) return;
          const visibleMessage = sanitizeHiddenReply(nextMessage, effectiveHiddenIds);
          addMessage(payload.new.chat_id, visibleMessage);
          updateChatLastMessage(payload.new.chat_id, visibleMessage);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
        async (payload: { new: { id: string; chat_id: string; deleted_at: string | null } }) => {
          if (payload.new.chat_id !== chatIdRef.current) return;
          // Re-fetch the row (pulls in sender + reactions + cleared content
          // for soft-deletes).  We patch in place so soft-deletes keep their
          // slot in the stream and render as a "сообщение удалено" placeholder
          // rather than vanishing — matches Telegram-style soft delete UX.
          const { data } = await supabase
            .from("messages")
            .select(MESSAGE_SELECT_WITH_JOINS)
            .eq("id", payload.new.id)
            .single();
          if (data) {
            const current = useAppStore.getState().messages[payload.new.chat_id] ?? [];
            const nextMessage = data as MessageWithSender;
            const fetchedHiddenIds = await fetchHiddenMessageIdSet(supabase, getMessageAndReplyIds([nextMessage]));
            if (fetchedHiddenIds.size) rememberHiddenMessageIds(fetchedHiddenIds);
            const effectiveHiddenIds = new Set([...hiddenMessageIdsRef.current, ...fetchedHiddenIds]);
            if (effectiveHiddenIds.has(nextMessage.id)) return;
            if (!messageBelongsToTopic(nextMessage, topicIdRef.current, generalTopicIdsRef.current)) return;
            const visibleMessage = sanitizeHiddenReply(nextMessage, effectiveHiddenIds);
            setMessages(payload.new.chat_id, current.map((m) => m.id === visibleMessage.id ? visibleMessage : m));
            updateChatLastMessage(payload.new.chat_id, visibleMessage);
            setPinnedMessages((currentPinned) =>
              visibleMessage.pinned && !visibleMessage.deleted_at
                ? upsertPinnedMessage(currentPinned, visibleMessage)
                : currentPinned.filter((message) => message.id !== visibleMessage.id)
            );
          }
        }
      )
      .subscribe((status: string) => {
        if (import.meta.env.DEV) console.debug("[messages:chat]", chatId, status);
        if (status === "SUBSCRIBED") {
          // For a reopened chat this is its one revalidation; for a new one it
          // closes the gap between its first fetch and the join; after a
          // reconnect it brings back whatever the outage cost.
          subscribedChatIdRef.current = chatId;
          window.setTimeout(() => {
            if (chatIdRef.current === chatId) void fetchMessages({ background: true });
          }, ACTIVE_CHAT_RECONCILE_DELAY_MS);
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          if (subscribedChatIdRef.current === chatId) subscribedChatIdRef.current = null;
          window.setTimeout(() => {
            if (chatIdRef.current === chatId) void fetchMessages({ background: true });
          }, ACTIVE_CHAT_RECONNECT_DELAY_MS);
        }
      });
    registerChannel(channelName);

    return () => {
      if (subscribedChatIdRef.current === chatId) subscribedChatIdRef.current = null;
      rt.removeChannel(channel);
      unregisterChannel(channelName);
    };
  }, [chatId, userId, rt, addMessage, fetchMessages, rememberHiddenMessageIds, setMessages, shouldMarkDeliveredForPrivateChat, supabase, updateChatLastMessage]);

  useEffect(() => {
    if (!chatId || !userId) return;
    const channelName = `reactions:chat:${chatId}`;
    let fallbackTimer: number | null = null;

    const scheduleFallbackRefetch = () => {
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      fallbackTimer = window.setTimeout(() => {
        fallbackTimer = null;
        void fetchMessages({ background: true });
      }, 300);
    };

    const handleReactionChange = (payload: { new?: { message_id?: string | null }; old?: { message_id?: string | null } }) => {
      const messageId = payload.new?.message_id ?? payload.old?.message_id ?? null;
      if (!messageId) {
        scheduleFallbackRefetch();
        return;
      }
      const activeChatId = chatIdRef.current;
      if (!activeChatId) return;
      const current = useAppStore.getState().messages[activeChatId] ?? [];
      if (!current.some((message) => message.id === messageId)) return;
      void refreshMessageById(messageId);
    };

    const channel = rt
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "reactions" }, handleReactionChange)
      .subscribe((status: string) => {
        if (import.meta.env.DEV) console.debug("[reactions:chat]", chatId, status);
      });
    registerChannel(channelName);

    return () => {
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      rt.removeChannel(channel);
      unregisterChannel(channelName);
    };
  }, [chatId, userId, rt, fetchMessages, refreshMessageById]);

  useEffect(() => {
    if (!chatId || !userId) return;
    const channelName = `profiles:chat:${chatId}`;
    const handleProfileUpdate = (payload: { new?: Profile }) => {
      const profile = payload.new;
      const activeChatId = chatIdRef.current;
      if (!profile || !activeChatId) return;
      const current = useAppStore.getState().messages[activeChatId] ?? [];
      let changed = false;
      const next = current.map((message) => {
        if (message.sender?.id !== profile.id) return message;
        changed = true;
        return { ...message, sender: { ...message.sender, ...profile } };
      });
      if (changed) setMessages(activeChatId, next);

      // The same row carries the peer's heartbeat, and the header and sidebar
      // read presence from `chat.other_user` rather than from the messages. It
      // used to be dropped here, so a peer who was actively online decayed to
      // "был(а) N минут назад" while nothing refetched the list. See
      // lib/chatProfilePatch.ts for the measurement.
      const patchedChats = applyProfileToChats(useAppStore.getState().chats, profile);
      if (patchedChats) useAppStore.getState().setChats(patchedChats);
    };

    const channel = rt
      .channel(channelName)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, (payload) => {
        handleProfileUpdate(payload as unknown as { new?: Profile });
      })
      .subscribe((status: string) => {
        if (import.meta.env.DEV) console.debug("[profiles:chat]", chatId, status);
      });
    registerChannel(channelName);

    return () => {
      rt.removeChannel(channel);
      unregisterChannel(channelName);
    };
  }, [chatId, userId, rt, setMessages]);

  useEffect(() => {
    if (!chatId || !userId) return;
    const markReadWhenVisible = () => {
      if (document.visibilityState !== "visible") return;
      const activeChatId = chatIdRef.current;
      if (!activeChatId) return;
      const latestIncoming = [...(useAppStore.getState().messages[activeChatId] ?? [])]
        .reverse()
        .find((message) => !message.deleted_at && isIncomingMessage(message, userId));
      if (latestIncoming) scheduleMarkChatRead(supabase, activeChatId, latestIncoming.created_at);
    };
    document.addEventListener("visibilitychange", markReadWhenVisible);
    return () => document.removeEventListener("visibilitychange", markReadWhenVisible);
  }, [chatId, userId, supabase]);

  const insertMessageWithAck = useCallback(async (
    input: Required<Pick<SendMessageInput, "type" | "content">> & {
      targetChatId: string;
      userId: string;
      topicId: string | null;
      mediaBucket: string | null;
      mediaPath: string | null;
      mediaUrl: string | null;
      replyToId: string | null;
      forwardedFromId: string | null;
      clientMessageId: string;
      clientSentAt: string;
      mediaMetadata?: Json | null;
    },
  ): Promise<SendMessageAck> => {
    const basePayload = {
      chat_id: input.targetChatId,
      topic_id: input.topicId,
      user_id: input.userId,
      content: input.content,
      type: input.type,
      media_bucket: input.mediaBucket,
      media_path: input.mediaPath,
      media_url: input.mediaUrl,
      reply_to_id: input.replyToId,
      forwarded_from_id: input.forwardedFromId,
      client_message_id: input.clientMessageId,
      client_sent_at: input.clientSentAt,
    };
    const payload = input.mediaMetadata === undefined
      ? basePayload
      : { ...basePayload, media_metadata: input.mediaMetadata };

    let insertPromise = supabase
      .from("messages")
      .insert(payload)
      .select(MESSAGE_SELECT_WITH_JOINS)
      .single();

    let result = await withTimeout(insertPromise, SEND_ACK_TIMEOUT_MS);
    if (isTimeoutResult(result)) {
      return { data: null, error: null, timedOut: true };
    }

    if (result.error && input.mediaMetadata !== undefined && isMissingMediaMetadataError(result.error)) {
      insertPromise = supabase
        .from("messages")
        .insert(basePayload)
        .select(MESSAGE_SELECT_WITH_JOINS)
        .single();
      result = await withTimeout(insertPromise, SEND_ACK_TIMEOUT_MS);
      if (isTimeoutResult(result)) {
        return { data: null, error: null, timedOut: true };
      }
    }

    if (result.data) {
      return { data: result.data as unknown as MessageWithSender, error: null, timedOut: false };
    }

    const existing = await fetchMessageByClientId(input.targetChatId, input.userId, input.clientMessageId);
    return { data: existing, error: result.error, timedOut: false };
  }, [fetchMessageByClientId, supabase]);

  const sendLocalMessage = useCallback(async (input: SendMessageInput) => {
    const user = currentUserRef.current;
    const activeChatId = input.targetChatId ?? chatIdRef.current;
    const trimmedContent = input.type === "text" ? (input.content ?? "").trim() : input.content;
    if (!activeChatId || !user || (input.type === "text" && !trimmedContent)) return null;

    const clientMessageId = input.clientMessageId ?? crypto.randomUUID();
    const clientSentAt = input.clientSentAt ?? new Date().toISOString();
    const tempId = input.tempId ?? `tmp:${clientMessageId}`;
    const messageTopicId = input.topicId === undefined ? (topicIdRef.current ?? null) : input.topicId;
    const optimistic: MessageWithSender = {
      id: tempId,
      chat_id: activeChatId,
      topic_id: messageTopicId,
      user_id: user.id,
      bot_id: null,
      bot_reply_markup: null,
      content: trimmedContent,
      type: input.type,
      media_bucket: input.mediaBucket ?? null,
      media_path: input.mediaPath ?? null,
      media_url: input.mediaUrl ?? null,
      reply_to_id: input.replyToId ?? null,
      forwarded_from_id: input.forwardedFromId ?? null,
      edited_at: null,
      deleted_at: null,
      pinned: false,
      created_at: clientSentAt,
      client_message_id: clientMessageId,
      client_sent_at: clientSentAt,
      media_metadata: input.mediaMetadata ?? null,
      sender: user,
      reactions: [],
      pending: true,
      checking: false,
      failed: false,
      send_error: null,
    };

    if (input.tempId) replaceMessage(activeChatId, tempId, optimistic);
    else addMessage(activeChatId, optimistic);
    updateChatLastMessage(activeChatId, optimistic);

    const ack = await insertMessageWithAck({
      targetChatId: activeChatId,
      userId: user.id,
      type: input.type,
      content: trimmedContent,
      mediaBucket: input.mediaBucket ?? null,
      mediaPath: input.mediaPath ?? null,
      mediaUrl: input.mediaUrl ?? null,
      replyToId: input.replyToId ?? null,
      forwardedFromId: input.forwardedFromId ?? null,
      topicId: messageTopicId,
      clientMessageId,
      clientSentAt,
      mediaMetadata: input.mediaMetadata,
    });

    if (ack.data) {
      replaceMessage(activeChatId, tempId, ack.data);
      updateChatLastMessage(activeChatId, ack.data);
      await supabase.from("chats").update({ updated_at: ack.data.created_at }).eq("id", activeChatId);
      return ack.data;
    }

    if (ack.timedOut) {
      reportError(
        new Error("message_send_ack_timeout"),
        createMessageSendTimeoutContext(input.type, Boolean(input.mediaUrl)),
      );
      const checkingMessage: MessageWithSender = {
        ...optimistic,
        pending: false,
        checking: true,
        failed: false,
        send_error: null,
      };
      replaceMessage(activeChatId, tempId, checkingMessage);
      updateChatLastMessage(activeChatId, checkingMessage);
      await delay(1_200);
      const existing = await fetchMessageByClientId(activeChatId, user.id, clientMessageId);
      if (existing) {
        replaceMessage(activeChatId, tempId, existing);
        updateChatLastMessage(activeChatId, existing);
        await supabase.from("chats").update({ updated_at: existing.created_at }).eq("id", activeChatId);
        return existing;
      }
      const failedMessage: MessageWithSender = {
        ...optimistic,
        pending: false,
        checking: false,
        failed: true,
        send_error: "Не удалось подтвердить отправку. Проверьте соединение и повторите.",
      };
      replaceMessage(activeChatId, tempId, failedMessage);
      updateChatLastMessage(activeChatId, failedMessage);
      return null;
    }

    const friendlySendError = getMessageAckUserMessage(ack.error);
    const safeAckError = sanitizeMessageAckError(ack.error);
    console.error("[messages] send failed.", safeAckError.code, safeAckError.name);
    reportError(safeAckError.error, {
      category: "message_send_failed",
      errorCode: safeAckError.code,
      errorName: safeAckError.name,
      type: input.type,
      hasMedia: Boolean(input.mediaUrl),
    });
    const failedMessage: MessageWithSender = {
      ...optimistic,
      pending: false,
      checking: false,
      failed: true,
      send_error: friendlySendError,
    };
    replaceMessage(activeChatId, tempId, failedMessage);
    updateChatLastMessage(activeChatId, failedMessage);
    return null;
  }, [addMessage, fetchMessageByClientId, insertMessageWithAck, replaceMessage, supabase, updateChatLastMessage]);

  const sendMessage = useCallback(async (content: string, replyToId?: string) => {
    return sendLocalMessage({
      type: "text",
      content,
      replyToId: replyToId ?? null,
    });
  }, [sendLocalMessage]);

  const sendMediaMessage = useCallback(async (input: {
    type: Extract<SendableMessageType, "image" | "video" | "audio" | "file">;
    content: string | null;
    mediaUrl: string;
    mediaBucket?: string | null;
    mediaPath?: string | null;
    replyToId?: string | null;
    clientMessageId?: string | null;
    clientSentAt?: string | null;
    mediaMetadata?: Json | null;
  }) => {
    return sendLocalMessage({
      type: input.type,
      content: input.content,
      mediaBucket: input.mediaBucket ?? null,
      mediaPath: input.mediaPath ?? null,
      mediaUrl: input.mediaUrl,
      replyToId: input.replyToId ?? null,
      clientMessageId: input.clientMessageId ?? null,
      clientSentAt: input.clientSentAt ?? null,
      mediaMetadata: input.mediaMetadata,
    });
  }, [sendLocalMessage]);

  const retryMessageSend = useCallback(async (message: MessageWithSender) => {
    if (!message.failed && !message.checking) return null;
    return sendLocalMessage({
      type: message.type as SendableMessageType,
      content: message.content,
      mediaBucket: message.media_bucket,
      mediaPath: message.media_path,
      mediaUrl: message.media_url,
      replyToId: message.reply_to_id,
      forwardedFromId: message.forwarded_from_id,
      topicId: message.topic_id,
      clientMessageId: message.client_message_id ?? crypto.randomUUID(),
      clientSentAt: message.client_sent_at ?? message.created_at,
      mediaMetadata: message.media_metadata ?? undefined,
      tempId: message.id,
      targetChatId: message.chat_id,
    });
  }, [sendLocalMessage]);

  const discardLocalMessage = useCallback((messageId: string) => {
    const activeChatId = chatIdRef.current;
    if (!activeChatId) return;
    removeMessage(activeChatId, messageId);
  }, [removeMessage]);

  // ── Edit ────────────────────────────────────────────────────────────────
  // UPDATE the row; the realtime UPDATE handler above will replace the message
  // with the freshly-joined data, so no manual store push is needed here.
  const editMessage = useCallback(async (messageId: string, newContent: string) => {
    const trimmed = newContent.trim();
    if (!chatId || !trimmed) return;
    const { error } = await supabase
      .from("messages")
      .update({ content: trimmed, edited_at: new Date().toISOString() })
      .eq("id", messageId);
    if (error) console.error("Edit error:", error);
  }, [chatId, supabase]);

  // ── Delete (soft) ───────────────────────────────────────────────────────
  // Set deleted_at; realtime UPDATE handler removes the bubble from view.
  const deleteMessage = useCallback(async (messageId: string) => {
    if (!chatId) return { ok: false, error: "Чат не выбран." };
    const { error } = await supabase
      .from("messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", messageId);
    if (error) {
      console.error("Delete error:", error);
      return { ok: false, error: mapPgError(error) };
    }
    return { ok: true, error: null };
  }, [chatId, supabase]);

  const hideMessageForMe = useCallback(async (messageId: string) => {
    if (!chatId) return { ok: false, error: "Чат не выбран." };
    const { error } = await supabase.rpc("hide_message_for_me", { p_message_id: messageId });
    if (error) {
      console.error("Hide message for me error:", error);
      return { ok: false, error: mapPgError(error) || "Не удалось скрыть сообщение." };
    }
    rememberHiddenMessageIds([messageId]);
    removeMessage(chatId, messageId);
    setPinnedMessages((current) => current.filter((message) => message.id !== messageId));
    const chat = useAppStore.getState().chats.find((item) => item.id === chatId);
    if (chat?.last_message?.id === messageId) {
      updateChat({ ...chat, last_message: undefined });
    }
    dispatchChatsRefresh({ reason: "message-hidden", chatId, messageId });
    return { ok: true, error: null };
  }, [chatId, rememberHiddenMessageIds, removeMessage, supabase, updateChat]);

  const hideMessagesForMe = useCallback(async (messageIds: string[]) => {
    if (!chatId) return { ok: false, error: "Чат не выбран.", failed: messageIds.length };
    const uniqueIds = Array.from(new Set(messageIds)).filter(Boolean);
    if (!uniqueIds.length) return { ok: true, error: null, failed: 0 };
    const failed: string[] = [];
    for (const messageId of uniqueIds) {
      const { error } = await supabase.rpc("hide_message_for_me", { p_message_id: messageId });
      if (error) {
        console.error("Bulk hide message for me error:", error);
        failed.push(messageId);
      }
    }
    const hiddenIds = uniqueIds.filter((id) => !failed.includes(id));
    if (hiddenIds.length) {
      rememberHiddenMessageIds(hiddenIds);
      for (const messageId of hiddenIds) removeMessage(chatId, messageId);
      setPinnedMessages((current) => current.filter((message) => !hiddenIds.includes(message.id)));
      const chat = useAppStore.getState().chats.find((item) => item.id === chatId);
      if (chat?.last_message && hiddenIds.includes(chat.last_message.id)) {
        updateChat({ ...chat, last_message: undefined });
      }
      dispatchChatsRefresh({ reason: "message-hidden", chatId });
    }
    if (failed.length) {
      return { ok: false, error: `Не удалось скрыть ${failed.length} из ${uniqueIds.length} сообщений.`, failed: failed.length };
    }
    return { ok: true, error: null, failed: 0 };
  }, [chatId, rememberHiddenMessageIds, removeMessage, supabase, updateChat]);

  // ── Delete for everyone ─────────────────────────────────────────────────
  // «Удалить» with its box ticked. `delete_messages_for_everyone`
  // (20260911143000) deletes up to 100 messages of one chat per call: in a
  // private chat anyone's, in a group the reader's own. The deletion shows at
  // once — gone in a private chat, «Сообщение удалено» in a group — and the
  // Realtime UPDATE that follows brings the server's copy. Where the function is
  // not deployed, what the dialog did before: own messages get the soft delete,
  // anyone else's are hidden for the reader.
  const deleteMessagesForEveryone = useCallback(async (items: MessageWithSender[]) => {
    const activeChatId = chatIdRef.current;
    const user = currentUserRef.current;
    if (!activeChatId || !user) return { ok: false, error: "Чат не выбран." };
    const batches = deletionBatches(items.map((item) => item.id));
    if (!batches.length) return { ok: true, error: null };

    const deleteAsBefore = async () => {
      const { own, others } = splitForPreviousDeletion(items, (message) => canUseHumanMessageControls(message, user.id));
      const failures: string[] = [];
      for (const message of own) {
        const result = await deleteMessage(message.id);
        if (!result.ok) failures.push(result.error ?? "Не удалось удалить сообщение.");
      }
      if (others.length) {
        const hidden = await hideMessagesForMe(others.map((message) => message.id));
        if (!hidden.ok) failures.push(hidden.error ?? "Не удалось скрыть сообщения.");
      }
      if (!failures.length) return { ok: true, error: null };
      return {
        ok: false,
        error: items.length > 1 ? `Не удалось удалить ${failures.length} из ${items.length}.` : failures[0],
      };
    };

    const showDeleted = (ids: Set<string>) => {
      if (!ids.size) return;
      const current = useAppStore.getState().messages[activeChatId] ?? [];
      const next = markMessagesDeleted(current, ids, new Date().toISOString());
      if (next !== current) setMessages(activeChatId, next);
      setPinnedMessages((pinned) =>
        pinned.some((message) => ids.has(message.id)) ? pinned.filter((message) => !ids.has(message.id)) : pinned,
      );
      const chat = useAppStore.getState().chats.find((item) => item.id === activeChatId);
      if (chat?.last_message && ids.has(chat.last_message.id)) {
        dispatchChatsRefresh({ reason: "message-hidden", chatId: activeChatId });
      }
    };

    if (!rpcAvailability.shouldTry(DELETE_FOR_EVERYONE_RPC)) return deleteAsBefore();

    const deleted = new Set<string>();
    for (const [index, batch] of batches.entries()) {
      const { data, error } = await supabase.rpc(DELETE_FOR_EVERYONE_RPC, { p_message_ids: batch });
      if (error) {
        if (index === 0 && isMissingRpcError(error)) {
          rpcAvailability.markMissing(DELETE_FOR_EVERYONE_RPC);
          return deleteAsBefore();
        }
        showDeleted(deleted);
        console.error("Delete for everyone error:", error);
        return { ok: false, error: mapPgError(error) };
      }
      rpcAvailability.markPresent(DELETE_FOR_EVERYONE_RPC);
      for (const id of parseDeletedIds(data) ?? batch) deleted.add(id);
    }
    showDeleted(deleted);
    return { ok: true, error: null };
  }, [deleteMessage, hideMessagesForMe, setMessages, supabase]);

  // ── Pin / unpin ─────────────────────────────────────────────────────────
  const togglePin = useCallback(async (messageId: string, currentlyPinned: boolean) => {
    if (!chatId) return { ok: false, error: "Чат не выбран." };
    const rpcName = currentlyPinned ? "unpin_message" : "pin_message";
    const { data, error } = await supabase.rpc(rpcName, { p_message_id: messageId });
    if (error) {
      console.error("Pin error:", error);
      return { ok: false, error: mapPgError(error) };
    }
    if (data) {
      const current = useAppStore.getState().messages[chatId] ?? [];
      let updatedMessage: MessageWithSender | null = null;
      setMessages(chatId, current.map((message) => {
        if (message.id !== messageId) return message;
        updatedMessage = { ...message, pinned: Boolean(data.pinned) };
        return updatedMessage;
      }));
      setPinnedMessages((currentPinned) => {
        if (Boolean(data.pinned) && updatedMessage) {
          return upsertPinnedMessage(currentPinned, updatedMessage);
        }
        return currentPinned.filter((message) => message.id !== messageId);
      });
    }
    return { ok: true, error: null };
  }, [chatId, supabase, setMessages]);

  // ── Forward ─────────────────────────────────────────────────────────────
  // The server makes the copy (`forward_message`, 20260911144000): from its own
  // row of the source, with the media fields and the source's previews, into a
  // chat the sender may write to (D-083). Where that function is not deployed
  // the client inserts the copy, as it did, now with the media fields too, so
  // the variant worker renders the copy's previews.
  //
  // It answers with what happened, not with the row or null. A refusal used to
  // go no further than the console, and the caller closed the dialog without
  // reading the answer, so a forward the server refused looked exactly like one
  // it delivered.
  const forwardMessage = useCallback(async (
    src: MessageWithSender,
    targetChatId: string,
  ): Promise<ForwardMessageResult> => {
    const user = currentUserRef.current;
    if (!user) return { ok: false, error: "Войдите в аккаунт, чтобы пересылать сообщения." };
    const target = {
      chatId: targetChatId,
      userId: user.id,
      clientMessageId: crypto.randomUUID(),
      clientSentAt: new Date().toISOString(),
    };
    let forwarded: { created_at: string } | null = null;
    if (rpcAvailability.shouldTry(FORWARD_RPC)) {
      const { data, error } = await supabase.rpc(FORWARD_RPC, forwardRpcArgs(src, target));
      if (!error && data) {
        rpcAvailability.markPresent(FORWARD_RPC);
        forwarded = data as unknown as { created_at: string };
      } else if (error && isMissingRpcError(error)) {
        rpcAvailability.markMissing(FORWARD_RPC);
      } else {
        console.error("Forward error:", error);
        return { ok: false, error: mapPgError(error) };
      }
    }
    if (!forwarded) {
      const { data, error } = await supabase
        .from("messages")
        .insert(forwardInsertPayload(src, target))
        .select(MESSAGE_SELECT_WITH_JOINS)
        .single();
      if (error || !data) {
        console.error("Forward error:", error);
        return { ok: false, error: mapPgError(error) };
      }
      forwarded = data as unknown as MessageWithSender;
    }
    // Ordering only. The message is delivered once the copy exists, so the
    // answer to this bump must not turn a delivered forward into a failure.
    await supabase.from("chats").update({ updated_at: forwarded.created_at }).eq("id", targetChatId);
    return { ok: true, error: null };
  }, [supabase]);

  // ── Reactions ───────────────────────────────────────────────────────────
  // One reaction per person, as in Telegram (the owner's decision of
  // 2026-09-11): another emoji replaces yours, yours again removes it. The
  // database holds the rule (20260911142000): `set_message_reaction` makes the
  // whole toggle in one call under a lock and answers with every reaction on the
  // message, which is shown as it is. Where that function is not deployed the
  // toggle is the three requests it was, and a refetch settles the result.
  //
  // The guess is shown before the server answers either way: a reaction used to
  // appear only after the refetch.
  const toggleReaction = useCallback(async (messageId: string, emoji: string) => {
    const user = currentUserRef.current;
    if (!user) return;
    const activeChatId = chatId;
    const shown = activeChatId
      ? (useAppStore.getState().messages[activeChatId] ?? []).find((message) => message.id === messageId)
      : undefined;
    const showReactions = (reactions: unknown) => {
      if (!activeChatId) return;
      const current = useAppStore.getState().messages[activeChatId] ?? [];
      setMessages(activeChatId, current.map((message) =>
        message.id === messageId ? { ...message, reactions: reactions as MessageWithSender["reactions"] } : message,
      ));
    };

    if (shown) {
      const guess = planReactionToggle(shown.reactions, user.id, emoji);
      showReactions(applyReactionPlan(shown.reactions, user.id, guess, { messageId, createdAt: new Date().toISOString() }));
      if (guess.add) rememberReactionUse(guess.add);
    }

    const toggleAsBefore = async () => {
      let mine = shown?.reactions?.filter((reaction) => reaction.user_id === user.id) ?? null;
      if (!mine) {
        const { data, error: lookupError } = await supabase.from("reactions")
          .select("id,message_id,user_id,emoji,created_at")
          .eq("message_id", messageId).eq("user_id", user.id);
        if (lookupError) {
          console.error("Reaction lookup error:", lookupError);
          return;
        }
        mine = (data ?? []) as NonNullable<MessageWithSender["reactions"]>;
      }
      const plan = planReactionToggle(mine, user.id, emoji);
      if (!shown && plan.add) rememberReactionUse(plan.add);
      if (plan.remove.length) {
        // Every row of this person on this message, not only the ones on
        // screen: that is what keeps a stray second row from outliving the next
        // choice.
        const { error } = await supabase.from("reactions").delete()
          .eq("message_id", messageId).eq("user_id", user.id);
        if (error) console.error("Reaction removal error:", error);
      }
      if (plan.add) {
        const { error } = await supabase.from("reactions").insert({ message_id: messageId, user_id: user.id, emoji: plan.add });
        if (error) console.error("Reaction insert error:", error);
      }
    };

    if (rpcAvailability.shouldTry(SET_REACTION_RPC)) {
      const { data, error } = await supabase.rpc(SET_REACTION_RPC, { p_message_id: messageId, p_emoji: emoji });
      if (!error) {
        rpcAvailability.markPresent(SET_REACTION_RPC);
        const rows = parseReactionRows(data);
        if (rows) {
          showReactions(rows);
          return;
        }
      } else if (isMissingRpcError(error)) {
        rpcAvailability.markMissing(SET_REACTION_RPC);
        await toggleAsBefore();
      } else {
        console.error("Reaction error:", error);
      }
    } else {
      await toggleAsBefore();
    }

    const { data: updatedMsg } = await supabase.from("messages")
      .select(MESSAGE_SELECT_WITH_JOINS)
      .eq("id", messageId).single();
    if (updatedMsg && activeChatId) {
      const current = useAppStore.getState().messages[activeChatId] ?? [];
      setMessages(activeChatId, current.map((m) => m.id === messageId ? (updatedMsg as MessageWithSender) : m));
    }
  }, [chatId, supabase, setMessages]);

  const clearChatForMe = useCallback(async () => {
    if (!chatId) return { ok: false, error: "Чат не выбран." };
    const { error } = await supabase.rpc("clear_chat_for_me", { p_chat_id: chatId });
    if (error) {
      console.error("Clear chat for me error:", error);
      return { ok: false, error: mapPgError(error) };
    }
    const nextClearedAt = new Date().toISOString();
    forgetClearedAt(chatId);
    setClearedAt(nextClearedAt);
    setMessages(chatId, []);
    setPinnedMessages([]);
    setPinnedKey(getPinnedKey(chatId, topicId));
    setPinnedReady(true);
    return { ok: true, error: null };
  }, [chatId, supabase, setMessages]);

  // The same list while nothing it is made from has changed. A new array on
  // every render of this hook rendered the conversation for any render of the
  // chat window — a chat list update, a composer resize — though no message
  // had changed.
  const visibleMessages = useMemo(() => {
    const scoped = chatMessages.filter((message) =>
      !hiddenMessageIds.has(message.id) && messageBelongsToTopic(message, topicId, generalTopicIds)
    );
    if (scoped.length === chatMessages.length && !hiddenMessageIds.size) return chatMessages;
    return sanitizeHiddenReplies(scoped, hiddenMessageIds);
  }, [chatMessages, generalTopicIds, hiddenMessageIds, topicId]);

  const currentPinnedKey = getPinnedKey(chatId, topicId);
  const visiblePinnedMessages = useMemo(() => {
    if (pinnedKey !== currentPinnedKey) return EMPTY_MESSAGES;
    if (!hiddenMessageIds.size) return pinnedMessages;
    return sanitizeHiddenReplies(pinnedMessages.filter((message) => !hiddenMessageIds.has(message.id)), hiddenMessageIds);
  }, [currentPinnedKey, hiddenMessageIds, pinnedKey, pinnedMessages]);

  return {
    messages: visibleMessages,
    pinnedMessages: visiblePinnedMessages,
    pinnedReady: pinnedKey === currentPinnedKey && pinnedReady,
    loading, loadingOlder, hasMoreOlder, olderError, isTyping,
    sendMessage, sendMediaMessage, sendTyping, toggleReaction,
    retryMessageSend, discardLocalMessage,
    editMessage, deleteMessage, hideMessageForMe, hideMessagesForMe, deleteMessagesForEveryone, togglePin, forwardMessage,
    clearChatForMe,
    loadOlderMessages,
    ensureMessageLoaded: fetchMessageById,
    refetch: fetchMessages,
    refetchPinnedMessages: fetchPinnedMessages,
  };
}

function getPinnedKey(chatId: string | null, topicId: string | null | undefined): string {
  return `${chatId ?? "none"}:${topicId === undefined ? "all" : topicId ?? "root"}`;
}

function messageBelongsToTopic(
  message: Pick<MessageWithSender, "topic_id">,
  topicId: string | null | undefined,
  generalTopicIds: string[] = [],
): boolean {
  if (topicId === undefined) return true;
  if (topicId === null) {
    return message.topic_id === null || (message.topic_id ? generalTopicIds.includes(message.topic_id) : false);
  }
  return (message.topic_id ?? null) === (topicId ?? null);
}

function applyGeneralTopicFilter<T extends { or: (filters: string) => T; is: (column: string, value: null) => T }>(
  query: T,
  generalTopicIds: string[],
): T {
  if (!generalTopicIds.length) return query.is("topic_id", null);
  const ids = generalTopicIds.join(",");
  return query.or(`topic_id.is.null,topic_id.in.(${ids})`);
}

function getMessageAndReplyIds(messages: MessageWithSender[]): string[] {
  return Array.from(new Set(messages.flatMap((message) => [message.id, message.reply_to_id].filter(Boolean) as string[])));
}

function sanitizeHiddenReply(message: MessageWithSender, hiddenIds: Set<string>): MessageWithSender {
  if (!message.reply_to_id || !hiddenIds.has(message.reply_to_id)) return message;
  return { ...message, reply_to: undefined };
}

function sanitizeHiddenReplies(messages: MessageWithSender[], hiddenIds: Set<string>): MessageWithSender[] {
  if (!hiddenIds.size) return messages;
  return messages.map((message) => sanitizeHiddenReply(message, hiddenIds));
}

function buildRealtimeMessage(row: MessageWithSender): MessageWithSender {
  // Receiver path: render voice bubbles from the realtime INSERT row
  // immediately. The richer REST refetch below upserts the same id with
  // sender/reactions, so this temporary row only covers the first paint.
  //
  // Shaped like the joined row wherever the insert already says what the join
  // would: no bot and no reply come back as `null`. A later revalidation then
  // finds the same data and keeps the bubble instead of rendering it again.
  // The local send states are left absent, as a fetched row has them.
  return {
    ...row,
    media_url: row.media_url ?? null,
    content: row.content ?? null,
    reactions: row.reactions ?? [],
    bot: row.bot ?? null,
    reply_to: row.reply_to ?? (row.reply_to_id ? undefined : (null as unknown as undefined)),
  };
}

/** Whether a realtime row still needs the joined fetch to render correctly. */
function needsJoinedRow(message: MessageWithSender): boolean {
  if (message.bot_id) return true;
  if (message.reply_to_id) return true;
  return Boolean(message.user_id && !message.sender);
}

function isTimeoutResult<T>(value: T | TimeoutResult): value is TimeoutResult {
  return Boolean(value && typeof value === "object" && "timedOut" in value);
}

function isMissingMediaMetadataError(error: unknown): boolean {
  const record = error as { code?: unknown; message?: unknown; details?: unknown } | null;
  const text = `${String(record?.code ?? "")} ${String(record?.message ?? "")} ${String(record?.details ?? "")}`.toLowerCase();
  return text.includes("media_metadata") && (text.includes("column") || text.includes("schema cache") || text.includes("pgrst204") || text.includes("42703"));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T | TimeoutResult> {
  return Promise.race<T | TimeoutResult>([
    Promise.resolve(promise),
    new Promise<TimeoutResult>((resolve) => window.setTimeout(() => resolve({ timedOut: true }), ms)),
  ]);
}

function sortPinnedMessages(messages: MessageWithSender[]): MessageWithSender[] {
  return [...messages].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

function upsertPinnedMessage(
  messages: MessageWithSender[],
  nextMessage: MessageWithSender,
): MessageWithSender[] {
  return sortPinnedMessages([
    nextMessage,
    ...messages.filter((message) => message.id !== nextMessage.id),
  ]);
}

async function fetchHiddenMessageIdSet(
  supabase: ReturnType<typeof createClient>,
  messageIds: string[],
): Promise<Set<string>> {
  const ids = Array.from(new Set(messageIds.filter(Boolean)));
  if (!ids.length) return new Set();
  const { data, error } = await supabase
    .from("message_hidden_for_users")
    .select("message_id")
    .in("message_id", ids);
  if (error) {
    console.error("Hidden message ids fetch error:", error);
    return new Set();
  }
  return new Set((data ?? []).map((row) => row.message_id));
}
