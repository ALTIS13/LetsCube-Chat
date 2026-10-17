import { useEffect, useSyncExternalStore } from "react";
import { useAppStore } from "@/store/app.store";
import { createClient, getSupabasePublishableKey, isSupabaseConfigured } from "@/lib/supabase/client";
import { isWebBrowser, supportsBrowserPush } from "@/lib/platform/capabilities";
import {
  bindWebMessagePreviewRuntime, createWebMessagePreviewClient, installWebMessagePreview,
  observeWebMessagePreviewIdentity, webPreviewStore, webPreviewSubscriptionFingerprint,
  type WebPreviewLevel, type WebPreviewOwner, type WebPreviewView,
} from "@/lib/platform/webMessagePreviews";

type Reply = { data: unknown; error: unknown };
type PreviewClient = {
  rpc(name: string, args: Record<string, string | number>): PromiseLike<Reply>;
  from(name: "notification_preview_preferences"): {
    select(columns: "user_id,preview_level"): { eq(column: "user_id", id: string): PromiseLike<Reply> };
    upsert(row: { user_id: string; preview_level: WebPreviewLevel }, options: { onConflict: "user_id" }): { select(columns: "user_id,preview_level"): PromiseLike<Reply> };
  };
};
const CLOSED: WebPreviewView = { status: "unavailable", savedChoice: null, effectiveChoice: "none", installed: false, error: null };
const equal = (a: WebPreviewOwner | null, b: WebPreviewOwner | null) => !!a && !!b && a.userId === b.userId && a.sessionId === b.sessionId && a.accountEpoch === b.accountEpoch;
function owner(): WebPreviewOwner | null {
  const s = useAppStore.getState(), identity = s.authSessionIdentity;
  return identity?.sessionId && identity.userId === s.currentUser?.id
    ? { userId: identity.userId, sessionId: identity.sessionId, accountEpoch: s.accountEpoch } : null;
}
function available(): boolean {
  return isSupabaseConfigured() && isWebBrowser() && supportsBrowserPush()
    && (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)
    && Notification.permission === "granted";
}

// One runtime is mounted above Settings. A disclosure closing must not erase a
// confirmed background grant; account/session retirement lives outside React.
let snapshot = CLOSED, snapshotOwner: WebPreviewOwner | null = null;
const listeners = new Set<() => void>();
let runtime: { client: ReturnType<typeof createWebMessagePreviewClient>; refresh(): void; stop(): void; choose(level: WebPreviewLevel): Promise<boolean> } | null = null;
let mounts = 0;
const writes = new Map<string, Promise<void>>();
const notify = () => { for (const listener of listeners) listener(); };

