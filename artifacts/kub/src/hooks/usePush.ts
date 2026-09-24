"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { mapPgError } from "@/lib/errors";
import { requestChatMessageJump } from "@/lib/chatJumpEvents";
import { safeOpenChat } from "@/lib/safeOpenChat";
import { chatAddressPath } from "@/lib/chatRoute";
import { isNativeAndroid, isNativeApp, nativePushPendingMessage, supportsBrowserPush } from "@/lib/platform/capabilities";
import { BROWSER_PUSH_UNAVAILABLE, PUSH_UNAVAILABLE } from "@/lib/plainMessages";
import { isDesktopApp } from "@/lib/platform/desktop";
import { registerDesktopNotificationNavigationListener } from "@/lib/platform/desktopNotifications";
import {
  getNativePushPermissionStatus,
  registerNativePushNavigationListeners,
  type NativePushResult,
} from "@/lib/platform/nativePush";
import {
  disableNativeVoicePush, enableNativeVoicePush, isCurrentNativeVoiceContext,
  nativeVoiceContext, nativeVoicePushSnapshot, subscribeNativeVoicePush,
} from "@/lib/platform/nativeVoiceCalls";
import {
  applicationServerKeyMatches,
  browserSubscriptionRecord,
  urlBase64ToUint8Array,
} from "@/lib/browserPushSubscription";
import { createDeferredPushTargetHandler } from "@/lib/pushNavigationQueue";
import {
  persistPushPreferenceState,
  type PushPreferenceState,
} from "@/lib/pushPreferences";
import { useAppStore } from "@/store/app.store";

/**
 * Manages Web Push subscription for the current user/device.
 *
 * State machine:
 *   – `unsupported`: this browser cannot do Web Push (Safari <16, etc.)
 *   – `denied`: the user has rejected Notification permission previously
 *   – `missing_vapid`: frontend build has no public VAPID key
 *   – `migration_missing`: DB preference tables are not applied yet
 *   – `inactive`: permission ungranted or no subscription yet
 *   – `active`: a valid PushSubscription is registered both with the browser
 *     and stored in our `push_subscriptions` table
 *
 * Server side: the push-worker reads `push_subscriptions` and delivers via
 * the `web-push` library using a VAPID keypair.  The public half is exposed
 * to the client through `VITE_VAPID_PUBLIC_KEY`.
 */
export type PushStatus = "unsupported" | "native_unavailable" | "denied" | "missing_vapid" | "migration_missing" | "inactive" | "active";

export type PushPreferences = PushPreferenceState;

export type PushPreferenceKey = keyof Omit<PushPreferences, "push_enabled">;

const VAPID_PUBLIC = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? "";
const DEFAULT_PREFERENCES: PushPreferences = {
  push_enabled: false,
  message_push_enabled: true,
  task_push_enabled: true,
  invite_push_enabled: true,
};

