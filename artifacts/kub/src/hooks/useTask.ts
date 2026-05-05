"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, getRealtimeClient } from "@/lib/supabase/client";
import type {
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
    setLoading(true);
    const [taskRes, eventsRes] = await Promise.all([
      supabase
        .from("tasks")
        .select(
          `*,
           assignee:profiles!tasks_assignee_id_fkey(*),
           creator:profiles!tasks_created_by_fkey(*)`,
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
    const channel = rt
      .channel(`tasks:detail:${taskId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks", filter: `id=eq.${taskId}` },
        debouncedFetch,
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "task_events", filter: `task_id=eq.${taskId}` },
        debouncedFetch,
      )
      .subscribe((status: string) => {
        if (import.meta.env.DEV) console.debug("[tasks:detail]", taskId, status);
      });
    return () => {
      if (timer) clearTimeout(timer);
      rt.removeChannel(channel);
    };
  }, [taskId, rt, fetchTask]);

  return { task, events, loading, refetch: fetchTask };
}
