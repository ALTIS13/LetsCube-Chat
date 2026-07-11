import { useEffect, useMemo, useState } from "react";
import type { MediaVariant, MessageWithSender } from "@/types/database";
import { createClient } from "@/lib/supabase/client";
import {
  beginMessageVariantRefresh,
  completeMessageVariantRefresh,
  getMessageVariantCacheKey,
  getMessageVariantSourceIds,
  hasVideoVariantSources,
  queueMessageVariantRefresh,
  selectMessageVariantCacheEvictions,
  type MessageVariantRefreshState,
} from "@/lib/messageVariantRefresh";

type MessageMediaVariantSource = Pick<MessageWithSender, "id" | "chat_id" | "type" | "media_url" | "deleted_at">;

export interface MessageMediaVariantUrls {
  previewUrl?: string;
  previewWidth?: number | null;
  previewHeight?: number | null;
  thumbUrl?: string;
  thumbWidth?: number | null;
  thumbHeight?: number | null;
  videoPosterUrl?: string;
  videoPosterWidth?: number | null;
  videoPosterHeight?: number | null;
  video720pUrl?: string;
  video720pWidth?: number | null;
  video720pHeight?: number | null;
}

export interface AvatarVariantUrls {
  avatar128Url?: string;
  avatar128Width?: number | null;
  avatar128Height?: number | null;
  avatar256Url?: string;
  avatar256Width?: number | null;
  avatar256Height?: number | null;
}

const MESSAGE_VARIANT_KINDS = ["image_preview", "image_thumb", "video_poster", "video_720p"] as const;
const AVATAR_VARIANT_KINDS = ["avatar_128", "avatar_256"] as const;
const VIDEO_VARIANT_REFRESH_INTERVAL_MS = 60_000;
const MESSAGE_VARIANT_REFRESH_DEBOUNCE_MS = 120;
const MESSAGE_VARIANT_CACHE_LIMIT = 8;

interface MessageVariantCacheEntry {
  chatId: string;
  refreshState: MessageVariantRefreshState;
  hasVideoMessages: boolean;
  variants: Record<string, MessageMediaVariantUrls>;
  listeners: Set<(variants: Record<string, MessageMediaVariantUrls>) => void>;
  intervalId: number | null;
  refreshOnFocus: (() => void) | null;
  debounceTimer: number | null;
  evictionTimer: number | null;
  hasStarted: boolean;
  disposed: boolean;
}

const messageVariantCache = new Map<string, MessageVariantCacheEntry>();

function getVariantPublicUrl(
  storage: ReturnType<typeof createClient>["storage"],
  row: Pick<MediaVariant, "variant_bucket" | "variant_path">,
): string | null {
  return storage.from(row.variant_bucket).getPublicUrl(row.variant_path).data.publicUrl ?? null;
}

export function useMessageMediaVariantUrls(messages: MessageMediaVariantSource[]): Record<string, MessageMediaVariantUrls> {
  const messageIds = useMemo(() => getMessageVariantSourceIds(messages), [messages]);
  const messageIdKey = messageIds.join("|");
  const chatId = useMemo(() => getMessageVariantCacheKey(messages), [messages]);
  const hasVideoMessages = useMemo(() => hasVideoVariantSources(messages), [messages]);
  const [variantsByMessageId, setVariantsByMessageId] = useState<Record<string, MessageMediaVariantUrls>>({});

  useEffect(() => {
    if (!chatId) {
      setVariantsByMessageId({});
      return;
    }

    const entry = getMessageVariantCacheEntry(chatId);
    entry.listeners.add(setVariantsByMessageId);
    if (entry.evictionTimer !== null) {
      window.clearTimeout(entry.evictionTimer);
      entry.evictionTimer = null;
    }
    setVariantsByMessageId(entry.variants);
    updateMessageVariantCacheEntry(entry, messageIds, hasVideoMessages);
    return () => {
      entry.listeners.delete(setVariantsByMessageId);
      scheduleMessageVariantEntryEviction(entry);
    };
  }, [chatId, hasVideoMessages, messageIdKey]);

  return variantsByMessageId;
}

