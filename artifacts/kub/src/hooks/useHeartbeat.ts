"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import { bumpHeartbeat, setHeartbeatActive } from "@/lib/dev/instrumentation";
import { usePrivacyPreferences } from "@/hooks/usePrivacyPreferences";
import {
  lastActivityIso,
  onOwnStatusChange,
  useOwnPresence,
  useOwnPresenceRuntime,
} from "@/hooks/useOwnPresence";
import { presencePublished, statusUntilMs } from "@/lib/presenceStatus";

const HEARTBEAT_MS = 60_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const WARN_THROTTLE_MS = 60_000;

/**
 * Keeps `profiles.online_at` fresh for the current user.
 *
 * Since 2026-09-30 (tracker item 37) a beat is `presence_beat`, which reports
 * when this person last did something here and lets the database publish
 * `online_at` and the status from every device's report and the person's own
 * choices. It refuses to publish somebody who has turned presence off or chosen
 * «Невидимый», whatever a client sends.
 *
 * Task #48 hardening:
 *   – module-level singleton: один интервал на пользователя, даже если хук
 *     случайно смонтирован в нескольких местах (ref-counting);
 *   – `lastPingAt`-throttle: реальный пинг не чаще раза в HEARTBEAT_MS,
 *     даже если эффект перезапустился или visibility-обработчик дёрнулся;
 *     восстановление сети намеренно обходит throttle один раз;
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
  let pingInFlight: Promise<void> | null = null;

  const ping = (force = false): Promise<void> => {
    if (cancelled) return Promise.resolve();
    if (pingInFlight) {
      return force ? pingInFlight.then(() => ping(true)) : pingInFlight;
    }
    const now = Date.now();
    // Защитный throttle на случай гонки visibility/timer.
    if (!force && now - lastPingAt < HEARTBEAT_MS - 1_000) {
      return Promise.resolve();
    }
    lastPingAt = now;
    bumpHeartbeat();
    pingInFlight = (async () => {
      try {
        const { error } = await supabase.rpc("presence_beat", { p_active_at: lastActivityIso() });
        if (error) throw new Error(error.message);
        backoffMs = HEARTBEAT_MS;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnThrottled(`heartbeat update failed: ${msg}`);
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      }
    })().finally(() => {
      pingInFlight = null;
    });
    return pingInFlight;
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

  const handleOnline = (): void => {
    if (cancelled || document.visibilityState !== "visible") return;
    backoffMs = HEARTBEAT_MS;
    void ping(true).then(() => schedule(backoffMs));
  };

  // Back from idle, or a chosen status running out: others see it now, not at
  // the next minute.
  const handleOwnStatusChange = (): void => {
    if (cancelled || document.visibilityState !== "visible") return;
    void ping(true).then(() => schedule(backoffMs));
  };

  if (document.visibilityState === "visible") {
    void ping().then(() => schedule(backoffMs));
  }
  document.addEventListener("visibilitychange", handleVisibility);
  window.addEventListener("online", handleOnline);
  const stopWatchingOwnStatus = onOwnStatusChange(handleOwnStatusChange);

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
      window.removeEventListener("online", handleOnline);
      stopWatchingOwnStatus();
    },
  };
}

export function useHeartbeat(): void {
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const privacy = usePrivacyPreferences();
  // Someone who has turned presence off is not published at all: the heartbeat
  // does not run, so nothing is stored for anyone to read. Hiding the value in
  // one interface while still writing it would not be privacy. «Невидимый»
  // stops it too (tracker item 37), and only an answer that is this account's
  // may start it — see `presencePublished`.
  useOwnPresenceRuntime(userId);
  // Subscribed so that a chosen «Невидимый» running out starts the beat again.
  useOwnPresence();
  const publishing = presencePublished({
    userId,
    answerFor: privacy.userId,
    loading: privacy.loading,
    presenceVisible: privacy.preferences.presenceVisible,
    manual: privacy.preferences.manualStatus,
    until: statusUntilMs(privacy.preferences.manualStatusUntil),
    now: Date.now(),
  });

  useEffect(() => {
    if (!userId || !publishing) {
      // Stop an already-running heartbeat when the preference turns off.
      if (runner) {
        runner.cleanup();
        runner = null;
        setHeartbeatActive(0);
      }
      return;
    }
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
  }, [userId, publishing]);
}
