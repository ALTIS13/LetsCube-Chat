export interface MessageVariantSource {
  id: string;
  chat_id?: string | null;
  type: string;
  media_url: string | null;
  deleted_at: string | null;
}

export interface MessageVariantRefreshState {
  messageIds: string[];
  loading: boolean;
  reloadPending: boolean;
}

export interface MessageVariantRefreshTransition {
  state: MessageVariantRefreshState;
  startNow: boolean;
}

export interface MessageVariantCacheCandidate {
  chatId: string;
  listenerCount: number;
}

export interface MessageVariantRefreshTimer {
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(timerId: number): void;
  setInterval(callback: () => void, delay: number): number;
  clearInterval(timerId: number): void;
}

export interface MessageVariantRefreshEventTarget {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface MessageVariantRefreshLifecycle {
  start(): void;
  stop(): void;
}

export function getMessageVariantCacheKey(messages: readonly MessageVariantSource[]): string | null {
  const chatIds = new Set(messages.map((message) => message.chat_id).filter((chatId): chatId is string => Boolean(chatId)));
  return chatIds.size === 1 ? Array.from(chatIds)[0] : null;
}

export function getMessageVariantSourceIds(messages: readonly MessageVariantSource[]): string[] {
  const ids = new Set<string>();
  for (const message of messages) {
    if (
      (message.type === "image" || message.type === "video") &&
      message.media_url &&
      !message.deleted_at &&
      !message.id.startsWith("tmp:")
    ) {
      ids.add(message.id);
    }
  }
  return Array.from(ids).sort();
}

export function hasVideoVariantSources(messages: readonly MessageVariantSource[]): boolean {
  return messages.some((message) => (
    message.type === "video" &&
    message.media_url &&
    !message.deleted_at &&
    !message.id.startsWith("tmp:")
  ));
}

export function queueMessageVariantRefresh(
  state: MessageVariantRefreshState,
  messageIds: readonly string[],
): MessageVariantRefreshTransition {
  const nextMessageIds = Array.from(new Set(messageIds)).sort();
  if (sameMessageIds(state.messageIds, nextMessageIds)) {
    return { state, startNow: false };
  }
  if (state.loading) {
    return {
      state: {
        messageIds: nextMessageIds,
        loading: true,
        reloadPending: true,
      },
      startNow: false,
    };
  }
  return {
    state: {
      messageIds: nextMessageIds,
      loading: false,
      reloadPending: false,
    },
    startNow: nextMessageIds.length > 0,
  };
}

export function beginMessageVariantRefresh(state: MessageVariantRefreshState): MessageVariantRefreshState {
  return { ...state, loading: true };
}

export function completeMessageVariantRefresh(state: MessageVariantRefreshState): MessageVariantRefreshTransition {
  return {
    state: {
      ...state,
      loading: false,
      reloadPending: false,
    },
    startNow: state.reloadPending && state.messageIds.length > 0,
  };
}

export function selectMessageVariantCacheEvictions(
  entries: readonly MessageVariantCacheCandidate[],
  cacheLimit: number,
): string[] {
  const removalCount = Math.max(0, entries.length - cacheLimit + 1);
  if (removalCount === 0) return [];
  return entries
    .filter((entry) => entry.listenerCount === 0)
    .slice(0, removalCount)
    .map((entry) => entry.chatId);
}

export function createMessageVariantRefreshLifecycle({
  windowTarget,
  documentTarget,
  getVisibilityState,
  timer,
  intervalMs,
  tabReturnDebounceMs,
  onRefresh,
}: {
  windowTarget: MessageVariantRefreshEventTarget;
  documentTarget: MessageVariantRefreshEventTarget;
  getVisibilityState: () => string;
  timer: MessageVariantRefreshTimer;
  intervalMs: number;
  tabReturnDebounceMs: number;
  onRefresh: () => void;
}): MessageVariantRefreshLifecycle {
  let intervalId: number | null = null;
  let tabReturnTimerId: number | null = null;
  let started = false;

  const refreshOnTabReturn = () => {
    if (getVisibilityState() !== "visible" || tabReturnTimerId !== null) return;
    tabReturnTimerId = timer.setTimeout(() => {
      tabReturnTimerId = null;
      onRefresh();
    }, tabReturnDebounceMs);
  };

  return {
    start() {
      if (started) return;
      started = true;
      intervalId = timer.setInterval(onRefresh, intervalMs);
      windowTarget.addEventListener("focus", refreshOnTabReturn);
      documentTarget.addEventListener("visibilitychange", refreshOnTabReturn);
    },
    stop() {
      if (!started) return;
      started = false;
      if (intervalId !== null) timer.clearInterval(intervalId);
      if (tabReturnTimerId !== null) timer.clearTimeout(tabReturnTimerId);
      intervalId = null;
      tabReturnTimerId = null;
      windowTarget.removeEventListener("focus", refreshOnTabReturn);
      documentTarget.removeEventListener("visibilitychange", refreshOnTabReturn);
    },
  };
}

function sameMessageIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
