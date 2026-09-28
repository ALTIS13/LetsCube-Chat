"use client";

import { useEffect, useState } from "react";
import { CONNECTION_REVIVED_EVENT } from "@/lib/realtimeRevival";
import { registerChannel, unregisterChannel } from "@/lib/dev/instrumentation";
import { createClient, getRealtimeClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import type { TaskStatus } from "@/types/database";

/**
 * «В работе», as the tasks page's own «active» filter says it: taken and not
 * yet handed back — `accepted` and `in_progress`, assigned to this person.
 */
export const TASKS_IN_WORK_STATUSES: readonly TaskStatus[] = ["accepted", "in_progress"];

/** A burst of task events is one recount. */
const RECOUNT_DELAY_MS = 800;

/**
 * How many tasks this person has in work, for the count on the folder rail's
 * «Задачи» (tracker item 64): «на этой иконке была цифра сколько задач у тебя
 * сейчас в работе».
 *
 * One `HEAD` count — no rows cross the network — asked on mount, when the
 * window comes back, after a reconnection, and a moment after any task this
 * person can see changes: `public.tasks` is in the realtime publication with
 * its old rows (REPLICA IDENTITY FULL, read 2026-09-28), so a task taken from
 * them is heard as surely as one handed to them. Null until it has answered
 * once, and after a refused read — a count nobody could read is not zero.
 */
export function useTasksInWork(enabled: boolean): number | null {
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled || !userId) {
      setCount(null);
      return undefined;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const supabase = createClient();

    const recount = async () => {
      const { count: answered, error } = await supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("assignee_id", userId)
        .in("status", [...TASKS_IN_WORK_STATUSES])
        .is("deleted_at", null);
      if (!active) return;
      setCount(error ? null : answered ?? null);
    };
    const soon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void recount(), RECOUNT_DELAY_MS);
    };
    void recount();

    const rt = getRealtimeClient();
    const channelName = `tasks-in-work:user:${userId}`;
    const channel = rt
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, soon)
      .subscribe();
    registerChannel(channelName);

    const onVisible = () => {
      if (document.visibilityState === "visible") soon();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(CONNECTION_REVIVED_EVENT, soon);

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      rt.removeChannel(channel);
      unregisterChannel(channelName);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(CONNECTION_REVIVED_EVENT, soon);
    };
  }, [enabled, userId]);

  return count;
}
