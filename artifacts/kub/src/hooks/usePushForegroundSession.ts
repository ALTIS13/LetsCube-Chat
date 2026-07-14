"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";

const FOREGROUND_REFRESH_MS = 7_000;
const WARN_THROTTLE_MS = 60_000;
const CLIENT_ID_STORAGE_KEY = "kub:push-foreground-client-id";

interface ForegroundSessionRunner {
  userId: string;
  refCount: number;
  destroyTimer: ReturnType<typeof setTimeout> | null;
  setCurrentChatId: (chatId: string | null) => void;
  destroy: () => void;
}

let runner: ForegroundSessionRunner | null = null;
let runtimeClientId: string | null = null;
let lastWarnAt = 0;

function warnThrottled(operation: "touch" | "close", message: string): void {
  const now = Date.now();
  if (now - lastWarnAt < WARN_THROTTLE_MS) return;
  lastWarnAt = now;
  // No user, chat, token or push subscription identifiers belong in logs.
  // eslint-disable-next-line no-console
  console.warn(`foreground push session ${operation} failed: ${message}`);
}

function getRuntimeClientId(): string {
  if (runtimeClientId) return runtimeClientId;
  try {
    const stored = window.sessionStorage.getItem(CLIENT_ID_STORAGE_KEY);
    if (stored) {
      runtimeClientId = stored;
      return stored;
    }
  } catch {
    // A storage-restricted browser still gets an in-memory runtime id.
  }

  runtimeClientId = crypto.randomUUID();
  try {
    window.sessionStorage.setItem(CLIENT_ID_STORAGE_KEY, runtimeClientId);
  } catch {
    // Keep the in-memory id when sessionStorage is unavailable.
  }
  return runtimeClientId;
}

function startRunner(userId: string): ForegroundSessionRunner {
  const supabase = createClient();
  const clientId = getRuntimeClientId();
  let currentChatId = useAppStore.getState().selectedChatId;
  let destroyed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let mutationChain: Promise<void> = Promise.resolve();

  const clearTimer = (): void => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };

  const schedule = (): void => {
    clearTimer();
    if (destroyed || document.visibilityState !== "visible") return;
    timer = setTimeout(() => {
      timer = null;
      void touch();
    }, FOREGROUND_REFRESH_MS);
  };

  const enqueue = (
    operation: "touch" | "close",
    callback: () => PromiseLike<{ error: { message: string } | null }>,
  ): Promise<void> => {
    mutationChain = mutationChain.then(async () => {
      const { error } = await callback();
      if (error) warnThrottled(operation, error.message);
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      warnThrottled(operation, message);
    });
    return mutationChain;
  };

  const touch = (): Promise<void> => {
    if (
      destroyed ||
      document.visibilityState !== "visible" ||
      navigator.onLine === false
    ) {
      schedule();
      return Promise.resolve();
    }
    const chatIdAtEnqueue = currentChatId;
    const result = enqueue("touch", () => supabase.rpc(
      "push_foreground_session_touch",
      {
        p_client_id: clientId,
        p_current_chat_id: chatIdAtEnqueue,
      },
    ));
    void result.finally(schedule);
    return result;
  };

  const close = (): Promise<void> => enqueue("close", () => supabase.rpc(
    "push_foreground_session_close",
    { p_client_id: clientId },
  ));

  const handleVisibility = (): void => {
    clearTimer();
    if (document.visibilityState === "visible") {
      void touch();
    } else {
      void close();
    }
  };
  const handleOnline = (): void => {
    if (document.visibilityState === "visible") void touch();
  };
  const handleFocus = (): void => {
    if (document.visibilityState === "visible") void touch();
  };

  document.addEventListener("visibilitychange", handleVisibility);
  window.addEventListener("online", handleOnline);
  window.addEventListener("focus", handleFocus);
  void touch();

  return {
    userId,
    refCount: 1,
    destroyTimer: null,
    setCurrentChatId(chatId) {
      if (currentChatId === chatId) return;
      currentChatId = chatId;
      if (document.visibilityState === "visible") void touch();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimer();
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("focus", handleFocus);
      void close();
    },
  };
}

export function usePushForegroundSession(): void {
  const userId = useAppStore((state) => state.currentUser?.id ?? null);
  const selectedChatId = useAppStore((state) => state.selectedChatId);

  useEffect(() => {
    if (!userId) return;
    if (runner?.userId === userId) {
      if (runner.destroyTimer) {
        clearTimeout(runner.destroyTimer);
        runner.destroyTimer = null;
      }
      runner.refCount += 1;
    } else {
      runner?.destroy();
      runner = startRunner(userId);
    }

    return () => {
      if (!runner || runner.userId !== userId) return;
      runner.refCount -= 1;
      if (runner.refCount > 0) return;
      const candidate = runner;
      candidate.destroyTimer = setTimeout(() => {
        if (runner !== candidate || candidate.refCount > 0) return;
        candidate.destroy();
        runner = null;
      }, 0);
    };
  }, [userId]);

  useEffect(() => {
    if (runner?.userId === userId) {
      runner.setCurrentChatId(selectedChatId);
    }
  }, [selectedChatId, userId]);
}
