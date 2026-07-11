"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { mapPgError } from "@/lib/errors";
import { requestChatMessageJump } from "@/lib/chatJumpEvents";
import { safeOpenChat } from "@/lib/safeOpenChat";
import { isNativeAndroid, isNativeApp, nativePushPendingMessage, supportsBrowserPush } from "@/lib/platform/capabilities";
import {
  disableNativeAndroidPush,
  enableNativeAndroidPush,
  getNativePushPermissionStatus,
  registerNativePushNavigationListeners,
  type NativePushResult,
} from "@/lib/platform/nativePush";
import { getBuildMetadata } from "@/lib/monitoring";
import { createDeferredPushTargetHandler } from "@/lib/pushNavigationQueue";
import {
  persistPushPreferenceState,
  shouldRestoreNativePushRegistration,
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

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function usePush() {
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const supabase = createClient();
  const [status, setStatus] = useState<PushStatus>("inactive");
  const [preferences, setPreferences] = useState<PushPreferences>(DEFAULT_PREFERENCES);
  const [loadingPreferences, setLoadingPreferences] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const nativeTokenRef = useRef<string | null>(null);
  const nativeRegistrationAttemptedUserRef = useRef<string | null>(null);

  const markMigrationMissing = useCallback(() => {
    setStatus("migration_missing");
    setMessage("Для push-уведомлений нужно обновление базы данных.");
  }, []);

  const loadPreferences = useCallback(async () => {
    if (!userId) return;
    setLoadingPreferences(true);
    const { data, error } = await supabase
      .from("notification_preferences")
      .select("push_enabled, message_push_enabled, task_push_enabled, invite_push_enabled")
      .eq("user_id", userId)
      .maybeSingle();
    setLoadingPreferences(false);

    if (error) {
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
        setStatus(normalizeNativeStatus(result));
        setMessage(result.message);
      });
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
      setStatus("missing_vapid");
      setMessage("VAPID public key не настроен.");
      return;
    }
    // Check whether we already have an active subscription registered.
    navigator.serviceWorker.getRegistration("/sw.js").then(async (reg) => {
      if (!reg) { setStatus("inactive"); return; }
      const sub = await reg.pushManager.getSubscription();
      setStatus(sub ? "active" : "inactive");
    });
  }, []);

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences]);

  useEffect(() => {
    if (!shouldRestoreNativePushRegistration({
      nativeAndroid: isNativeAndroid(),
      userId,
      loadingPreferences,
      pushEnabled: preferences.push_enabled,
      attemptedUserId: nativeRegistrationAttemptedUserRef.current,
    })) return;

    nativeRegistrationAttemptedUserRef.current = userId;
    let active = true;
    setStatus("native_unavailable");
    setMessage("Восстанавливаем Android push...");
    void enableNativeAndroidPush(async (token) => {
      nativeTokenRef.current = token;
      return registerNativeDeviceToken(supabase, token);
    }).then((result) => {
      if (!active) return;
      setStatus(normalizeNativeStatus(result));
      setMessage(result.message);
    });

    return () => {
      active = false;
    };
  }, [loadingPreferences, preferences.push_enabled, supabase, userId]);

  const enable = useCallback(async () => {
    if (!userId) return;
    if (isNativeAndroid()) {
      nativeRegistrationAttemptedUserRef.current = userId;
      setStatus("native_unavailable");
      setMessage("Регистрируем Android push...");
      const result = await enableNativeAndroidPush(async (token) => {
        nativeTokenRef.current = token;
        return registerNativeDeviceToken(supabase, token);
      });
      if (result.status === "native_active") {
        const preferenceError = await persistPushPreferenceState(
          supabase as unknown as Parameters<typeof persistPushPreferenceState>[0],
          userId,
          preferences,
          true,
        );
        if (preferenceError) {
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
    if (isNativeApp()) {
      setStatus("native_unavailable");
      setMessage(nativePushPendingMessage());
      return;
    }
    if (!VAPID_PUBLIC) {
      setStatus("missing_vapid");
      setMessage("VAPID public key не настроен.");
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

      // Upsert on user+endpoint so re-enabling on the same device does not
      // create duplicate rows and the same browser endpoint cannot be moved
      // between users accidentally.
      const { error } = await supabase
        .from("push_subscriptions")
        .upsert(
          {
            user_id: userId,
            endpoint,
            p256dh,
            auth,
            user_agent: navigator.userAgent,
            platform: getPlatform(),
            is_active: true,
            last_seen_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
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
    } catch (e) {
      setMessage(mapPgError(e));
    }
  }, [markMigrationMissing, preferences, supabase, userId]);

  const disable = useCallback(async () => {
    try {
      if (isNativeAndroid()) {
        const result = await disableNativeAndroidPush(nativeTokenRef.current, async (token) => {
          await unregisterNativeDeviceToken(supabase, token);
        });
        nativeTokenRef.current = null;
        const preferenceError = userId
          ? await persistPushPreferenceState(
              supabase as unknown as Parameters<typeof persistPushPreferenceState>[0],
              userId,
              preferences,
              false,
            )
          : null;
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
  const deferredNativeTargetRef = useRef<ReturnType<typeof createDeferredPushTargetHandler> | null>(null);
  if (!deferredNativeTargetRef.current) {
    deferredNativeTargetRef.current = createDeferredPushTargetHandler(
      openPushTargetInApp,
      () => Boolean(useAppStore.getState().currentUser?.id),
    );
  }

  useEffect(() => {
    if (isNativeApp()) return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "kub-open" && typeof e.data.url === "string") {
        // Keep notification-click navigation inside the SPA; no document reload.
        openPushTargetInApp(e.data.url);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, []);

  useEffect(() => {
    if (!isNativeAndroid()) return undefined;
    let cleanup: (() => void) | null = null;
    const targetHandler = deferredNativeTargetRef.current;
    if (!targetHandler) return undefined;
    void registerNativePushNavigationListeners(targetHandler.handle).then((removeListeners) => {
      cleanup = removeListeners;
    });
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    if (!currentUserId || !isNativeAndroid()) return;
    deferredNativeTargetRef.current?.flush();
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
        window.history.pushState(null, "", `${target.pathname}${target.hash}`);
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
  if (result.status === "native_denied") return "denied";
  if (result.status === "migration_missing") return "migration_missing";
  return "native_unavailable";
}

async function registerNativeDeviceToken(
  supabase: ReturnType<typeof createClient>,
  token: string,
): Promise<NativePushResult | null> {
  const tokenHash = await sha256Hex(token).catch(() => null);
  const metadata = getBuildMetadata();
  const { error } = await (supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: unknown }>;
  }).rpc("register_push_device", {
    p_platform: "android",
    p_provider: "fcm",
    p_token: token,
    p_token_hash: tokenHash,
    p_device_id: null,
    p_device_model: getDeviceModel(),
    p_app_version: metadata.version,
  });

  if (error) {
    if (looksLikeSchemaMissing(error)) {
      return {
        status: "migration_missing",
        message: "Нужно применить migration user_push_devices/register_push_device для Android push.",
      };
    }
    return { status: "native_error", message: mapPgError(error) };
  }

  return null;
}

async function unregisterNativeDeviceToken(
  supabase: ReturnType<typeof createClient>,
  token: string,
): Promise<void> {
  await (supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: unknown }>;
  }).rpc("unregister_push_device", {
    p_provider: "fcm",
    p_token: token,
  });
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getDeviceModel(): string | null {
  if (typeof navigator === "undefined") return null;
  return navigator.userAgent || null;
}
