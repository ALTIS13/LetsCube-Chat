import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { ChatMemberRole } from "@/lib/chatMemberRules";
import { subscribeByTable } from "@/lib/realtimeTableChannels";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";

type ReadStatus = "checking" | "unavailable" | "ready";
type PublicationStatus = Exclude<ReadStatus, "ready"> | "publisher" | "read-only";
type Member = { chat_id?: string; user_id?: string; role?: string };
type Change = { new?: Member; old?: Member };
type Scope = { userId: string | null; epoch: number; ids: string[]; signedIn: boolean; attempt: number };
type Read = { scope: Scope; status: ReadStatus; roles?: Map<string, ChatMemberRole> };
let nextSubscription = 0;

function isMemberRole(role: unknown): role is ChatMemberRole {
  return role === "owner" || role === "admin" || role === "member";
}

function belongsToCurrentSession(scope: Scope) {
  const app = useAppStore.getState();
  return scope.signedIn && app.authSessionSource === "sdk" &&
    app.accountEpoch === scope.epoch && app.currentUser?.id === scope.userId;
}

function statusFor(read: Read | null, chatId: string): PublicationStatus {
  if (!read) return "checking";
  if (read.status !== "ready") return read.status;
  const role = read.roles?.get(chatId);
  // UX mirror of the staged channel publication trigger, not an authorization check.
  return role === "owner" || role === "admin" ? "publisher" : "read-only";
}

/** An own-membership read for the open broadcast or the open forward picker. */
export function useBroadcastPublication(chatIdsKey: string) {
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const epoch = useAppStore((s) => s.accountEpoch);
  const signedIn = useAppStore((s) => s.authSessionSource === "sdk");
  const [attempt, setAttempt] = useState(0);
  const scope = useMemo<Scope>(() => ({
    userId, epoch, signedIn, attempt, ids: chatIdsKey ? chatIdsKey.split(",") : [],
  }), [userId, epoch, signedIn, attempt, chatIdsKey]);
  const mounted = useRef<Scope | null>(null);
  const latest = useRef<Read | null>(null);
  const [read, setRead] = useState<Read | null>(null);
  useLayoutEffect(() => {
    mounted.current = scope;
    return () => { mounted.current = null; };
  }, [scope]);

  useEffect(() => {
    if (!scope.ids.length || !userId || !signedIn) return;
    const supabase = createClient();
    const ids = new Set(scope.ids);
    const observedRoles = new Map<string, ChatMemberRole | null>();
    let subscribed = false;
    let generation = 0;
    let running: AbortController | null = null;
    const owns = () => mounted.current === scope && belongsToCurrentSession(scope);
    const visible = () => document.visibilityState !== "hidden" && navigator.onLine;
    const update = (status: ReadStatus, roles?: Map<string, ChatMemberRole>) => {
      const next = { scope, status, roles };
      latest.current = next;
      setRead(next);
    };
    const refresh = async () => {
      if (!owns()) return;
      const request = ++generation;
      running?.abort();
      running = null;
      if (!subscribed || !visible()) {
        update("unavailable");
        return;
      }
      update("checking");
      const controller = new AbortController();
      running = controller;
      const timeout = window.setTimeout(() => controller.abort(), 8000);
      const current = () => owns() && generation === request;
      try {
        const { data, error } = await supabase.from("chat_members")
          .select("chat_id,user_id,role").eq("user_id", userId).in("chat_id", scope.ids)
          .abortSignal(controller.signal);
        if (!current()) return;
        if (error || !data || !visible() || controller.signal.aborted) {
          update("unavailable");
          return;
        }
        const roles = new Map<string, ChatMemberRole>();
        for (const row of data) {
          if (row.user_id !== userId || !ids.has(row.chat_id) || !isMemberRole(row.role) || roles.has(row.chat_id)) {
            update("unavailable");
            return;
          }
          roles.set(row.chat_id, row.role);
        }
        for (const id of ids) observedRoles.set(id, roles.get(id) ?? null);
        update("ready", roles);
      } catch {
        if (current()) update("unavailable");
      } finally {
        window.clearTimeout(timeout);
        if (running === controller) running = null;
      }
    };
    const membershipChanged = (event: "INSERT" | "UPDATE" | "DELETE", change: Change) => {
      if (!owns()) return;
      const row = event === "DELETE" ? change.old : change.new;
      if (row?.user_id !== userId || !row.chat_id || !ids.has(row.chat_id)) return;
      const role = isMemberRole(row.role) ? row.role : null;
      // Read receipts UPDATE this same table; only a change of standing matters.
      if (event === "UPDATE" && role && observedRoles.get(row.chat_id) === role) return;
      observedRoles.set(row.chat_id, event === "DELETE" ? null : role);
      void refresh();
    };
    const channels = subscribeByTable<(payload: Change) => void, RealtimeChannel>(
      supabase.realtime,
      `broadcast-publication:${++nextSubscription}`,
      (["INSERT", "UPDATE", "DELETE"] as const).map((event) => ({
        event, schema: "public", table: "chat_members", filter: `user_id=eq.${userId}`,
        handler: (change) => membershipChanged(event, change),
      })),
      (_name, status) => {
        if (!owns()) return;
        subscribed = status === "SUBSCRIBED";
        void refresh();
      },
    );
    const revalidate = () => { void refresh(); };
    const pageShow = (event: PageTransitionEvent) => { if (event.persisted) revalidate(); };
    document.addEventListener("visibilitychange", revalidate);
    window.addEventListener("pageshow", pageShow);
    window.addEventListener("online", revalidate);
    window.addEventListener("offline", revalidate);
    return () => {
      generation += 1;
      running?.abort();
      document.removeEventListener("visibilitychange", revalidate);
      window.removeEventListener("pageshow", pageShow);
      window.removeEventListener("online", revalidate);
      window.removeEventListener("offline", revalidate);
      for (const { channel } of channels) void supabase.removeChannel(channel);
    };
  }, [scope, userId, signedIn]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const canPublishNow = useCallback((id: string) => (
    mounted.current === scope && belongsToCurrentSession(scope) && latest.current?.scope === scope &&
    navigator.onLine && document.visibilityState !== "hidden" && statusFor(latest.current, id) === "publisher"
  ), [scope]);
  const currentRead = read?.scope === scope ? read : null;
  const status = !userId || !signedIn ? "unavailable" : currentRead?.status ?? "checking";
  return {
    status,
    statusFor: (id: string): PublicationStatus => status === "ready" ? statusFor(currentRead, id) : status,
    canPublishNow,
    retry,
  };
}
