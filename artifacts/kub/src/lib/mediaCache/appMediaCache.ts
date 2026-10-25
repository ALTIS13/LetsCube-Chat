import { offlineHistory } from "@/lib/historyCache/appOfflineHistory";
import { messageMediaObjectRef, type MediaObjectRefMessage } from "@/lib/media/mediaObjectRef";
import { signedMediaUrls } from "@/lib/media/mediaUrl";
import { createMediaCache, type MediaCacheScope } from "./cache";
import { browserMediaCacheStorage } from "./storage";
import { createMediaLoader } from "./loader";
import { mediaObjectUrls } from "./objectUrls";

export type CacheableMessage = MediaObjectRefMessage & { chat_id?: string; deleted_at?: string | null };
export type MediaRepresentation = "original" | "preview" | "poster" | "playback";
const backend = import.meta.env.VITE_SUPABASE_URL ?? "unconfigured";
export const mediaCache = createMediaCache({ storage: browserMediaCacheStorage() });
const listeners = new Set<() => void>();
const retirementListeners = new Set<(event: { partition: string; chatId: string | null }) => void>();
const holds = new Set<{ scope: MediaCacheScope; abort: AbortController; releases: Set<() => void> }>();
const generations = new Map<string, number>();
let revision = 0;
const notify = () => { revision++; for (const listener of listeners) listener(); };
const identityKey = () => {
  const identity = offlineHistory.identity();
  return identity ? JSON.stringify([backend, identity.userId, identity.sessionId]) : null;
};
let partition = identityKey();
const key = (scope: MediaCacheScope) => JSON.stringify([scope.partition, scope.chatId]);
const stamp = (scope: MediaCacheScope) => `${generations.get(scope.partition) ?? 0}:${generations.get(key(scope)) ?? 0}`;

function retire(owner: string, chatId?: string, privacy = true) {
  const generationKey = chatId === undefined ? owner : JSON.stringify([owner, chatId]);
  generations.set(generationKey, (generations.get(generationKey) ?? 0) + 1);
  for (const held of holds) {
    if (held.scope.partition !== owner || (chatId !== undefined && held.scope.chatId !== chatId)) continue;
    held.abort.abort();
    for (const release of held.releases) release();
    held.releases.clear();
  }
  if (privacy) {
    mediaObjectUrls.retire(owner, chatId);
    for (const listener of retirementListeners) listener({ partition: owner, chatId: chatId ?? null });
  }
  // The storage service fences producers synchronously, then awaits its transaction.
  const pending = mediaCache.retire(owner, chatId);
  notify();
  return pending;
}

offlineHistory.subscribe(chatId => {
  const next = identityKey(), previous = partition;
  partition = next;
  if (previous !== next) {
    if (previous) void retire(previous).catch(() => {});
    notify();
  } else if (next) void retire(next, chatId ?? undefined).catch(() => {});
});

// Settings-only cache retirement also crosses documents; it never carries a URL.
const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("kub-media-cache-retirement-v1");
if (channel) channel.onmessage = event => {
  if (partition && event.data?.partition === partition && event.data?.kind === "clear") void retire(partition, undefined, false).catch(() => {});
};
signedMediaUrls().subscribe(() => {
  const refusedChats = new Set<string>();
  for (const held of holds) {
    if (held.scope.partition === partition && !held.abort.signal.aborted && signedMediaUrls().isRefused(held.scope)) {
      refusedChats.add(held.scope.chatId);
    }
  }
  for (const chatId of refusedChats) void offlineHistory.capture()?.invalidateChat(chatId);
});
const loader = createMediaLoader({
  cache: mediaCache, backend, fetch: (...args) => globalThis.fetch(...args), onStored: notify,
  onRefused: scope => {
    if (scope.partition === partition) void offlineHistory.capture()?.invalidateChat(scope.chatId);
  },
});

export const managedMedia = {
  partition: () => partition,
  subscribeRetirement(listener: (event: { partition: string; chatId: string | null }) => void) {
    retirementListeners.add(listener); return () => { retirementListeners.delete(listener); };
  },
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  revision: () => revision,
  scope(message: CacheableMessage | null | undefined, representation: MediaRepresentation): MediaCacheScope | null {
    const ref = messageMediaObjectRef(message);
    if (!partition || !message?.chat_id || message.deleted_at || !ref || signedMediaUrls().isRefused(ref)) return null;
    return { partition, chatId: message.chat_id, ...ref, version: representation };
  },
  hold(scope: MediaCacheScope) {
    const at = stamp(scope);
    const held = { scope, abort: new AbortController(), releases: new Set<() => void>() };
    holds.add(held);
    const current = () => partition === scope.partition && stamp(scope) === at && !held.abort.signal.aborted;
    return {
      current,
      async load(address: string | null, download: boolean, maxBytes?: number) {
        const blob = await loader.load(scope, address, { download, maxBytes, signal: held.abort.signal, isCurrent: current });
        if (!blob || !current()) return null;
        const lease = mediaObjectUrls.create(blob, scope); held.releases.add(lease.release); return lease.url;
      },
      release() {
        held.abort.abort(); for (const release of held.releases) release();
        held.releases.clear(); holds.delete(held);
      },
    };
  },
  async stats() {
    const owner = partition; if (!owner) return null;
    const result = await mediaCache.stats(owner); return owner === partition ? result : null;
  },
  async clear() {
    const owner = partition; if (!owner) return false;
    channel?.postMessage({ partition: owner, kind: "clear" });
    await retire(owner, undefined, false); return owner === partition;
  },
  async setLimit(bytes: number) {
    const owner = partition; if (!owner) return false;
    const result = await mediaCache.setLimit(owner, bytes); notify(); return result && owner === partition;
  },
};

const playingDownloads = new Map<string, Promise<void>>();
/** A user-started stream may finish warming the disk without replacing its src. */
export function cachePlayedMedia(message: CacheableMessage, address: string | null, representation: "original" | "playback" = "original") {
  const scope = managedMedia.scope(message, representation);
  if (!scope || !address || address.startsWith("blob:")) return;
  const id = JSON.stringify(scope);
  if (playingDownloads.has(id)) return;
  const held = managedMedia.hold(scope);
  const task = held.load(address, true).then(() => {}).catch(() => {}).finally(() => {
    held.release(); if (playingDownloads.get(id) === task) playingDownloads.delete(id);
  });
  playingDownloads.set(id, task);
}
