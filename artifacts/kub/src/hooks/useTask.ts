"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/store/app.store";
import { createClient, getRealtimeClient } from "@/lib/supabase/client";
import { bumpFetch, registerChannel, unregisterChannel } from "@/lib/dev/instrumentation";
import { subscribeByTable } from "@/lib/realtimeTableChannels";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type {
  Profile,
  TaskChecklistItem,
  TaskEventWithActor,
  TaskReminder,
  TaskWithPeople,
} from "@/types/database";

interface TaskOwner {
  taskId: string | null;
  userId: string | null;
  accountEpoch: number;
  active: boolean;
  request: number;
}

interface TaskDetailState {
  owner: TaskOwner;
  task: TaskWithPeople | null;
  events: TaskEventWithActor[];
  checklist: TaskChecklistItem[];
  reminders: TaskReminder[];
  loading: boolean;
  refreshing: boolean;
  error: "transient" | "denied" | null;
}

function emptyDetail(owner: TaskOwner, loading = false): TaskDetailState {
  return { owner, task: null, events: [], checklist: [], reminders: [], loading, refreshing: false, error: null };
}

async function readPart<T>(query: PromiseLike<{ data: T; error: unknown; status?: number }>):
  Promise<{ data: T | null; error: unknown; status?: number }> {
  try {
    return await query;
  } catch (error) {
    return { data: null, error: error || true };
  }
}

function isAccessDenied(response: { error: unknown; status?: number }) {
  const error = typeof response.error === "object" && response.error !== null
    ? response.error as Record<string, unknown> : {};
  return response.status === 401 || response.status === 403 ||
    error.status === 401 || error.status === 403 || error.statusCode === 401 || error.statusCode === 403 ||
    error.code === "42501" || error.code === "PGRST301" || error.code === "PGRST302" || error.code === "PGRST303";
}

/**
 * Loads a single task with its full event history and subscribes to realtime
 * changes on both the task row and its events.  Used by TaskDetailModal.
 */
