import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { App } from "@capacitor/app";
import { PushNotifications } from "@capacitor/push-notifications";
import { isNativeAndroid, supportsCapacitorPlugin } from "./capabilities";
import { createClient } from "../supabase/client";
import { getBuildMetadata } from "../monitoring";
import { safeOpenChat } from "../safeOpenChat";
import { useAppStore } from "../../store/app.store";
import { enableNativeAndroidPush, disableNativeAndroidPush, type NativePushResult } from "./nativePush";
import { createNativeVoiceController, type NativeVoiceBridge, type NativeVoiceController, type NativeVoiceContext } from "./nativeVoiceController";
import { attachNativeVoiceLifecycle } from "./nativeVoiceLifecycle";
export type { NativeVoiceContext } from "./nativeVoiceController";

interface VoiceCallsPlugin extends NativeVoiceBridge {
  setForegroundRing(input: { ringKey: string | null }): Promise<void>;
  addListener(event: "actionPending", listener: () => void): Promise<PluginListenerHandle>;
}
const VoiceCalls = registerPlugin<VoiceCallsPlugin>("VoiceCalls");
const available = () => isNativeAndroid() && supportsCapacitorPlugin("VoiceCalls");
const bridge: NativeVoiceBridge = {
  getCapabilities: async () => available() ? VoiceCalls.getCapabilities().catch(() => ({ protocol: 0 })) : { protocol: 0 },
  beginBinding: async (binding) => available() ? VoiceCalls.beginBinding(binding) : { epoch: "" },
  commitBinding: async (binding) => available() ? VoiceCalls.commitBinding(binding) : { applied: false },
  clearBinding: async () => available() ? VoiceCalls.clearBinding() : undefined,
  setCallsAllowed: async (input) => available() ? VoiceCalls.setCallsAllowed(input) : undefined,
  consumePendingAction: async () => available() ? VoiceCalls.consumePendingAction() : { event: null },
  revalidateConsumedAction: async (input) => available()
    ? VoiceCalls.revalidateConsumedAction(input).catch(() => ({ event: null })) : { event: null },
};

let controller: NativeVoiceController | null = null;
let pushResult: NativePushResult | null = null;
const statusListeners = new Set<() => void>();
let foreground: { ringKey: string; userId: string } | null = null;

function syncForeground(): void {
  if (!available()) return;
  const context = controller?.context();
  const ringKey = document.visibilityState === "visible" && foreground?.userId === context?.recipientId
    ? foreground?.ringKey ?? null : null;
  void VoiceCalls.setForegroundRing({ ringKey }).catch(() => undefined);
}

export function ownNativeForegroundRing(ringKey: string | null, userId: string | null): () => void {
  if (!isNativeAndroid()) return () => undefined;
  const owner = ringKey && userId ? { ringKey, userId } : null;
  foreground = owner;
  syncForeground();
  return () => {
    if (foreground !== owner) return;
    foreground = null;
    syncForeground();
  };
}

export function nativeVoiceContext(): NativeVoiceContext | null { return controller?.context() ?? null; }
export function isCurrentNativeVoiceContext(context: NativeVoiceContext | null): boolean { return controller?.isCurrentContext(context) ?? false; }
export function isCurrentNativeVoiceSession(context: NativeVoiceContext | null): boolean { return controller?.isCurrentSession(context) ?? false; }
export function noteNativeCallsAllowed(allowed: boolean, context: NativeVoiceContext | null): void { controller?.setCallsAllowed(allowed, context); }
export function refreshNativeVoicePush(): void { controller?.refresh(); }
export async function enableNativeVoicePush(): Promise<NativePushResult> {
  return controller?.enable() ?? { status: "native_unavailable", message: "" };
}
export async function disableNativeVoicePush(): Promise<NativePushResult> {
  return controller?.disable() ?? { status: "native_inactive", message: "" };
}
export function nativeVoicePushSnapshot(): NativePushResult | null { return pushResult; }
export function subscribeNativeVoicePush(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => { statusListeners.delete(listener); };
}

