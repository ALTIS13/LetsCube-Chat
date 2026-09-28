"use client";

import { useEffect } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { isNativeAndroid } from "@/lib/platform/capabilities";
import { CONNECTION_REVIVED_EVENT, createRealtimeRevival } from "@/lib/realtimeRevival";
import { createClient, cutStrandedReads } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";

/**
 * The application's answer to a change of network under it (tracker item 53).
 *
 * «Если меняется IP… приходится перезапускать мессенджер» — switching a VPN off
 * to open another app left the messenger dead until it was restarted. What a
 * restart did was two things this hook now does without one: it dropped the
 * requests stranded on the old route, and it opened a new socket.
 *
 * The moments of doubt, each of which can follow a change of route:
 * - `online`, the browser's own report;
 * - the Network Information API's `change`, which Android's WebView raises on a
 *   switch between Wi-Fi, mobile data and a VPN even when `online` never
 *   fires — the case in the report;
 * - coming back to the foreground: the change usually happened while the
 *   person was in the other app, which is what they left us for.
 *
 * On each, the reads stranded on the old route are cut (`deadlineFetch.ts`),
 * and the socket is asked whether it is alive (`realtimeRevival.ts`). When
 * either finds something dead, `CONNECTION_REVIVED_EVENT` makes the chat list
 * and the open conversation refetch, as a return from offline always has.
 */
export function useConnectionRevival(): void {
  const userId = useAppStore((state) => state.currentUser?.id ?? null);

  useEffect(() => {
    if (!userId) return undefined;
    const realtime = createClient().realtime;
    const revived = () => window.dispatchEvent(new Event(CONNECTION_REVIVED_EVENT));
    const revival = createRealtimeRevival(realtime, { onReplaced: revived });
    realtime.onHeartbeat((status) => revival.heartbeat(status));

    const doubt = () => {
      const cut = cutStrandedReads();
      revival.doubt();
      if (cut > 0) revived();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") doubt();
    };
    const connection = (navigator as Navigator & { connection?: EventTarget }).connection;

    window.addEventListener("online", doubt);
    document.addEventListener("visibilitychange", onVisibility);
    connection?.addEventListener?.("change", doubt);
    // Android's own foreground signal. Only there: on the web Capacitor derives
    // the same event from `visibilitychange`, which is already listened to. And
    // only where the plugin is really registered — a shell without it rejects
    // the registration, and an unhandled rejection is a crash report.
    const appState =
      isNativeAndroid() && Capacitor.isPluginAvailable("App")
        ? App.addListener("appStateChange", ({ isActive }) => {
            if (isActive) doubt();
          }).catch(() => null)
        : null;

    return () => {
      window.removeEventListener("online", doubt);
      document.removeEventListener("visibilitychange", onVisibility);
      connection?.removeEventListener?.("change", doubt);
      void appState?.then((handle) => handle?.remove()).catch(() => undefined);
      revival.dispose();
      realtime.onHeartbeat(() => {});
    };
  }, [userId]);
}