export function useTask(taskId: string | null) {
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const accountEpoch = useAppStore((s) => s.accountEpoch);
  const owner = useMemo<TaskOwner>(() => ({ taskId, userId, accountEpoch, active: false, request: 0 }),
    [taskId, userId, accountEpoch]);
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const [state, setState] = useState(() => emptyDetail(owner, Boolean(taskId && userId)));
  const supabase = useMemo(() => createClient(), []);
  const rt = useMemo(() => getRealtimeClient(), []);

  const fetchTask = useCallback(async () => {
    const isOwner = () => owner.active && ownerRef.current === owner &&
      useAppStore.getState().currentUser?.id === userId &&
      useAppStore.getState().accountEpoch === accountEpoch;
    if (!taskId || !userId || !isOwner()) return;
    const request = ++owner.request;
    const isCurrent = () => isOwner() && request === owner.request;
    bumpFetch("useTask");
    setState((previous) => {
      if (!isCurrent()) return previous;
      const held = previous.owner === owner ? previous : emptyDetail(owner);
      return { ...held, loading: !held.task, refreshing: Boolean(held.task) };
    });
    let terminal: "denied" | "absent" | null = null;
    async function readOwnedPart<T>(query: PromiseLike<{ data: T; error: unknown; status?: number }>, taskRead = false) {
      const response = await readPart(query);
      if (!isCurrent()) return response;
      const denied = isAccessDenied(response);
      if (denied || (taskRead && !response.error && !response.data)) {
        terminal = denied ? "denied" : terminal ?? "absent";
        // A terminal answer must not wait for a slower sibling read.
        setState((previous) => isCurrent()
          ? { ...emptyDetail(owner), error: terminal === "denied" ? "denied" : null }
          : previous);
      }
      return response;
    }
    try {
      const [taskRes, eventsRes, checklistRes, remindersRes] = await Promise.all([
        readOwnedPart(
          supabase
            .from("tasks")
            .select(
              `*,
               assignee:profiles!tasks_assignee_id_fkey(*),
               creator:profiles!tasks_created_by_fkey(*),
               chat:chats(*),
               coassignees:task_coassignees(user_id, profile:profiles!task_coassignees_user_id_fkey(*))`,
            )
            .eq("id", taskId)
            .maybeSingle(),
          true,
        ),
        readOwnedPart(
          supabase
            .from("task_events")
            .select("*, actor:profiles!task_events_actor_id_fkey(*)")
            .eq("task_id", taskId)
            .order("created_at", { ascending: true }),
        ),
        readOwnedPart(
          supabase
            .from("task_checklist_items")
            .select("*")
            .eq("task_id", taskId)
            .order("position", { ascending: true }),
        ),
        readOwnedPart(
          supabase
            .from("task_reminders")
            .select("*")
            .eq("task_id", taskId)
            .order("remind_at", { ascending: true }),
        ),
      ]);
      if (!isCurrent() || terminal) return;
      const errors = [taskRes.error, eventsRes.error, checklistRes.error, remindersRes.error];
      setState((previous) => {
        if (!isCurrent() || terminal) return previous;
        // Refusal/absence retires the entire dependent snapshot, never just its parent.
        if ([taskRes, eventsRes, checklistRes, remindersRes].some(isAccessDenied)) {
          return { ...emptyDetail(owner), error: "denied" };
        }
        if (!taskRes.error && !taskRes.data) return emptyDetail(owner);
        const held = previous.owner === owner ? previous : emptyDetail(owner);
        if (taskRes.error) return { ...held, loading: false, refreshing: false, error: "transient" };
        const row = taskRes.data as TaskWithPeople;
        return {
          ...held,
          task: { ...row, assignee: row.assignee ?? null, creator: row.creator ?? null, chat: row.chat ?? null },
          events: eventsRes.error ? held.events : (eventsRes.data ?? []).map((r) => ({
            ...(r as TaskEventWithActor), actor: (r as { actor?: Profile | null }).actor ?? null,
          })),
          checklist: checklistRes.error ? held.checklist : (checklistRes.data ?? []) as TaskChecklistItem[],
          reminders: remindersRes.error ? held.reminders : (remindersRes.data ?? []) as TaskReminder[],
          loading: false, refreshing: false, error: errors.some(Boolean) ? "transient" : null,
        };
      });
    } catch {
      // SDK query construction can also throw; never publish/log its error body.
      setState((previous) => {
        if (!isCurrent() || terminal) return previous;
        const held = previous.owner === owner ? previous : emptyDetail(owner);
        return { ...held, loading: false, refreshing: false, error: "transient" };
      });
    }
  }, [taskId, userId, accountEpoch, owner, supabase]);

  useEffect(() => {
    owner.active = true;
    if (!taskId || !userId) setState(emptyDetail(owner));
    else void fetchTask();
    return () => { owner.active = false; owner.request += 1; };
  }, [owner, taskId, userId, fetchTask]);

  // Realtime — server-side filter on task_id so we only get our row's events.
  useEffect(() => {
    if (!taskId || !userId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debouncedFetch = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void fetchTask();
      }, 250);
    };
    // One channel per table, through the helper, because a channel is only as
    // live as its least live binding — measured on production on 2026-09-05 and
    // written up in `lib/realtimeTableChannels.ts`. This effect carried `tasks`
    // and `task_events` on a single channel from the first commit in this
    // repository (c1ae9c67, 2026-05-05), which is the exact construction that
    // measurement outlawed. It reported SUBSCRIBED throughout, so nothing in
    // the client ever said the task detail modal was not live.
    //
    // Nothing here can be narrowed further and the policies say why, read
    // read-only on production on 2026-09-20: `tasks select scoped` routes
    // through `_task_visible_to_current_user_v3(assignee_id, created_by,
    // chat_id, visibility, assignment_scope, location_id, target_role,
    // route_admin_id, created_for_admin)` and `task_events select scoped`
    // reaches the same predicate through the parent row — neither keys on the
    // reader alone, so there is no reader-side column to filter by. The
    // per-row filters below are already the tightest possible: this modal
    // shows exactly one task. Both tables carry REPLICA IDENTITY FULL
    // (measured the same day), so `id` / `task_id` are present in the old
    // record and — by Supabase's documented rule that a filter reaches a
    // DELETE only under FULL, which is read rather than measured here — the
    // filters hold on DELETE as well as on INSERT and UPDATE.
    const channels = subscribeByTable<typeof debouncedFetch, RealtimeChannel>(
      rt,
      `tasks:detail:${taskId}`,
      [
        { event: "*", schema: "public", table: "tasks", filter: `id=eq.${taskId}`, handler: debouncedFetch },
        { event: "INSERT", schema: "public", table: "task_events", filter: `task_id=eq.${taskId}`, handler: debouncedFetch },
        // REPLICA IDENTITY FULL, as the other two, so a removal is heard too.
        { event: "*", schema: "public", table: "task_checklist_items", filter: `task_id=eq.${taskId}`, handler: debouncedFetch },
      ],
      (name, status) => {
        if (import.meta.env.DEV) console.debug("[tasks:detail]", name, status);
      },
    );
    for (const { name } of channels) registerChannel(name);
    return () => {
      if (timer) clearTimeout(timer);
      for (const { name, channel } of channels) {
        rt.removeChannel(channel);
        unregisterChannel(name);
      }
    };
  }, [taskId, userId, rt, fetchTask]);

  const visible = state.owner === owner ? state : emptyDetail(owner, Boolean(taskId && userId));
  return { task: visible.task, events: visible.events, checklist: visible.checklist, reminders: visible.reminders,
    loading: visible.loading, refreshing: visible.refreshing, error: visible.error, refetch: fetchTask };
}
