"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, getRealtimeClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import { bumpFetch, registerChannel, unregisterChannel } from "@/lib/dev/instrumentation";
import { mapPgError } from "@/lib/errors";
import {
  heldListCleared,
  heldListPending,
  heldListRefused,
  heldListSucceeded,
  listReadView,
  type HeldList,
} from "@/lib/listReadState";
import { plainFailure, TASKS_UNAVAILABLE } from "@/lib/plainMessages";
import type {
  TaskAssignmentScope,
  Profile,
  TaskStatus,
  TaskVisibility,
  TaskWithPeople,
} from "@/types/database";

/**
 * Filter for the tasks list:
 *   - mine='assigned'  → tasks where I am the assignee
 *   - mine='created'   → tasks I created
 *   - mine='all'       → every task I can see (admin/manager only)
 *
 * `statuses` narrows by status. Empty/omitted means "any status".
 *
 * Realtime: per-user channel scoped per `mine`. Имя стабильное, lifecycle
 * привязан к примитиву `userId` — без объекта `currentUser` в зависимостях,
 * чтобы heartbeat-echo не пересоздавал канал.
 */
export interface TasksFilter {
  mine: "assigned" | "created" | "all";
  statuses?: TaskStatus[];
  assignmentScopes?: TaskAssignmentScope[];
  visibilities?: TaskVisibility[];
  assignee?: "unassigned";
}

export function useTasks(filter: TasksFilter, options: { enabled?: boolean } = {}) {
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const [read, setRead] = useState<HeldList<TaskWithPeople>>(() => heldListPending<TaskWithPeople>());
  const tasks = read.rows;
  const supabase = useMemo(() => createClient(), []);
  const rt = useMemo(() => getRealtimeClient(), []);
  const enabled = options.enabled ?? true;

  // Стабильный строковый ключ для filter.statuses, чтобы массив не плодил
  // новые callback identity при тех же значениях.
  const statusKey = (filter.statuses ?? []).slice().sort().join(",");
  const assignmentScopeKey = (filter.assignmentScopes ?? []).slice().sort().join(",");
  const visibilityKey = (filter.visibilities ?? []).slice().sort().join(",");
  // The question these rows answer. A refused read keeps what is on screen and
  // says it may be old — but only while it is still an answer to the same
  // question; rows read for another account or another filter are nobody's old
  // answer. `lib/listReadState.ts` holds that rule.
  const subject = [
    userId ?? "",
    filter.mine,
    statusKey,
    assignmentScopeKey,
    visibilityKey,
    filter.assignee ?? "",
  ].join("|");

  const fetchTasks = useCallback(async () => {
    if (!userId) return;
    if (!enabled) {
      // This account is not shown the list at all. That is an answer, and an
      // empty one is the right way to say it — unlike a read nobody could make.
      setRead(heldListCleared<TaskWithPeople>());
      return;
    }
    bumpFetch("useTasks");
    let q = supabase
      .from("tasks")
      .select(
        `*,
         assignee:profiles!tasks_assignee_id_fkey(*),
         creator:profiles!tasks_created_by_fkey(*)`,
      )
      // Sort by urgency first (enum order is low<normal<high<urgent in the
      // DB, so DESC gives urgent → low), then by recency so two tasks of
      // the same priority surface the freshest one.
      .order("priority", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(200);

    if (filter.mine === "assigned") q = q.eq("assignee_id", userId);
    else if (filter.mine === "created") q = q.eq("created_by", userId);

    if (filter.statuses && filter.statuses.length > 0) {
      q = q.in("status", filter.statuses);
    }
    if (filter.assignmentScopes && filter.assignmentScopes.length > 0) {
      q = q.in("assignment_scope", filter.assignmentScopes);
    }
    if (filter.visibilities && filter.visibilities.length > 0) {
      q = q.in("visibility", filter.visibilities);
    }
    if (filter.assignee === "unassigned") {
      q = q.is("assignee_id", null);
    }

    const { data, error } = await q;
    if (error) {
      // F-6. This said `setTasks([])`, and the page then drew «Нет доступных
      // задач» with a «Создать задачу» beside it — a refusal told as "you are
      // all caught up". The SELECT policy here calls a nine-argument plpgsql
      // function, and the restrictive «block banned» policy on this table
      // answers with emptiness rather than with an error, so both halves of the
      // failure land on this line.
      if (import.meta.env.DEV) console.error("[useTasks] fetch failed", error);
      setRead((previous) =>
        heldListRefused(previous, {
          subject,
          message: plainFailure(mapPgError(error), TASKS_UNAVAILABLE),
        }),
      );
      return;
    }
    setRead(
      heldListSucceeded(
        (data ?? []).map((row) => ({
          ...(row as TaskWithPeople),
          assignee: (row as { assignee?: Profile | null }).assignee ?? null,
          creator:  (row as { creator?: Profile | null }).creator ?? null,
        })),
        subject,
      ),
    );
  }, [userId, enabled, supabase, subject, filter.mine, statusKey, assignmentScopeKey, visibilityKey, filter.assignee]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  // Realtime: any change to tasks I can see → debounced refetch.
  useEffect(() => {
    if (!userId || !enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(fetchTasks, 250);
    };
    const channelName = `tasks:user:${userId}:${filter.mine}`;
    const channel = rt
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, debounced)
      .subscribe((status: string) => {
        if (import.meta.env.DEV) console.debug("[tasks:user]", userId, status);
      });
    registerChannel(channelName);
    return () => {
      if (timer) clearTimeout(timer);
      rt.removeChannel(channel);
      unregisterChannel(channelName);
    };
  }, [userId, enabled, rt, fetchTasks, filter.mine]);

  return {
    tasks,
    loading: read.loading,
    /** The refused read's sentence, or null. Already in a person's words. */
    error: read.error,
    /** `loading | unavailable | stale | ready` — see `lib/listReadState.ts`. */
    view: listReadView(read),
    refetch: fetchTasks,
  };
}
