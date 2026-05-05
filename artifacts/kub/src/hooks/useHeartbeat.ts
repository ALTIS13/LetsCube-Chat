"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import { bumpHeartbeat, setHeartbeatActive } from "@/lib/dev/instrumentation";

const HEARTBEAT_MS = 60_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const WARN_THROTTLE_MS = 60_000;

/**
 * Keeps `profiles.online_at` fresh for the current user.
 *
 * Task #48 hardening:
 *   – module-level singleton: один интервал на пользователя, даже если хук
 *     случайно смонтирован в нескольких местах (ref-counting);
 *   – `lastPingAt`-throttle: реальный пинг не чаще раза в HEARTBEAT_MS,
 *     даже если эффект перезапустился или visibility-обработчик дёрнулся;
 *   – exponential backoff (30s → 60s → 120s → cap 5 min) при сетевом сбое,
 *     счётчик сбрасывается после успешного запроса;
 *   – throttled `console.warn` (1 раз в WARN_THROTTLE_MS), чтобы лавина
 *     `Failed to fetch` не забивала консоль;
 *   – пинги паузятся пока вкладка скрыта, ничего не флашим на pagehide
 *     (раньше pagehide-flush спамил, особенно в iframe-preview Replit).
 */

interface HeartbeatRunner {
  userId: string;
  refCount: number;
  cleanup: () => void;
}

let runner: HeartbeatRunner | null = null;
let lastWarnAt = 0;

function warnThrottled(msg: string): void {
  const now = Date.now();
  if (now - lastWarnAt < WARN_THROTTLE_MS) return;
  lastWarnAt = now;
  // eslint-disable-next-line no-console
  console.warn(msg);
}

function startRunner(userId: string): HeartbeatRunner {
  const supabase = createClient();
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastPingAt = 0;
  let backoffMs = HEARTBEAT_MS;

  const ping = async (): Promise<void> => {
    if (cancelled) return;
    const now = Date.now();
    // Защитный throttle на случай гонки visibility/timer.
    if (now - lastPingAt < HEARTBEAT_MS - 1_000) return;
    lastPingAt = now;
    bumpHeartbeat();
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ online_at: new Date().toISOString() })
        .eq("id", userId);
      if (error) throw new Error(error.message);
      backoffMs = HEARTBEAT_MS;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnThrottled(`heartbeat update failed: ${msg}`);
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    }
  };

  const schedule = (delay: number): void => {
    if (cancelled) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (cancelled) return;
      if (document.visibilityState === "visible") {
        void ping().then(() => schedule(backoffMs));
      } else {
        // Скрыли вкладку до тика — ничего не делаем; visibility-обработчик
        // перепланирует пинг при возврате.
      }
    }, delay);
  };

  const handleVisibility = (): void => {
    if (cancelled) return;
    if (document.visibilityState === "visible") {
      const sinceLast = Date.now() - lastPingAt;
      if (sinceLast >= HEARTBEAT_MS) {
        void ping().then(() => schedule(backoffMs));
      } else {
        schedule(HEARTBEAT_MS - sinceLast);
      }
    } else if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  if (document.visibilityState === "visible") {
    void ping().then(() => schedule(backoffMs));
  }
  document.addEventListener("visibilitychange", handleVisibility);

  return {
    userId,
    refCount: 1,
    cleanup: () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      document.removeEventListener("visibilitychange", handleVisibility);
    },
  };
}

export function useHeartbeat(): void {
  const userId = useAppStore((s) => s.currentUser?.id ?? null);

  useEffect(() => {
    if (!userId) return;
    if (runner && runner.userId === userId) {
      runner.refCount += 1;
    } else {
      if (runner) {
        runner.cleanup();
        runner = null;
      }
      runner = startRunner(userId);
    }
    setHeartbeatActive(runner ? 1 : 0);
    return () => {
      if (!runner) return;
      runner.refCount -= 1;
      if (runner.refCount <= 0) {
        runner.cleanup();
        runner = null;
        setHeartbeatActive(0);
      }
    };
  }, [userId]);
}