function getMessageVariantCacheEntry(chatId: string): MessageVariantCacheEntry {
  const existing = messageVariantCache.get(chatId);
  if (existing) return existing;
  const entry: MessageVariantCacheEntry = {
    chatId,
    refreshState: { messageIds: [], loading: false, reloadPending: false },
    hasVideoMessages: false,
    variants: {},
    listeners: new Set(),
    intervalId: null,
    refreshOnFocus: null,
    debounceTimer: null,
    evictionTimer: null,
    hasStarted: false,
    disposed: false,
  };
  evictUnusedMessageVariantEntries();
  messageVariantCache.set(chatId, entry);
  return entry;
}

function updateMessageVariantCacheEntry(
  entry: MessageVariantCacheEntry,
  messageIds: string[],
  hasVideoMessages: boolean,
): void {
  const transition = queueMessageVariantRefresh(entry.refreshState, messageIds);
  entry.refreshState = transition.state;
  configureMessageVariantPolling(entry, hasVideoMessages);
  if (messageIds.length === 0) {
    entry.variants = {};
    notifyMessageVariantListeners(entry);
    return;
  }
  if (transition.startNow) {
    scheduleMessageVariantLoad(entry, entry.hasStarted ? MESSAGE_VARIANT_REFRESH_DEBOUNCE_MS : 0);
  }
}

function configureMessageVariantPolling(entry: MessageVariantCacheEntry, hasVideoMessages: boolean): void {
  if (entry.hasVideoMessages === hasVideoMessages) return;
  stopMessageVariantPolling(entry);
  entry.hasVideoMessages = hasVideoMessages;
  if (!hasVideoMessages) return;
  const refresh = () => {
    if (document.visibilityState === "visible") scheduleMessageVariantLoad(entry, 0);
  };
  entry.refreshOnFocus = refresh;
  entry.intervalId = window.setInterval(refresh, VIDEO_VARIANT_REFRESH_INTERVAL_MS);
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);
}

function stopMessageVariantPolling(entry: MessageVariantCacheEntry): void {
  if (entry.intervalId !== null) window.clearInterval(entry.intervalId);
  if (entry.refreshOnFocus) {
    window.removeEventListener("focus", entry.refreshOnFocus);
    document.removeEventListener("visibilitychange", entry.refreshOnFocus);
  }
  entry.intervalId = null;
  entry.refreshOnFocus = null;
}

function scheduleMessageVariantLoad(entry: MessageVariantCacheEntry, delay: number): void {
  if (entry.disposed || entry.refreshState.messageIds.length === 0) return;
  if (entry.refreshState.loading) {
    entry.refreshState = { ...entry.refreshState, reloadPending: true };
    return;
  }
  if (entry.debounceTimer !== null) window.clearTimeout(entry.debounceTimer);
  if (delay === 0) {
    entry.debounceTimer = null;
    void loadMessageVariants(entry);
    return;
  }
  entry.debounceTimer = window.setTimeout(() => {
    entry.debounceTimer = null;
    void loadMessageVariants(entry);
  }, delay);
}

async function loadMessageVariants(entry: MessageVariantCacheEntry): Promise<void> {
  if (entry.disposed || entry.refreshState.loading || entry.refreshState.messageIds.length === 0) return;
  entry.refreshState = beginMessageVariantRefresh(entry.refreshState);
  entry.hasStarted = true;
  const messageIds = entry.refreshState.messageIds;
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("media_variants")
      .select("id,message_id,variant_kind,variant_bucket,variant_path,width,height,status")
      .eq("status", "ready")
      .in("variant_kind", [...MESSAGE_VARIANT_KINDS])
      .in("message_id", messageIds);
    if (error) return;

    const next: Record<string, MessageMediaVariantUrls> = {};
    for (const row of (data ?? []) as unknown as MediaVariant[]) {
      if (!row.message_id) continue;
      const publicUrl = getVariantPublicUrl(supabase.storage, row);
      if (!publicUrl) continue;
      const current = next[row.message_id] ?? {};
      if (row.variant_kind === "image_preview") {
        current.previewUrl = publicUrl;
        current.previewWidth = row.width;
        current.previewHeight = row.height;
      } else if (row.variant_kind === "image_thumb") {
        current.thumbUrl = publicUrl;
        current.thumbWidth = row.width;
        current.thumbHeight = row.height;
      } else if (row.variant_kind === "video_poster") {
        current.videoPosterUrl = publicUrl;
        current.videoPosterWidth = row.width;
        current.videoPosterHeight = row.height;
      } else if (row.variant_kind === "video_720p") {
        current.video720pUrl = publicUrl;
        current.video720pWidth = row.width;
        current.video720pHeight = row.height;
      }
      next[row.message_id] = current;
    }
    entry.variants = next;
    notifyMessageVariantListeners(entry);
  } finally {
    const transition = completeMessageVariantRefresh(entry.refreshState);
    entry.refreshState = transition.state;
    if (transition.startNow) scheduleMessageVariantLoad(entry, MESSAGE_VARIANT_REFRESH_DEBOUNCE_MS);
  }
}

