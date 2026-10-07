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
  subscribeDuringUserGesture,
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
export const PUSH_STATE_CHANGED_EVENT = "kub:push-state-changed";

const VAPID_PUBLIC = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? "";
const BROWSER_REGISTRATION_ERROR = "Не удалось подготовить уведомления. Проверьте подключение и повторите попытку.";
const BROWSER_REGISTRATION_WAIT_MS = 8_000;
const DEFAULT_PREFERENCES: PushPreferences = {
  push_enabled: false,
  message_push_enabled: true,
  task_push_enabled: true,
  invite_push_enabled: true,
};

type PreferenceOwner = {
  userId: string | null;
  accountEpoch: number;
  preferences: PushPreferences;
  confirmed: PushPreferences;
  changes: Partial<PushPreferences>;
  ack: number;
  loaded: boolean;
  read: number;
  reading: Promise<void> | null;
  draft: number;
  operation: number;
  reconciling: boolean;
  reconciledAt: number;
};
function preferenceOwner(userId: string | null, accountEpoch: number, preferences = DEFAULT_PREFERENCES, loaded = false): PreferenceOwner {
  return { userId, accountEpoch, preferences, confirmed: preferences, changes: {}, ack: 0,
    loaded, read: 0, reading: null, draft: 0, operation: 0, reconciling: false, reconciledAt: 0 };
}
type PreferenceSaveResult = "saved" | "failed" | "retired";

// Already-issued requests cannot be cancelled. Order subsequent writes to the
// same row even across hook instances/account epochs, and retain only the tail.
const preferenceWrites = new Map<string, Promise<void>>();
let browserUnsubscribes = 0;
let browserProviderRevision = 0;
const browserProviderObservers = new Set<() => void>();
function notifyBrowserProviderObservers() {
  for (const observer of browserProviderObservers) observer();
}
async function unsubscribeBrowser(subscription: PushSubscription): Promise<void> {
  browserUnsubscribes += 1;
  browserProviderRevision += 1;
  notifyBrowserProviderObservers();
  try { await subscription.unsubscribe(); }
  finally {
    browserUnsubscribes -= 1;
    if (browserUnsubscribes === 0) notifyBrowserProviderObservers();
  }
}

