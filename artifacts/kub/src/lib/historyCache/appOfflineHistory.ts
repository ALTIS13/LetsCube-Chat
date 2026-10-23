import { createOfflineHistory } from "./offline";
import { browserHistoryCacheStorage } from "./storage";

// Public backend identity only. No client/service key is part of a cache key.
export const offlineHistory = createOfflineHistory({
  storage: browserHistoryCacheStorage(),
  namespace: import.meta.env.VITE_SUPABASE_URL ?? "unconfigured",
});

// Only invalidation metadata crosses documents, never message bodies or tokens.
if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
  const channel = new BroadcastChannel("kub-offline-history-retirement-v1");
  let receiving = false;
  channel.onmessage = event => {
    receiving = true;
    try { offlineHistory.receiveRetirement(event.data); } finally { receiving = false; }
  };
  offlineHistory.subscribe((chatId, broadcast) => {
    const identity = offlineHistory.identity();
    if (!receiving && broadcast && identity) channel.postMessage({ ...identity, chatId });
  });
}