export function usePush() {
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const supabase = createClient();
  const [status, setStatus] = useState<PushStatus>("inactive");
  const [preferences, setPreferences] = useState<PushPreferences>(DEFAULT_PREFERENCES);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [loadingPreferences, setLoadingPreferences] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const browserReconcileInFlightRef = useRef(false);
  const browserLastReconciledAtRef = useRef(0);

  // D-132 (settings-profile F2). This said a database update was needed, to a
  // person who cannot apply one. The status is unchanged — `migration_missing`
  // is still how the rest of the hook and the settings row know what happened —
  // and the sentence now describes the situation instead of the repair.
  const markMigrationMissing = useCallback(() => {
    console.error("push preferences storage is not available on this deployment");
    setStatus("migration_missing");
    setMessage(PUSH_UNAVAILABLE);
  }, []);

  const loadPreferences = useCallback(async () => {
    if (!userId) {
      setPreferencesLoaded(false);
      return;
    }
    setPreferencesLoaded(false);
    setLoadingPreferences(true);
    const { data, error } = await supabase
      .from("notification_preferences")
      .select("push_enabled, message_push_enabled, task_push_enabled, invite_push_enabled")
      .eq("user_id", userId)
      .maybeSingle();
    setLoadingPreferences(false);
    setPreferencesLoaded(true);

    if (error) {
      setPreferencesLoaded(false);
      if (looksLikeSchemaMissing(error)) {
        markMigrationMissing();
        return;
      }
      setMessage(mapPgError(error));
      return;
    }

    setPreferences({
      ...DEFAULT_PREFERENCES,
      ...(data ?? {}),
    });
    setMessage(null);
  }, [markMigrationMissing, supabase, userId]);

  // Detect browser support and starting state.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isNativeAndroid()) {
      setStatus("native_unavailable");
      setMessage(nativePushPendingMessage());
      void getNativePushPermissionStatus().then((result) => {
        const latest = nativeVoicePushSnapshot() ?? result;
        setStatus(normalizeNativeStatus(latest));
        setMessage(latest.message);
      });
      return;
    }
    if (isDesktopApp()) {
      setStatus("native_unavailable");
      setMessage("Уведомления Windows работают, пока LETSCUBE запущен. Доставка после полного выхода будет подключена позже.");
      return;
    }
    if (isNativeApp()) {
      setStatus("native_unavailable");
      setMessage("Native push пока настроен только для Android-приложения.");
      return;
    }
    if (!supportsBrowserPush()) {
      setStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    if (!VAPID_PUBLIC) {
      // D-132 (F2): the VAPID key is a build secret, not something a reader
      // configures. The name of it goes to the log.
      console.error("browser push is unconfigured: VAPID public key is absent");
      setStatus("missing_vapid");
      setMessage(BROWSER_PUSH_UNAVAILABLE);
      return;
    }
    setStatus("inactive");
  }, []);

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences]);

  useEffect(() => {
    if (!isNativeAndroid()) return;
    const update = () => {
      const result = nativeVoicePushSnapshot();
      if (!result) return;
      setStatus(normalizeNativeStatus(result));
      setMessage(result.message);
    };
    update();
    return subscribeNativeVoicePush(update);
  }, []);

  const reconcileBrowserSubscription = useCallback(async (force = false) => {
    if (!userId || !preferencesLoaded || isNativeApp() || !supportsBrowserPush() || !VAPID_PUBLIC) return;
    if (browserReconcileInFlightRef.current) return;
    const now = Date.now();
    if (!force && now - browserLastReconciledAtRef.current < 60_000) return;

    browserReconcileInFlightRef.current = true;
    browserLastReconciledAtRef.current = now;
    try {
      if (Notification.permission === "denied") {
        setStatus("denied");
        return;
      }
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      if (!subscription) {
        setStatus("inactive");
        if (preferences.push_enabled) {
          setMessage("Push-подписка этого устройства неактивна. Включите уведомления повторно.");
        }
        return;
      }

      const keyMatches = applicationServerKeyMatches(subscription, VAPID_PUBLIC);
      if (keyMatches === false) {
        await supabase
          .from("push_subscriptions")
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq("user_id", userId)
          .eq("endpoint", subscription.endpoint);
        await subscription.unsubscribe();
        setStatus("inactive");
        setMessage("Ключ push-подписки обновился. Включите уведомления повторно.");
        return;
      }

      if (!preferences.push_enabled) {
        setStatus("inactive");
        return;
      }

      const { error } = await supabase
        .from("push_subscriptions")
        .upsert(
          browserSubscriptionRecord(subscription, userId, navigator.userAgent, getPlatform()),
          { onConflict: "user_id,endpoint" },
        );
      if (error) {
        if (looksLikeSchemaMissing(error)) markMigrationMissing();
        else {
          setStatus("inactive");
          setMessage(mapPgError(error));
        }
        return;
      }
      setStatus("active");
      setMessage(null);
    } catch (error) {
      setStatus("inactive");
      setMessage(mapPgError(error));
    } finally {
      browserReconcileInFlightRef.current = false;
    }
  }, [markMigrationMissing, preferences.push_enabled, preferencesLoaded, supabase, userId]);

  useEffect(() => {
    void reconcileBrowserSubscription(true);
  }, [reconcileBrowserSubscription]);

  useEffect(() => {
    if (isNativeApp() || !supportsBrowserPush()) return;
    const reconcile = () => void reconcileBrowserSubscription(false);
    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === "KUB_PUSH_SUBSCRIPTION_CHANGED") {
        void reconcileBrowserSubscription(true);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") reconcile();
    };
    window.addEventListener("focus", reconcile);
    window.addEventListener("online", reconcile);
    document.addEventListener("visibilitychange", onVisibility);
    navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage);
    return () => {
      window.removeEventListener("focus", reconcile);
      window.removeEventListener("online", reconcile);
      document.removeEventListener("visibilitychange", onVisibility);
      navigator.serviceWorker.removeEventListener("message", handleServiceWorkerMessage);
    };
  }, [reconcileBrowserSubscription]);

  const enable = useCallback(async () => {
    if (isNativeAndroid()) {
      setStatus("native_unavailable");
      setMessage("Регистрируем Android push...");
      const operation = enableNativeVoicePush();
      const owner = nativeVoiceContext();
      const result = await operation;
      if (!isCurrentNativeVoiceContext(owner)) return;
      if (result.status === "native_active") {
        const preferenceError = await persistPushPreferenceState(
          supabase as unknown as Parameters<typeof persistPushPreferenceState>[0],
          owner!.recipientId,
          preferences,
          true,
        );
        if (!isCurrentNativeVoiceContext(owner)) return;
        if (preferenceError) {
          void disableNativeVoicePush();
          if (looksLikeSchemaMissing(preferenceError)) markMigrationMissing();
          else {
            setStatus("native_unavailable");
            setMessage(mapPgError(preferenceError));
          }
          return;
        }
      }
      setStatus(normalizeNativeStatus(result));
      setMessage(result.message);
      if (result.status === "native_active") {
        setPreferences((prev) => ({ ...prev, push_enabled: true }));
      }
      return;
    }
    if (!userId) return;
    if (isNativeApp()) {
      setStatus("native_unavailable");
      setMessage(nativePushPendingMessage());
      return;
    }
    if (!VAPID_PUBLIC) {
      // D-132 (F2): the VAPID key is a build secret, not something a reader
      // configures. The name of it goes to the log.
      console.error("browser push is unconfigured: VAPID public key is absent");
      setStatus("missing_vapid");
      setMessage(BROWSER_PUSH_UNAVAILABLE);
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

      let sub = await reg.pushManager.getSubscription();
      if (sub && applicationServerKeyMatches(sub, VAPID_PUBLIC) === false) {
        await supabase
          .from("push_subscriptions")
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq("user_id", userId)
          .eq("endpoint", sub.endpoint);
        await sub.unsubscribe();
        sub = null;
      }
      sub ??= await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast: PushManager.subscribe expects BufferSource; Uint8Array<ArrayBufferLike>
        // satisfies that at runtime but TS's narrower BufferSource overload trips.
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as unknown as BufferSource,
      });

      // Upsert on user+endpoint so re-enabling on the same device does not
      // create duplicate rows and the same browser endpoint cannot be moved
      // between users accidentally.
      const { error } = await supabase
        .from("push_subscriptions")
        .upsert(
          browserSubscriptionRecord(sub, userId, navigator.userAgent, getPlatform()),
          { onConflict: "user_id,endpoint" },
        );
      if (error) {
        if (looksLikeSchemaMissing(error)) {
          markMigrationMissing();
          return;
        }
        setMessage(mapPgError(error));
        return;
      }

      const { error: preferenceError } = await supabase
        .from("notification_preferences")
        .upsert(
          {
            user_id: userId,
            ...preferences,
            push_enabled: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
      if (preferenceError) {
        if (looksLikeSchemaMissing(preferenceError)) {
          markMigrationMissing();
          return;
        }
        setMessage(mapPgError(preferenceError));
        return;
      }

      setPreferences((prev) => ({ ...prev, push_enabled: true }));
      setMessage("Push-уведомления включены.");
      setStatus("active");
      browserLastReconciledAtRef.current = Date.now();
    } catch (e) {
      setMessage(mapPgError(e));
    }
  }, [markMigrationMissing, preferences, supabase, userId]);

  const disable = useCallback(async () => {
    try {
      if (isNativeAndroid()) {
        const operation = disableNativeVoicePush();
        const owner = nativeVoiceContext();
        const result = await operation;
        if (!isCurrentNativeVoiceContext(owner)) return;
        const preferenceError = owner
          ? await persistPushPreferenceState(
              supabase as unknown as Parameters<typeof persistPushPreferenceState>[0],
              owner.recipientId,
              preferences,
              false,
            )
          : null;
        if (!isCurrentNativeVoiceContext(owner)) return;
        setStatus(normalizeNativeStatus(result));
        if (preferenceError) {
          if (looksLikeSchemaMissing(preferenceError)) markMigrationMissing();
          else setMessage(mapPgError(preferenceError));
        } else {
          setMessage(result.message);
        }
        setPreferences((prev) => ({ ...prev, push_enabled: false }));
        return;
      }
      if (isNativeApp()) {
        setStatus("native_unavailable");
        setMessage("Native push пока настроен только для Android-приложения.");
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        const { error } = await supabase
          .from("push_subscriptions")
          .update({
            is_active: false,
            updated_at: new Date().toISOString(),
          })
          .eq("endpoint", sub.endpoint);
        if (error && !looksLikeSchemaMissing(error)) setMessage(mapPgError(error));
        await sub.unsubscribe();
      }
      if (userId) {
        const { error: preferenceError } = await supabase
          .from("notification_preferences")
          .upsert(
            {
              user_id: userId,
              ...preferences,
              push_enabled: false,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );
        if (preferenceError && looksLikeSchemaMissing(preferenceError)) markMigrationMissing();
        else if (preferenceError) setMessage(mapPgError(preferenceError));
      }
      setPreferences((prev) => ({ ...prev, push_enabled: false }));
      setMessage("Push-уведомления выключены.");
      setStatus("inactive");
    } catch (e) {
      setMessage(mapPgError(e));
    }
  }, [markMigrationMissing, preferences, supabase, userId]);

  const setPreference = useCallback(async (key: PushPreferenceKey, value: boolean) => {
    if (!userId) return;
    const previous = preferences;
    const next = { ...preferences, [key]: value };
    setPreferences(next);
    const { error } = await supabase
      .from("notification_preferences")
      .upsert(
        {
          user_id: userId,
          ...next,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    if (error) {
      setPreferences(previous);
      if (looksLikeSchemaMissing(error)) markMigrationMissing();
      else setMessage(mapPgError(error));
    }
  }, [markMigrationMissing, preferences, supabase, userId]);

  return {
    status,
    preferences,
    loadingPreferences,
    message,
    enable,
    disable,
    setPreference,
    refresh: loadPreferences,
  };
}

export function usePushNotificationNavigation() {
  const currentUserId = useAppStore((s) => s.currentUser?.id ?? null);
  const deferredPushTargetRef = useRef<ReturnType<typeof createDeferredPushTargetHandler> | null>(null);
  if (!deferredPushTargetRef.current) {
    deferredPushTargetRef.current = createDeferredPushTargetHandler(
      openPushTargetInApp,
      () => Boolean(useAppStore.getState().currentUser?.id),
    );
  }

  useEffect(() => {
    if (isNativeApp() || isDesktopApp()) return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "kub-open" && typeof e.data.url === "string") {
        // Keep notification-click navigation inside the SPA, but do not try to
        // resolve its chat as an anonymous user while a resumed PWA is still
        // restoring auth. The same queue already protects native cold starts.
        deferredPushTargetRef.current?.handle(e.data.url);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, []);

  useEffect(() => {
    if (!(isNativeAndroid() || isDesktopApp())) return undefined;
    let cleanup: (() => void) | null = null;
    const targetHandler = deferredPushTargetRef.current;
    if (!targetHandler) return undefined;
    const register = isNativeAndroid()
      ? registerNativePushNavigationListeners
      : registerDesktopNotificationNavigationListener;
    void register(targetHandler.handle).then((removeListeners) => {
      cleanup = removeListeners;
    });
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    if (!currentUserId) return;
    deferredPushTargetRef.current?.flush();
  }, [currentUserId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!currentUserId) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.get("chat")) return;
    openPushTargetInApp(`${url.pathname}${url.search}${url.hash}`);
  }, [currentUserId]);
}

function openPushTargetInApp(rawUrl: string): void {
  if (typeof window === "undefined") return;
  let target: URL;
  try {
    target = new URL(rawUrl, window.location.origin);
  } catch {
    return;
  }
  if (target.origin !== window.location.origin) return;

  const chatId = target.searchParams.get("chat");
  const messageId = target.searchParams.get("message");
  if (chatId) {
    void safeOpenChat(chatId).then((opened) => {
      if (opened) {
        // The conversation's own address, rather than the path the notification
        // happened to name with the ids hanging off it as a query. A tap now
        // leaves a URL that survives a reload, and `useChatAddress` sees the
        // location and the selection already agreeing, so it does not navigate
        // a second time. The jump stays here: this path selected the chat
        // itself, so the hook has no «open» to hang one on.
        const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
        window.history.pushState(null, "", `${base}${chatAddressPath(chatId, messageId)}${target.hash}`);
        window.dispatchEvent(new PopStateEvent("popstate"));
        if (messageId) {
          window.setTimeout(() => requestChatMessageJump(chatId, messageId), 150);
        }
      }
    });
    return;
  }

  window.history.pushState(null, "", `${target.pathname}${target.search}${target.hash}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function getPlatform(): string | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return nav.userAgentData?.platform || navigator.platform || null;
}

function looksLikeSchemaMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const item = error as { code?: unknown; message?: unknown; details?: unknown };
  const code = typeof item.code === "string" ? item.code : "";
  const text = [item.message, item.details].filter(Boolean).join(" ").toLowerCase();
  return (
    code === "PGRST204" ||
    code === "PGRST205" ||
    text.includes("notification_preferences") ||
    text.includes("chat_notification_preferences") ||
    text.includes("is_active") ||
    text.includes("last_seen_at") ||
    text.includes("platform") ||
    text.includes("user_push_devices") ||
    text.includes("register_push_device") ||
    text.includes("unregister_push_device")
  );
}

function normalizeNativeStatus(result: NativePushResult): PushStatus {
  if (result.status === "native_active") return "active";
  if (result.status === "native_inactive") return "inactive";
  if (result.status === "native_denied") return "denied";
  if (result.status === "migration_missing") return "migration_missing";
  return "native_unavailable";
}
