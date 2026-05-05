"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";

const HEARTBEAT_MS = 30_000;

/**
 * Keeps profiles.online_at fresh for the current user.
 *
 * Strategy:
 *   – on mount (and on each interval tick) UPDATE profiles SET online_at = now()
 *   – pause while the tab is hidden (saves both DB roundtrips and battery)
 *   – on `pagehide` / `beforeunload` send a final blunt update so the row
 *     accurately reflects "last seen" — useful when the user closes the tab
 *
 * The hook is fire-and-forget — it does not return anything.  Mount it once
 * near the root of the authenticated UI (we call it from providers).
 */
export function useHeartbeat() {
  const { currentUser } = useAppStore();
  const supabase = createClient();
  const userIdRef = useRef<string | null>(null);
  userIdRef.current = currentUser?.id ?? null;

  useEffect(() => {
    if (!currentUser) return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const ping = async () => {
      const id = userIdRef.current;
      if (!id || cancelled) return;
      // Fire-and-forget; transient errors (e.g. brief offline) are not worth
      // surfacing to the user — the next tick will catch up.
      const { error } = await supabase
        .from("profiles")
        .update({ online_at: new Date().toISOString() })
        .eq("id", id);
      if (error) console.warn("heartbeat update failed:", error.message);
    };

    const start = () => {
      if (timer) return;
      ping();
      timer = setInterval(ping, HEARTBEAT_MS);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", handleVisibility);

    // Best-effort final ping on tab close / navigation away.
    const flush = () => { ping(); };
    window.addEventListener("pagehide", flush);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, [currentUser, supabase]);
}