/** Mounted once above public/auth/messenger routes. No native imports added to dependencies. */
export function startNativeVoiceCalls(onSessionChanged?: () => void): () => void {
  if (!isNativeAndroid()) return () => undefined;
  const supabase = createClient();
  const rpc = (name: string, args: Record<string, unknown>) => (supabase as unknown as {
    rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
  }).rpc(name, args);
  const runtime = createNativeVoiceController({
    bridge,
    loadSettings: async (session) => {
      const { data, error } = await supabase.from("notification_preferences").select("push_enabled")
        .eq("user_id", session.recipientId).maybeSingle();
      if (error) throw new Error("native push preferences unavailable");
      const calls = await rpc("voice_calls_allowed_here", {});
      // Older deployments have no calls setting. Server delivery still enforces it.
      return { pushEnabled: data?.push_enabled === true, callsAllowed: calls.error ? true : calls.data !== false };
    },
    registerPush: (register, interactive) => enableNativeAndroidPush(register, interactive),
    unregisterPush: (token, canCommit) => disableNativeAndroidPush(token, async (value) => {
      const result = await rpc("unregister_push_device", { p_provider: "fcm", p_token: value });
      if (result.error) throw new Error("native push unregister failed");
    }, canCommit),
    registrationMetadata: async (token) => {
      let tokenHash: string | null = null;
      try {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
        tokenHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      } catch { /* The nullable hash is not authority. Raw tokens remain memory-only. */ }
      return { tokenHash, deviceModel: navigator.userAgent || null, appVersion: getBuildMetadata().version };
    },
    rpc: (args) => rpc("register_push_device", args),
    openChat: (chatId, canCommit) => safeOpenChat(chatId, { canCommit }),
    navigationReady: (userId) => useAppStore.getState().currentUser?.id === userId,
    navigate: (route) => {
      const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
      window.history.pushState(null, "", `${base}${route}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    },
    now: Date.now,
    onSessionChanged,
    defer: (work) => { window.setTimeout(work, 0); },
    onResult: (result) => {
      if (controller !== runtime) return;
      pushResult = result;
      for (const listener of statusListeners) listener();
      syncForeground();
    },
  });
  controller = runtime;
  let disposed = false;
  const handles: PluginListenerHandle[] = [];
  const own = (pending: Promise<PluginListenerHandle>) => {
    void pending.then((handle) => {
      if (disposed) void handle.remove().catch(() => undefined);
      else handles.push(handle);
    }).catch(() => undefined);
  };
  if (available()) own(VoiceCalls.addListener("actionPending", () => { void runtime.actionPending(); }));
  own(PushNotifications.addListener("registration", ({ value }) => runtime.tokenChanged(value)));
  const offStore = useAppStore.subscribe(() => { void runtime.actionPending(); });
  const disposeLifecycle = attachNativeVoiceLifecycle(runtime, {
    subscribe: (signal) => {
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        signal(session);
        syncForeground();
      });
      return () => subscription.unsubscribe();
    },
    getSession: async () => {
      const { data, error } = await supabase.auth.getSession();
      return { session: data.session, error };
    },
    onResume: (resume) => {
      const visibility = () => {
        if (document.visibilityState === "visible") resume();
        syncForeground();
      };
      const online = () => resume();
      document.addEventListener("visibilitychange", visibility);
      window.addEventListener("online", online);
      own(App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) resume();
        if (!isActive && available()) void VoiceCalls.setForegroundRing({ ringKey: null }).catch(() => undefined);
        else syncForeground();
      }));
      return () => {
        document.removeEventListener("visibilitychange", visibility);
        window.removeEventListener("online", online);
      };
    },
  });
  return () => {
    disposed = true;
    disposeLifecycle();
    offStore();
    handles.forEach((handle) => { void handle.remove().catch(() => undefined); });
    if (controller === runtime) {
      controller = null;
      pushResult = null;
      foreground = null;
      syncForeground();
    }
  };
}