function start() {
  const client = createClient(), preview = client as unknown as PreviewClient;
  let stopped = false, stamp = owner(), observed = owner(), timer: ReturnType<typeof setTimeout> | undefined;
  const update = (view: WebPreviewView) => {
    snapshotOwner = stamp;
    snapshot = !stopped && equal(stamp, owner()) ? view : CLOSED;
    notify();
  };
  const controller = createWebMessagePreviewClient({
    owner, foreground: () => available() && document.visibilityState === "visible", store: webPreviewStore(), crypto, now: Date.now, changed: update,
    subscription: async () => {
      const who = owner(); if (!who) return null;
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription(); if (!sub || !equal(who, owner())) return null;
      const json = sub.toJSON();
      const result = await client.from("push_subscriptions").select("id,user_id,endpoint,p256dh,auth,is_active")
        .eq("user_id", who.userId).eq("endpoint", sub.endpoint).maybeSingle();
      if (!equal(who, owner()) || result.error || !result.data) return null;
      const row = result.data;
      if (Object.keys(row).length !== 6 || row.user_id !== who.userId || row.is_active !== true || row.endpoint !== sub.endpoint
        || json.endpoint !== row.endpoint || json.keys?.p256dh !== row.p256dh || json.keys?.auth !== row.auth) return null;
      const fingerprint = await webPreviewSubscriptionFingerprint(sub, row.id, row.user_id);
      return equal(who, owner()) && fingerprint ? { subscriptionId: row.id, fingerprint } : null;
    },
    preference: choice => {
      const who = owner(); if (!who) return Promise.resolve({ data: null, error: true });
      const execute = async (): Promise<Reply> => {
        if (!equal(who, owner())) return { data: null, error: true };
        const reply = choice === undefined
          ? await preview.from("notification_preview_preferences").select("user_id,preview_level").eq("user_id", who.userId)
          : await preview.from("notification_preview_preferences").upsert({ user_id: who.userId, preview_level: choice }, { onConflict: "user_id" }).select("user_id,preview_level");
        // The existing account table defaults to none and has no mandatory row.
        return choice === undefined && !reply.error && Array.isArray(reply.data) && reply.data.length === 0
          ? { data: [{ user_id: who.userId, preview_level: "none" }], error: null } : reply;
      };
      if (choice === undefined) return (writes.get(who.userId) ?? Promise.resolve()).then(execute);
      const task = (writes.get(who.userId) ?? Promise.resolve()).catch(() => {}).then(execute);
      const tail = task.then(() => {}, () => {}); writes.set(who.userId, tail);
      void tail.then(() => { if (writes.get(who.userId) === tail) writes.delete(who.userId); });
      return task;
    },
    rpc: (name, args) => preview.rpc(name, args),
    install: async (token, value, current) => {
      const worker = navigator.serviceWorker.controller;
      return !!worker && installWebMessagePreview(worker, token, value, getSupabasePublishableKey(), current);
    },
  });
  const unbind = bindWebMessagePreviewRuntime(controller);
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (!stopped) { stamp = owner(); void controller.refresh(); } }, 0);
  };
  const unsubscribe = useAppStore.subscribe(() => {
    const next = owner();
    if (!equal(observed, next)) {
      observed = next; controller.invalidate();
      observeWebMessagePreviewIdentity(next); refresh();
    }
  });
  const visible = () => { if (document.visibilityState === "visible") refresh(); else controller.invalidate(); };
  window.addEventListener("focus", refresh); window.addEventListener("online", refresh);
  window.addEventListener("kub:push-state-changed", refresh);
  document.addEventListener("visibilitychange", visible);
  refresh();
  return { client: controller, refresh, choose: (choice: WebPreviewLevel) => { stamp = owner(); return controller.setChoice(choice); },
    stop: () => {
      stopped = true; clearTimeout(timer); controller.invalidate(); unbind(); unsubscribe(); snapshot = CLOSED; snapshotOwner = null;
      window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh);
      window.removeEventListener("kub:push-state-changed", refresh); document.removeEventListener("visibilitychange", visible); notify();
    } };
}

export function useWebMessagePreview() {
  const uid = useAppStore(s => s.currentUser?.id ?? null), epoch = useAppStore(s => s.accountEpoch);
  const sid = useAppStore(s => s.authSessionIdentity?.sessionId ?? null);
  const value = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => snapshot, () => CLOSED);
  useEffect(() => {
    if (!isSupabaseConfigured() || !isWebBrowser() || !supportsBrowserPush()) return;
    mounts++; if (!runtime) runtime = start();
    return () => { if (--mounts === 0) { runtime?.stop(); runtime = null; } };
  }, []);
  const owns = () => snapshotOwner?.userId === uid && snapshotOwner.sessionId === sid && snapshotOwner.accountEpoch === epoch && equal(snapshotOwner, owner());
  const view = owns() ? value : CLOSED;
  return { ...view, available: available(), canChoose: view.status === "ready", saving: view.status === "saving",
    refresh: () => runtime?.refresh(), setChoice: (choice: WebPreviewLevel) => owns() ? runtime?.choose(choice) ?? Promise.resolve(false) : Promise.resolve(false) };
}