export function usePush() {
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const accountEpoch = useAppStore((s) => s.accountEpoch);
  const supabase = createClient();
  const [status, setStatus] = useState<PushStatus>("inactive");
  const [preferences, setPreferences] = useState<PushPreferences>(DEFAULT_PREFERENCES);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [loadingPreferences, setLoadingPreferences] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const ownerRef = useRef(preferenceOwner(userId, accountEpoch, preferences, preferencesLoaded));
  if (ownerRef.current.userId !== userId || ownerRef.current.accountEpoch !== accountEpoch) {
    ownerRef.current = preferenceOwner(userId, accountEpoch);
  }
  const owner = ownerRef.current;
  const mountedRef = useRef(true);
  const isCurrentOwner = useCallback((candidate: PreferenceOwner) => {
    const actual = useAppStore.getState();
    return mountedRef.current && ownerRef.current === candidate
      && actual.currentUser?.id === candidate.userId && actual.accountEpoch === candidate.accountEpoch;
  }, []);
  const browserRegistrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const browserRegistrationAttemptRef = useRef(0);
  const browserRegistrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [browserRegistrationReady, setBrowserRegistrationReady] = useState(false);
  const [browserRegistrationFailed, setBrowserRegistrationFailed] = useState(false);
  const [browserReconciled, setBrowserReconciled] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    setPreferences(owner.preferences);
    setPreferencesLoaded(false);
    setLoadingPreferences(false);
    setBrowserReconciled(false);
    setMessage(null);
    setStatus("inactive");
  }, [owner]);

  const prepareBrowserRegistration = useCallback((retry: boolean) => {
    if (!isCurrentOwner(owner)) return;
    if (isNativeApp() || !supportsBrowserPush() || !VAPID_PUBLIC || currentNotificationPermission() === "denied") return;
    const attempt = ++browserRegistrationAttemptRef.current;
    const operation = owner.operation;
    if (browserRegistrationTimerRef.current !== null) clearTimeout(browserRegistrationTimerRef.current);
    setBrowserRegistrationFailed(false);
    if (retry) setMessage("Подготавливаем уведомления…");
    browserRegistrationTimerRef.current = setTimeout(() => {
      if (!isCurrentOwner(owner) || browserRegistrationAttemptRef.current !== attempt || owner.operation !== operation) return;
      setBrowserRegistrationFailed(true);
      setMessage(BROWSER_REGISTRATION_ERROR);
    }, BROWSER_REGISTRATION_WAIT_MS);

    // The app runtime registers on first load. Retry the same script and scope
    // only after a failed/pending setup; subscribe still needs a later tap.
    const base = import.meta.env.BASE_URL || "/";
    const scope = base.endsWith("/") ? base : `${base}/`;
    const ready = retry
      ? navigator.serviceWorker.register(`${scope}sw.js`, { scope }).then(() => navigator.serviceWorker.ready)
      : navigator.serviceWorker.ready;
    void ready.then((registration) => {
      if (!isCurrentOwner(owner) || browserRegistrationAttemptRef.current !== attempt) return;
      if (browserRegistrationTimerRef.current !== null) clearTimeout(browserRegistrationTimerRef.current);
      browserRegistrationTimerRef.current = null;
      browserRegistrationRef.current = registration;
      setBrowserRegistrationReady(true);
      setBrowserRegistrationFailed(false);
      if (owner.operation === operation) setMessage((current) => current === BROWSER_REGISTRATION_ERROR || current === "Подготавливаем уведомления…" ? null : current);
    }).catch(() => {
      if (!isCurrentOwner(owner) || browserRegistrationAttemptRef.current !== attempt) return;
      if (browserRegistrationTimerRef.current !== null) clearTimeout(browserRegistrationTimerRef.current);
      browserRegistrationTimerRef.current = null;
      setBrowserRegistrationFailed(true);
      if (owner.operation === operation) setMessage(BROWSER_REGISTRATION_ERROR);
    });
  }, [isCurrentOwner, owner]);

  useEffect(() => {
    prepareBrowserRegistration(false);
    return () => {
      browserRegistrationAttemptRef.current += 1;
      if (browserRegistrationTimerRef.current !== null) clearTimeout(browserRegistrationTimerRef.current);
      browserRegistrationTimerRef.current = null;
    };
  }, [prepareBrowserRegistration]);

  // D-132 (settings-profile F2). This said a database update was needed, to a
  // person who cannot apply one. The status is unchanged — `migration_missing`
  // is still how the rest of the hook and the settings row know what happened —
  // and the sentence now describes the situation instead of the repair.
  const markMigrationMissing = useCallback(() => {
    console.error("push preferences storage is not available on this deployment");
    setStatus("migration_missing");
    setMessage(PUSH_UNAVAILABLE);
  }, []);

  const loadPreferences = useCallback((): Promise<void> => {
    if (!owner.userId || !isCurrentOwner(owner)) return Promise.resolve();
    const userId = owner.userId;
    const read = ++owner.read;
    const draft = owner.draft;
    const ack = owner.ack;
    const operation = owner.operation;
    setPreferencesLoaded(false);
    setBrowserReconciled(false);
    setLoadingPreferences(true);
    const request = (async () => {
      const { data, error } = await supabase
        .from("notification_preferences")
        .select("push_enabled, message_push_enabled, task_push_enabled, invite_push_enabled")
        .eq("user_id", userId)
        .maybeSingle();
      if (!isCurrentOwner(owner) || owner.read !== read) return;
      setLoadingPreferences(false);
      if (owner.draft !== draft || owner.ack !== ack || Object.keys(owner.changes).length > 0) {
        setPreferencesLoaded(owner.loaded); return;
      }
      owner.loaded = !error;
      setPreferencesLoaded(true);

      if (error) {
        setPreferencesLoaded(false);
        if (owner.operation !== operation) return;
        if (looksLikeSchemaMissing(error)) {
          markMigrationMissing();
          return;
        }
        setMessage(mapPgError(error));
        return;
      }

      owner.preferences = {
        ...DEFAULT_PREFERENCES,
        ...(data ?? {}),
      };
      owner.confirmed = owner.preferences;
      setPreferences(owner.preferences);
      if (owner.operation === operation) setMessage(null);
    })().catch((error) => {
      if (!isCurrentOwner(owner) || owner.read !== read) return;
      setLoadingPreferences(false);
      if (owner.draft !== draft || owner.ack !== ack || Object.keys(owner.changes).length > 0) return;
      owner.loaded = false;
      setPreferencesLoaded(false);
      if (owner.operation !== operation) return;
      if (looksLikeSchemaMissing(error)) markMigrationMissing();
      else setMessage(mapPgError(error));
    });
    owner.reading = request;
    return request;
  }, [isCurrentOwner, markMigrationMissing, owner, supabase]);

  const ensurePreferencesLoaded = useCallback(async () => {
    if (!isCurrentOwner(owner)) return false;
    if (!owner.loaded) {
      const reading = owner.reading ?? loadPreferences();
      await reading;
      // A mount/refresh may have replaced the read while this command waited.
      if (!owner.loaded && owner.reading !== reading) await owner.reading;
    }
    return isCurrentOwner(owner) && owner.loaded;
  }, [isCurrentOwner, loadPreferences, owner]);

  const savePreferences = useCallback((patch: Partial<PushPreferences>, canContinue: () => boolean = () => true): Promise<PreferenceSaveResult> => {
    if (!owner.userId || !isCurrentOwner(owner) || !canContinue()) return Promise.resolve("retired");
    if (!owner.loaded) return Promise.resolve("failed");
    const userId = owner.userId;
    const next = { ...owner.preferences, ...patch };
    owner.changes = { ...owner.changes, ...patch };
    const revision = ++owner.draft;
    owner.preferences = next;
    setPreferences(next);
    const current = () => isCurrentOwner(owner) && owner.draft === revision && canContinue();
    const write = (preferenceWrites.get(userId) ?? Promise.resolve()).then(async (): Promise<PreferenceSaveResult> => {
      if (!current()) return "retired";
      let error: unknown;
      let confirmed: PushPreferences | null = null;
      let changes: Partial<PushPreferences> = {};
      try {
        // Another hook may have saved a category since this draft was loaded.
        // Merge only our unconfirmed changes into the current owner-scoped row.
        const result = await supabase.from("notification_preferences")
          .select("push_enabled, message_push_enabled, task_push_enabled, invite_push_enabled")
          .eq("user_id", userId).maybeSingle();
        if (!isCurrentOwner(owner)) return "retired";
        error = result.error;
        if (!error) {
          owner.confirmed = { ...DEFAULT_PREFERENCES, ...(result.data ?? {}) };
          if (!current()) return "retired";
          changes = { ...owner.changes };
          confirmed = { ...owner.confirmed, ...changes };
          error = await persistPushPreferenceState(
            supabase as unknown as Parameters<typeof persistPushPreferenceState>[0], userId, confirmed, confirmed.push_enabled,
          );
        }
      } catch (failure) { error = failure; }
      if (!error && confirmed && isCurrentOwner(owner)) {
        owner.confirmed = confirmed;
        owner.ack += 1;
        for (const key of Object.keys(changes) as (keyof PushPreferences)[]) {
          if (owner.changes[key] === changes[key]) delete owner.changes[key];
        }
      }
      if (!current()) return "retired";
      if (!error && confirmed) {
        owner.preferences = confirmed;
        setPreferences(confirmed);
        return "saved";
      }
      owner.changes = {};
      owner.draft += 1;
      owner.preferences = owner.confirmed;
      setPreferences(owner.confirmed);
      if (looksLikeSchemaMissing(error)) markMigrationMissing();
      else setMessage(mapPgError(error));
      return "failed";
    });
    const tail = write.then(() => undefined, () => undefined);
    preferenceWrites.set(userId, tail);
    void tail.then(() => { if (preferenceWrites.get(userId) === tail) preferenceWrites.delete(userId); });
    return write;
  }, [isCurrentOwner, markMigrationMissing, owner, supabase]);

  // Detect browser support and starting state.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const operation = owner.operation;
    if (isNativeAndroid()) {
      setStatus("native_unavailable");
      setMessage(nativePushPendingMessage());
      void getNativePushPermissionStatus().then((result) => {
        if (!isCurrentOwner(owner) || owner.operation !== operation) return;
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
    if (currentNotificationPermission() === "denied") {
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
  }, [isCurrentOwner, owner]);

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences]);

  useEffect(() => {
    if (!isNativeAndroid()) return;
    const update = () => {
      if (!isCurrentOwner(owner)) return;
      const result = nativeVoicePushSnapshot();
      if (!result) return;
      setStatus(normalizeNativeStatus(result));
      setMessage(result.message);
    };
    update();
    return subscribeNativeVoicePush(update);
  }, [isCurrentOwner, owner]);

  const reconcileBrowserSubscription = useCallback(async (force = false, settlementRead = false): Promise<void> => {
    if (!owner.userId || !owner.loaded || !isCurrentOwner(owner) || isNativeApp() || !supportsBrowserPush() || !VAPID_PUBLIC) return;
    if (browserUnsubscribes !== 0) {
      setBrowserReconciled(false);
      setStatus("inactive");
      return;
    }
    if (owner.reconciling) return;
    const now = Date.now();
    if (!force && now - owner.reconciledAt < 60_000) return;
    const operation = owner.operation;
    const draft = owner.draft;
    let providerRevision = browserProviderRevision;
    const current = () => isCurrentOwner(owner) && owner.operation === operation && owner.draft === draft
      && browserUnsubscribes === 0 && providerRevision === browserProviderRevision;

    owner.reconciling = true;
    owner.reconciledAt = now;
    try {
      if (Notification.permission === "denied") {
        setStatus("denied");
        return;
      }
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      if (!current()) return;
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      if (!current()) return;
      if (!subscription) {
        setStatus("inactive");
        if (owner.preferences.push_enabled) {
          setMessage("Push-подписка этого устройства неактивна. Включите уведомления повторно.");
        }
        return;
      }

      const keyMatches = applicationServerKeyMatches(subscription, VAPID_PUBLIC);
      if (keyMatches === false) {
        // A failed cleanup settlement must not bounce another deletion between hooks.
        if (!settlementRead) {
          await supabase
            .from("push_subscriptions")
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq("user_id", owner.userId)
            .eq("endpoint", subscription.endpoint);
          if (!current()) return;
          const unsubscribing = unsubscribeBrowser(subscription);
          providerRevision = browserProviderRevision;
          await unsubscribing;
          if (!current()) return;
        }
        setStatus("inactive");
        setMessage("Ключ push-подписки обновился. Включите уведомления повторно.");
        return;
      }

      if (!owner.preferences.push_enabled) {
        setStatus("inactive");
        return;
      }

      const { error } = await supabase
        .from("push_subscriptions")
        .upsert(
          browserSubscriptionRecord(subscription, owner.userId, navigator.userAgent, getPlatform()),
          { onConflict: "user_id,endpoint" },
        );
      if (!current()) return;
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
      if (!current()) return;
      setStatus("inactive");
      setMessage(mapPgError(error));
    } finally {
      owner.reconciling = false;
      if (current()) setBrowserReconciled(true);
      else if (isCurrentOwner(owner) && browserUnsubscribes === 0) void reconcileBrowserSubscription(true, settlementRead || providerRevision !== browserProviderRevision);
    }
  }, [isCurrentOwner, markMigrationMissing, owner, preferences.push_enabled, preferencesLoaded, supabase]);

  useEffect(() => {
    void reconcileBrowserSubscription(true);
  }, [reconcileBrowserSubscription]);

  useEffect(() => {
    if (isNativeApp() || !supportsBrowserPush()) return;
    const reconcile = () => void reconcileBrowserSubscription(false);
    const providerChanged = () => void reconcileBrowserSubscription(true, true);
    browserProviderObservers.add(providerChanged);
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
      browserProviderObservers.delete(providerChanged);
      window.removeEventListener("focus", reconcile);
      window.removeEventListener("online", reconcile);
      document.removeEventListener("visibilitychange", onVisibility);
      navigator.serviceWorker.removeEventListener("message", handleServiceWorkerMessage);
    };
  }, [reconcileBrowserSubscription]);

  const enable = useCallback(async () => {
    if (!owner.userId || !isCurrentOwner(owner)) return;
    const revision = ++owner.operation;
    const current = () => isCurrentOwner(owner) && owner.operation === revision;
    if (isNativeAndroid()) {
      setStatus("native_unavailable");
      setMessage("Регистрируем Android push...");
      const operation = enableNativeVoicePush();
      const nativeOwner = nativeVoiceContext();
      const result = await operation;
      if (!current() || !isCurrentNativeVoiceContext(nativeOwner) || nativeOwner?.recipientId !== owner.userId) return;
      if (result.status === "native_active") {
        if (!await ensurePreferencesLoaded()) {
          if (current() && isCurrentNativeVoiceContext(nativeOwner)) void disableNativeVoicePush();
          return;
        }
        if (!current() || !isCurrentNativeVoiceContext(nativeOwner)) return;
        const saved = await savePreferences({ push_enabled: true }, () => current() && isCurrentNativeVoiceContext(nativeOwner));
        if (!current() || !isCurrentNativeVoiceContext(nativeOwner)) return;
        if (saved === "retired") return;
        if (saved === "failed") {
          void disableNativeVoicePush();
          setStatus((status) => status === "migration_missing" ? status : "native_unavailable");
          return;
        }
      }
      setStatus(normalizeNativeStatus(result));
      setMessage(result.message);
      return;
    }
    if (!userId) return;
    const providerRevision = browserProviderRevision;
    const currentBrowser = () => current() && browserUnsubscribes === 0 && providerRevision === browserProviderRevision;
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
    const reg = browserRegistrationRef.current;
    if (!reg || !owner.loaded || !browserReconciled || browserUnsubscribes > 0) {
      setMessage("Подготавливаем уведомления. Повторите через несколько секунд.");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    // No await before this call: WebKit allows the permission prompt only
    // while transient activation from this exact press is still alive.
    try {
      const subscriptionOperation = subscribeDuringUserGesture(reg, urlBase64ToUint8Array(VAPID_PUBLIC));
      const sub = await subscriptionOperation;
      if (!currentBrowser()) return;

      // Upsert on user+endpoint so re-enabling on the same device does not
      // create duplicate rows and the same browser endpoint cannot be moved
      // between users accidentally.
      const { error } = await supabase
        .from("push_subscriptions")
        .upsert(
          browserSubscriptionRecord(sub, owner.userId, navigator.userAgent, getPlatform()),
          { onConflict: "user_id,endpoint" },
        );
      if (!currentBrowser()) return;
      if (error) {
        if (looksLikeSchemaMissing(error)) {
          markMigrationMissing();
          return;
        }
        setMessage(mapPgError(error));
        return;
      }

      if (await savePreferences({ push_enabled: true }, currentBrowser) !== "saved" || !currentBrowser()) return;

      setMessage("Push-уведомления включены.");
      setStatus("active");
      owner.reconciledAt = Date.now();
      window.dispatchEvent(new Event(PUSH_STATE_CHANGED_EVENT));
    } catch (e) {
      if (!currentBrowser()) return;
      if (currentNotificationPermission() === "denied") setStatus("denied");
      setMessage(mapPgError(e));
    }
  }, [browserReconciled, ensurePreferencesLoaded, isCurrentOwner, markMigrationMissing, owner, savePreferences, supabase, userId]);

  const disable = useCallback(async () => {
    if (!owner.userId || !isCurrentOwner(owner)) return;
    const revision = ++owner.operation;
    const current = () => isCurrentOwner(owner) && owner.operation === revision;
    try {
      if (isNativeAndroid()) {
        const operation = disableNativeVoicePush();
        const nativeOwner = nativeVoiceContext();
        const result = await operation;
        if (!current() || !isCurrentNativeVoiceContext(nativeOwner) || nativeOwner?.recipientId !== owner.userId) return;
        if (!await ensurePreferencesLoaded()) return;
        if (!current() || !isCurrentNativeVoiceContext(nativeOwner)) return;
        const saved = await savePreferences({ push_enabled: false }, () => current() && isCurrentNativeVoiceContext(nativeOwner));
        if (!current() || !isCurrentNativeVoiceContext(nativeOwner)) return;
        if (saved === "saved") {
          setStatus(normalizeNativeStatus(result));
          setMessage(result.message);
        }
        return;
      }
      if (isNativeApp()) {
        setStatus("native_unavailable");
        setMessage("Native push пока настроен только для Android-приложения.");
        return;
      }
      let providerRevision = browserProviderRevision;
      const currentBrowser = () => current() && browserUnsubscribes === 0 && providerRevision === browserProviderRevision;
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      if (!currentBrowser()) return;
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (!currentBrowser()) return;
      if (sub) {
        const { error } = await supabase
          .from("push_subscriptions")
          .update({
            is_active: false,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", owner.userId)
          .eq("endpoint", sub.endpoint);
        if (!currentBrowser()) return;
        if (error && !looksLikeSchemaMissing(error)) setMessage(mapPgError(error));
        const unsubscribing = unsubscribeBrowser(sub);
        providerRevision = browserProviderRevision;
        await unsubscribing;
        if (!currentBrowser()) return;
      }
      if (!await ensurePreferencesLoaded() || !currentBrowser()) return;
      if (await savePreferences({ push_enabled: false }, currentBrowser) !== "saved" || !currentBrowser()) return;
      setMessage("Push-уведомления выключены.");
      setStatus("inactive");
      window.dispatchEvent(new Event(PUSH_STATE_CHANGED_EVENT));
    } catch (e) {
      if (!current()) return;
      setMessage(mapPgError(e));
    }
  }, [ensurePreferencesLoaded, isCurrentOwner, owner, savePreferences, supabase]);

  const setPreference = useCallback(async (key: PushPreferenceKey, value: boolean) => {
    if (!owner.userId || !isCurrentOwner(owner)) return;
    if (!owner.loaded && !await ensurePreferencesLoaded()) return;
    if (!isCurrentOwner(owner)) return;
    await savePreferences({ [key]: value });
  }, [ensurePreferencesLoaded, isCurrentOwner, owner, savePreferences]);

  return {
    status,
    preferences: owner.preferences,
    loadingPreferences,
    message,
    readyForPrompt: owner.loaded && (status === "denied" || (browserRegistrationReady && browserReconciled)),
    browserRegistrationFailed,
    retryBrowserRegistration: () => prepareBrowserRegistration(true),
    enable,
    disable,
    setPreference,
    refresh: loadPreferences,
  };
}

function currentNotificationPermission(): NotificationPermission {
  return Notification.permission;
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
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    const targetHandler = deferredPushTargetRef.current;
    if (!targetHandler) return undefined;
    const register = isNativeAndroid()
      ? registerNativePushNavigationListeners
      : registerDesktopNotificationNavigationListener;
    void register((target) => {
      if (!cancelled) targetHandler.handle(target);
    }).then((removeListeners) => {
      if (cancelled) removeListeners();
      else cleanup = removeListeners;
    });
    return () => { cancelled = true; cleanup?.(); };
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

let pushTargetRevision = 0;
let cancelPendingPushTarget: (() => void) | null = null;

function openPushTargetInApp(rawUrl: string): void {
  if (typeof window === "undefined") return;
  let target: URL;
  try {
    target = new URL(rawUrl, window.location.origin);
  } catch {
    return;
  }
  if (target.origin !== window.location.origin) return;

  const owner = useAppStore.getState();
  const ownerId = owner.currentUser?.id;
  if (!ownerId) return;
  const accountEpoch = owner.accountEpoch;
  const revision = ++pushTargetRevision;
  cancelPendingPushTarget?.();
  const canCommit = () => {
    const state = useAppStore.getState();
    return state.currentUser?.id === ownerId && state.accountEpoch === accountEpoch
      && revision === pushTargetRevision;
  };

  const chatId = target.searchParams.get("chat");
  const messageId = target.searchParams.get("message");
  if (chatId) {
    const addressBefore = window.location.href;
    let selectionChanged = false;
    const offSelection = useAppStore.subscribe((state, previous) => {
      if (state.selectedChatId !== previous.selectedChatId || state.selectedTopicId !== previous.selectedTopicId) {
        selectionChanged = true;
      }
    });
    const finish = () => {
      offSelection();
      if (cancelPendingPushTarget === finish) cancelPendingPushTarget = null;
    };
    cancelPendingPushTarget = finish;
    const canResolve = () => canCommit() && !selectionChanged && window.location.href === addressBefore;
    void safeOpenChat(chatId, { canCommit: canResolve }).then((opened) => {
      finish();
      if (opened && canCommit() && useAppStore.getState().selectedChatId === chatId) {
        // The conversation's own address, rather than the path the notification
        // happened to name with the ids hanging off it as a query. A tap now
        // leaves a URL that survives a reload, and `useChatAddress` sees the
        // location and the selection already agreeing, so it does not navigate
        // a second time. The jump stays here: this path selected the chat
        // itself, so the hook has no «open» to hang one on.
        const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
        const route = `${base}${chatAddressPath(chatId, messageId)}${target.hash}`;
        window.history.pushState(null, "", route);
        window.dispatchEvent(new PopStateEvent("popstate"));
        if (messageId) {
          window.setTimeout(() => {
            // A newer tap, account transition or manual navigation owns the view now.
            const location = window.location;
            if (canCommit() && useAppStore.getState().selectedChatId === chatId
                && `${location.pathname}${location.search}${location.hash}` === route) {
              requestChatMessageJump(chatId, messageId);
            }
          }, 150);
        }
      }
    }, finish);
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
