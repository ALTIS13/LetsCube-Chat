"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, getRealtimeClient } from "@/lib/supabase/client";
import { bumpFetch, registerChannel, unregisterChannel } from "@/lib/dev/instrumentation";
import { subscribeByTable } from "@/lib/realtimeTableChannels";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type {
  Chat,
  Profile,
  TaskEventWithActor,
  TaskWithPeople,
} from "@/types/database";

/**
 * Loads a single task with its full event history and subscribes to realtime
 * changes on both the task row and its events.  Used by TaskDetailModal.
 */
export function useTask(taskId: string | null) {
  const [task, setTask] = useState<TaskWithPeople | null>(null);
  const [events, setEvents] = useState<TaskEventWithActor[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);
  const rt = useMemo(() => getRealtimeClient(), []);

  const fetchTask = useCallback(async () => {
    if (!taskId) {
      setTask(null);
      setEvents([]);
      setLoading(false);
      return;
    }
    bumpFetch("useTask");
    setLoading(true);
    const [taskRes, eventsRes] = await Promise.all([
      supabase
        .from("tasks")
        .select(
          `*,
           assignee:profiles!tasks_assignee_id_fkey(*),
           creator:profiles!tasks_created_by_fkey(*),
           chat:chats(*)`,
        )
        .eq("id", taskId)
        .maybeSingle(),
      supabase
        .from("task_events")
        .select("*, actor:profiles!task_events_actor_id_fkey(*)")
        .eq("task_id", taskId)
        .order("created_at", { ascending: true }),
    ]);

    if (taskRes.error || !taskRes.data) {
      setTask(null);
    } else {
      const row = taskRes.data as TaskWithPeople;
      setTask({
        ...row,
        assignee: (row as { assignee?: Profile | null }).assignee ?? null,
        creator:  (row as { creator?: Profile | null }).creator ?? null,
        chat: (row as { chat?: Chat | null }).chat ?? null,
      });
    }
    setEvents(
      (eventsRes.data ?? []).map((r) => ({
        ...(r as TaskEventWithActor),
        actor: (r as { actor?: Profile | null }).actor ?? null,
      })),
    );
    setLoading(false);
  }, [taskId, supabase]);

  useEffect(() => { fetchTask(); }, [fetchTask]);

  // Realtime — server-side filter on task_id so we only get our row's events.
  useEffect(() => {
    if (!taskId) return;
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
  }, [taskId, rt, fetchTask]);

  return { task, events, loading, refetch: fetchTask };
}
