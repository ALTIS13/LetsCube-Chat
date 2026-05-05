"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";

/**
 * Manages Web Push subscription for the current user/device.
 *
 * State machine:
 *   – `unsupported`: this browser cannot do Web Push (Safari <16, etc.)
 *   – `denied`: the user has rejected Notification permission previously
 *   – `inactive`: permission ungranted or no subscription yet
 *   – `active`: a valid PushSubscription is registered both with the browser
 *     and stored in our `push_subscriptions` table
 *
 * Server side: the push-worker reads `push_subscriptions` and delivers via
 * the `web-push` library using a VAPID keypair.  The public half is exposed
 * to the client through `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
 */
export type PushStatus = "unsupported" | "denied" | "inactive" | "active";

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function usePush() {
  const { currentUser } = useAppStore();
  const supabase = createClient();
  const [status, setStatus] = useState<PushStatus>("inactive");

  // Detect browser support and starting state.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    // Check whether we already have an active subscription registered.
    navigator.serviceWorker.getRegistration("/sw.js").then(async (reg) => {
      if (!reg) { setStatus("inactive"); return; }
      const sub = await reg.pushManager.getSubscription();
      setStatus(sub ? "active" : "inactive");
    });
  }, []);

  // Listen for SW messages (notification click) — focus the requested chat.
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "kub-open" && typeof e.data.url === "string") {
        // Naive: navigate via location; the SPA's chat selection on mount
        // can read ?chat=… in a future iteration.
        if (typeof window !== "undefined") window.location.assign(e.data.url);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, []);

  const enable = useCallback(async () => {
    if (!currentUser) return;
    if (!VAPID_PUBLIC) {
      console.error("NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set");
      return;
    }
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      // Make sure the SW is active before subscribing.
      await navigator.serviceWorker.ready;

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "inactive");
        return;
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast: PushManager.subscribe expects BufferSource; Uint8Array<ArrayBufferLike>
        // satisfies that at runtime but TS's narrower BufferSource overload trips.
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as unknown as BufferSource,
      });

      const json = sub.toJSON();
      const endpoint = json.endpoint!;
      const p256dh = json.keys?.p256dh ?? "";
      const auth = json.keys?.auth ?? "";

      // Upsert on endpoint so re-enabling on the same device doesn't create
      // duplicate rows.
      const { error } = await supabase
        .from("push_subscriptions")
        .upsert(
          {
            user_id: currentUser.id,
            endpoint,
            p256dh,
            auth,
            user_agent: navigator.userAgent,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "endpoint" },
        );
      if (error) { console.error("save subscription:", error); return; }

      setStatus("active");
    } catch (e) {
      console.error("push enable error:", e);
    }
  }, [currentUser, supabase]);

  const disable = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        await sub.unsubscribe();
      }
      setStatus("inactive");
    } catch (e) {
      console.error("push disable error:", e);
    }
  }, [supabase]);

  return { status, enable, disable };
}
