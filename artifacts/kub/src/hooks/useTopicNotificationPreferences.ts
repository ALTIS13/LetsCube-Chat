"use client";

import { useCallback, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import type {
  TopicNotificationMode, TopicNotificationPreferenceRow, TopicNotificationPreferenceView,
  TopicNotificationWriteResult,
} from "@/lib/topicNotificationPreferences";

type Client = ReturnType<typeof createClient>;
type Lease = { entry: Entry; live: boolean };
type Read = { controller: AbortController; promise: Promise<void>; dirty: boolean };
type Write = { lease: Lease; controller: AbortController };
type Entry = {
  userId: string; accountEpoch: number; chatId: string; live: boolean;
  leases: Set<Lease>; client: Client; channel: ReturnType<Client["channel"]> | null;
  connected: boolean; snapshot: boolean; dirty: boolean; read: Read | null; write: Write | null;
  view: TopicNotificationPreferenceView; detach: () => void;
};

// Entries exist only while consumers are mounted. No persistent permission cache.
const entries = new Map<string, Entry>();
let stopOwnerObserver: (() => void) | null = null;
let channelGeneration = 0;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const validScope = (value: unknown): value is string => typeof value === "string" && (value === "general" || UUID.test(value));
const validMode = (value: unknown): value is TopicNotificationMode => value === "inherit" || value === "enabled" || value === "disabled";
const revision = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const online = () => typeof navigator === "undefined" || navigator.onLine !== false;
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function parseRow(value: unknown, absent = false): TopicNotificationPreferenceRow | null {
  if (!exact(value, ["scope_key", "mode", "revision"]) || !validScope(value.scope_key)
    || !validMode(value.mode) || !revision(value.revision)) return null;
  if (value.revision < 1 && !(absent && value.mode === "inherit")) return null;
  return { scope_key: value.scope_key, mode: value.mode, revision: value.revision };
}
function parseRows(value: unknown): readonly TopicNotificationPreferenceRow[] | null {
  if (!Array.isArray(value)) return null;
  const rows: TopicNotificationPreferenceRow[] = [], keys = new Set<string>();
  for (const raw of value) {
    const row = parseRow(raw);
    if (!row || keys.has(row.scope_key)) return null;
    keys.add(row.scope_key); rows.push(row);
  }
  return rows;
}
function current(entry: Entry): boolean {
  const state = useAppStore.getState();
  return entry.live && entries.get(entry.chatId) === entry && state.currentUser?.id === entry.userId
    && state.accountEpoch === entry.accountEpoch;
}
function blank(userId: string | null, accountEpoch: number, chatId: string | null): TopicNotificationPreferenceView {
  return { userId, accountEpoch, chatId, rows: [], loading: !!userId && !!chatId, unavailable: true,
    pending: null, conflict: null, error: null };
}
function publish(entry: Entry, patch: Partial<TopicNotificationPreferenceView>) {
  if (!current(entry)) return;
  entry.view = { ...entry.view, ...patch };
  useAppStore.setState(state => ({ topicNotificationPreferences: {
    ...state.topicNotificationPreferences, [entry.chatId]: entry.view,
  } }));
}
function cancelRead(entry: Entry) {
  const read = entry.read; entry.read = null; read?.controller.abort();
}
function lose(entry: Entry) {
  if (!current(entry)) return;
  entry.snapshot = false;
  cancelRead(entry);
  const write = entry.write; entry.write = null; write?.controller.abort();
  entry.dirty = true;
  publish(entry, { unavailable: true, loading: false, pending: null,
    error: { code: "channel_unavailable", retryable: true } });
}
function retire(entry: Entry) {
  if (!entry.live) return;
  const owned = current(entry);
  entry.live = false;
  if (entries.get(entry.chatId) === entry) entries.delete(entry.chatId);
  cancelRead(entry); entry.write?.controller.abort(); entry.write = null;
  for (const lease of entry.leases) lease.live = false;
  entry.leases.clear(); entry.detach();
  if (entry.channel) void entry.client.removeChannel(entry.channel).catch(() => {});
  if (owned) useAppStore.setState(state => {
    if (state.topicNotificationPreferences[entry.chatId] !== entry.view) return state;
    const next = { ...state.topicNotificationPreferences }; delete next[entry.chatId];
    return { topicNotificationPreferences: next };
  });
  if (!entries.size) { stopOwnerObserver?.(); stopOwnerObserver = null; }
}

function read(entry: Entry): Promise<void> {
  if (!current(entry) || !entry.connected || !online() || entry.write) return Promise.resolve();
  if (entry.read) return entry.read.promise;
  const ticket: Read = { controller: new AbortController(), promise: Promise.resolve(), dirty: false };
  entry.read = ticket; entry.dirty = false;
  publish(entry, { loading: true, unavailable: true, error: null });
  ticket.promise = (async () => {
    try {
      if (!current(entry) || entry.read !== ticket) return;
      const response = await entry.client.rpc("topic_notification_preferences_read",
        { p_chat_id: entry.chatId }).abortSignal(ticket.controller.signal);
      if (!current(entry) || entry.read !== ticket) return;
      if (response.error !== null) throw new Error("read_failed");
      const rows = parseRows(response.data);
      if (!rows) throw new Error("read_failed");
      if (ticket.dirty) return;
      entry.snapshot = true;
      publish(entry, { rows, loading: false, unavailable: false, error: null });
    } catch {
      if (current(entry) && entry.read === ticket) {
        entry.snapshot = false;
        if (!ticket.dirty) publish(entry, { loading: false, unavailable: true, error: { code: "read_failed", retryable: true } });
      }
    } finally {
      if (current(entry) && entry.read === ticket) {
        entry.read = null;
        if (ticket.dirty) void read(entry);
      }
    }
  })();
  return ticket.promise;
}
function refresh(entry: Entry, changed = false): Promise<void> {
  if (!current(entry)) return Promise.resolve();
  publish(entry, { unavailable: true });
  if (entry.read) { if (changed) entry.read.dirty = true; return entry.read.promise; }
  if (entry.write) { entry.dirty = true; return Promise.resolve(); }
  return read(entry);
}

function acquire(userId: string, accountEpoch: number, chatId: string): Lease | null {
  const state = useAppStore.getState();
  if (state.currentUser?.id !== userId || state.accountEpoch !== accountEpoch) return null;
  let entry = entries.get(chatId);
  if (!entry || !current(entry)) {
    if (entry) retire(entry);
    entry = { userId, accountEpoch, chatId, live: true, leases: new Set(), client: createClient(), channel: null,
      connected: false, snapshot: false, dirty: false, read: null, write: null,
      view: blank(userId, accountEpoch, chatId), detach() {} };
    const own = entry;
    entries.set(chatId, own);
    if (!stopOwnerObserver) stopOwnerObserver = useAppStore.subscribe(() => {
      for (const candidate of [...entries.values()]) if (!current(candidate)) retire(candidate);
    });
    publish(own, {});
    if (!current(own)) return null;
    const offline = () => lose(own);
    const retry = () => { if (online()) void refresh(own); };
    const visible = () => { if (document.visibilityState === "visible") retry(); };
    window.addEventListener("offline", offline); window.addEventListener("online", retry);
    window.addEventListener("focus", retry); document.addEventListener("visibilitychange", visible);
    own.detach = () => {
      window.removeEventListener("offline", offline); window.removeEventListener("online", retry);
      window.removeEventListener("focus", retry); document.removeEventListener("visibilitychange", visible);
    };
    own.channel = own.client.channel(`topic-notifications:${userId}:${accountEpoch}:${chatId}:${++channelGeneration}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "topic_notification_preferences", filter: `chat_id=eq.${chatId}` },
        () => { void refresh(own, true); })
      .subscribe(status => {
        if (!current(own)) return;
        if (status === "SUBSCRIBED") {
          if (own.connected) return;
          own.connected = true; void refresh(own);
        } else { own.connected = false; lose(own); }
      });
  }
  const lease = { entry, live: true }; entry.leases.add(lease); return lease;
}
function release(lease: Lease) {
  lease.live = false;
  const entry = lease.entry; entry.leases.delete(lease);
  if (!entry.leases.size) { retire(entry); return; }
  if (entry.write?.lease === lease) { lose(entry); if (entry.connected && online()) void read(entry); }
}

async function write(lease: Lease, topicId: string | null, mode: TopicNotificationMode, expectedRevision: number): Promise<TopicNotificationWriteResult> {
  const entry = lease.entry;
  if (!lease.live || !current(entry)) return { status: "retired" };
  if (entry.write) return { status: "busy" };
  if ((topicId !== null && !UUID.test(topicId)) || !validMode(mode) || !revision(expectedRevision)) return { status: "invalid" };
  if (!entry.connected || !online() || (entry.view.unavailable && !entry.read)) return { status: "unavailable" };
  cancelRead(entry);
  entry.dirty = entry.dirty || !entry.snapshot;
  const attempt: Write = { lease, controller: new AbortController() }; entry.write = attempt;
  publish(entry, { pending: { topicId, mode, expectedRevision }, conflict: null, error: null });
  try {
    if (!lease.live || !current(entry) || entry.write !== attempt) return { status: "retired" };
    const response = await entry.client.rpc("topic_notification_preference_set", {
      p_chat_id: entry.chatId, p_topic_id: topicId, p_mode: mode, p_expected_revision: expectedRevision,
    }).abortSignal(attempt.controller.signal);
    if (!lease.live || !current(entry) || entry.write !== attempt) return { status: "retired" };
    if (response.error !== null) throw new Error("write_failed");
    const raw: unknown = response.data;
    if (!exact(raw, ["status", "scope_key", "mode", "revision"]) || (raw.status !== "applied" && raw.status !== "conflict")) throw new Error("write_failed");
    const row = parseRow({ scope_key: raw.scope_key, mode: raw.mode, revision: raw.revision }, raw.status === "conflict");
    if (!row || (topicId === null ? row.scope_key !== "general" : row.scope_key !== topicId && row.scope_key !== "general")
      || (raw.status === "applied" && (row.mode !== mode || row.revision !== expectedRevision + 1))
      || (raw.status === "conflict" && row.revision === expectedRevision)) throw new Error("write_failed");
    // A revision0 conflict describes absence, not a persisted inherit row.
    const rows = entry.view.rows.filter(old => old.scope_key !== row.scope_key);
    if (row.revision > 0) rows.push(row);
    publish(entry, { rows, pending: null, conflict: raw.status === "conflict" ? row : null,
      unavailable: !entry.snapshot || entry.dirty, loading: false, error: null });
    return { status: raw.status, row };
  } catch {
    if (!lease.live || !current(entry) || entry.write !== attempt) return { status: "retired" };
    entry.snapshot = false;
    publish(entry, { pending: null, unavailable: true, loading: false, error: { code: "write_failed", retryable: true } });
    return { status: "unavailable" };
  } finally {
    if (current(entry) && entry.write === attempt) {
      entry.write = null;
      if (entry.dirty) void read(entry);
    }
  }
}

export function useTopicNotificationPreferences(chatId: string | null | undefined) {
  const userId = useAppStore(state => state.currentUser?.id ?? null);
  const accountEpoch = useAppStore(state => state.accountEpoch);
  const stored = useAppStore(state => chatId ? state.topicNotificationPreferences[chatId] : undefined);
  const scope = useRef({ userId, accountEpoch, chatId }); scope.current = { userId, accountEpoch, chatId };
  const lease = useRef<Lease | null>(null);
  const liveLease = useCallback(() => {
    const now = scope.current, held = lease.current;
    return held?.live && now.userId === userId && now.accountEpoch === accountEpoch && now.chatId === chatId
      && current(held.entry) ? held : null;
  }, [userId, accountEpoch, chatId]);
  useEffect(() => {
    if (!userId || !chatId || !UUID.test(chatId)) return;
    const held = acquire(userId, accountEpoch, chatId); lease.current = held;
    return () => { if (lease.current === held) lease.current = null; if (held) release(held); };
  }, [userId, accountEpoch, chatId]);
  const setMode = useCallback((topicId: string | null, mode: TopicNotificationMode, expectedRevision: number) => {
    const held = liveLease();
    return held ? write(held, topicId, mode, expectedRevision) : Promise.resolve<TopicNotificationWriteResult>({ status: "retired" });
  }, [liveLease]);
  const reread = useCallback(() => {
    const held = liveLease(); return held ? refresh(held.entry) : Promise.resolve();
  }, [liveLease]);
  const view = stored?.userId === userId && stored.accountEpoch === accountEpoch && stored.chatId === chatId
    ? stored : blank(userId, accountEpoch, chatId ?? null);
  return { ...view, setMode, refresh: reread };
}