function notifyMessageVariantListeners(entry: MessageVariantCacheEntry): void {
  for (const listener of entry.listeners) listener(entry.variants);
}

function scheduleMessageVariantEntryEviction(entry: MessageVariantCacheEntry): void {
  if (entry.listeners.size > 0 || entry.evictionTimer !== null) return;
  entry.evictionTimer = window.setTimeout(() => {
    entry.evictionTimer = null;
    if (entry.listeners.size === 0) destroyMessageVariantCacheEntry(entry);
  }, 0);
}

function evictUnusedMessageVariantEntries(): void {
  if (messageVariantCache.size < MESSAGE_VARIANT_CACHE_LIMIT) return;
  const chatIds = selectMessageVariantCacheEvictions(
    Array.from(messageVariantCache.values()).map((entry) => ({
      chatId: entry.chatId,
      listenerCount: entry.listeners.size,
    })),
    MESSAGE_VARIANT_CACHE_LIMIT,
  );
  for (const chatId of chatIds) {
    const entry = messageVariantCache.get(chatId);
    if (entry) destroyMessageVariantCacheEntry(entry);
  }
}

function destroyMessageVariantCacheEntry(entry: MessageVariantCacheEntry): void {
  if (entry.disposed) return;
  entry.disposed = true;
  if (entry.debounceTimer !== null) window.clearTimeout(entry.debounceTimer);
  if (entry.evictionTimer !== null) window.clearTimeout(entry.evictionTimer);
  stopMessageVariantPolling(entry);
  messageVariantCache.delete(entry.chatId);
}

export function useAvatarVariantUrls(profileIds: readonly string[]): Record<string, AvatarVariantUrls> {
  const profileIdKey = useMemo(() => {
    const ids = new Set<string>();
    for (const id of profileIds) {
      if (id) ids.add(id);
    }
    return Array.from(ids).sort().join("|");
  }, [profileIds]);
  const normalizedProfileIds = useMemo(
    () => profileIdKey ? profileIdKey.split("|") : [],
    [profileIdKey],
  );
  const [variantsByProfileId, setVariantsByProfileId] = useState<Record<string, AvatarVariantUrls>>({});

  useEffect(() => {
    let cancelled = false;
    if (normalizedProfileIds.length === 0) {
      setVariantsByProfileId({});
      return () => {
        cancelled = true;
      };
    }

    const supabase = createClient();

    const loadVariants = async () => {
      const { data, error } = await supabase
        .from("media_variants")
        .select("id,profile_id,variant_kind,variant_bucket,variant_path,width,height,status")
        .eq("status", "ready")
        .in("variant_kind", [...AVATAR_VARIANT_KINDS])
        .in("profile_id", normalizedProfileIds);

      if (cancelled) return;
      if (error) {
        console.warn("Avatar variants fetch failed.");
        setVariantsByProfileId({});
        return;
      }

      const next: Record<string, AvatarVariantUrls> = {};
      for (const row of (data ?? []) as unknown as MediaVariant[]) {
        if (!row.profile_id) continue;
        const publicUrl = getVariantPublicUrl(supabase.storage, row);
        if (!publicUrl) continue;

        const current = next[row.profile_id] ?? {};
        if (row.variant_kind === "avatar_128") {
          current.avatar128Url = publicUrl;
          current.avatar128Width = row.width;
          current.avatar128Height = row.height;
        } else if (row.variant_kind === "avatar_256") {
          current.avatar256Url = publicUrl;
          current.avatar256Width = row.width;
          current.avatar256Height = row.height;
        }
        next[row.profile_id] = current;
      }

      setVariantsByProfileId(next);
    };

    void loadVariants();
    return () => {
      cancelled = true;
    };
  }, [profileIdKey]);

  return variantsByProfileId;
}
