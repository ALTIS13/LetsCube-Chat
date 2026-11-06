"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient, getRealtimeClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import { bumpFetch, registerChannel, unregisterChannel } from "@/lib/dev/instrumentation";
import { subscribeByTable } from "@/lib/realtimeTableChannels";
import type { RealtimeChannel } from "@supabase/supabase-js";
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
  const accountEpoch = useAppStore((s) => s.accountEpoch);
  const [heldRead, setRead] = useState<HeldList<TaskWithPeople>>(() => heldListPending<TaskWithPeople>());
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
    accountEpoch,
    filter.mine,
    statusKey,
    assignmentScopeKey,
    visibilityKey,
    filter.assignee ?? "",
  ].join("|");
  const owner = useMemo(() => ({ active: false, request: 0 }), [subject, enabled]);
  const ownerRef = useRef(owner);
  ownerRef.current = owner;

  const fetchTasks = useCallback(async () => {
    const isOwner = () => owner.active && ownerRef.current === owner &&
      (useAppStore.getState().currentUser?.id ?? null) === userId &&
      useAppStore.getState().accountEpoch === accountEpoch;
    if (!isOwner()) return;
    if (!userId || !enabled) {
      // This account is not shown the list at all. That is an answer, and an
      // empty one is the right way to say it — unlike a read nobody could make.
      setRead(heldListCleared<TaskWithPeople>());
      return;
    }
    const request = ++owner.request;
    const isCurrent = () => isOwner() && request === owner.request;
    bumpFetch("useTasks");
    let response: { data: unknown[] | null; error: unknown; status?: number };
    try {
      let q = supabase
        .from("tasks")
        .select(
          `*,
           assignee:profiles!tasks_assignee_id_fkey(*),
           creator:profiles!tasks_created_by_fkey(*),
           checklist:task_checklist_items(done),
           coassignees:task_coassignees(user_id, profile:profiles!task_coassignees_user_id_fkey(*))`,
        )
        // Urgency first, then recency within each priority.
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

      response = await q;
    } catch (error) {
      response = { data: null, error: error || true };
    }
    if (!isCurrent()) return;
    const { data, error } = response;
    const detail = typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
    const denied = response.status === 401 || response.status === 403 ||
      detail.status === 401 || detail.status === 403 || detail.statusCode === 401 || detail.statusCode === 403 ||
      detail.code === "42501" || detail.code === "PGRST301" || detail.code === "PGRST302" || detail.code === "PGRST303";
    if (error || denied) {
      // Transient failure may retain same-session rows; explicit auth refusal cannot.
      setRead((current) => {
        if (!isCurrent()) return current;
        const previous = denied ? heldListPending<TaskWithPeople>() : current;
        return heldListRefused(previous, {
          subject,
          message: plainFailure(mapPgError(error), TASKS_UNAVAILABLE),
        });
      });
      return;
    }
    setRead((previous) => isCurrent() ?
      heldListSucceeded(
        (data ?? []).map((row) => ({
          ...(row as TaskWithPeople),
          assignee: (row as { assignee?: Profile | null }).assignee ?? null,
          creator:  (row as { creator?: Profile | null }).creator ?? null,
        })),
        subject,
      ) : previous,
    );
  }, [userId, accountEpoch, owner, enabled, supabase, subject, filter.mine, statusKey, assignmentScopeKey, visibilityKey, filter.assignee]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    owner.active = true;
    void fetchTasks();
    return () => { owner.active = false; owner.request += 1; };
  }, [owner, fetchTasks]);

  // Revalidate through the same RLS query for Realtime and foreground recovery.
  useEffect(() => {
    if (!userId || !enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(fetchTasks, 250);
    };
    // Revoked readers may not receive the change that removed their access.
    const revalidateVisible = () => {
      if (document.visibilityState === "visible") debounced();
    };
    // One channel per table (`lib/realtimeTableChannels.ts`): the tasks, and
    // their checklists, whose progress the cards show (tracker item 62).
    const channels = subscribeByTable<typeof debounced, RealtimeChannel>(
      rt,
      `tasks:user:${userId}:${filter.mine}`,
      [
        { event: "*", schema: "public", table: "tasks", handler: debounced },
        { event: "*", schema: "public", table: "task_checklist_items", handler: debounced },
      ],
      (name, status) => {
        if (import.meta.env.DEV) console.debug("[tasks:user]", name, status);
      },
    );
    for (const { name } of channels) registerChannel(name);
    document.addEventListener("visibilitychange", revalidateVisible);
    window.addEventListener("online", revalidateVisible);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", revalidateVisible);
      window.removeEventListener("online", revalidateVisible);
      for (const { name, channel } of channels) {
        rt.removeChannel(channel);
        unregisterChannel(name);
      }
    };
  }, [userId, enabled, rt, fetchTasks, filter.mine]);

  const read = !userId || !enabled ? heldListCleared<TaskWithPeople>() :
    heldRead.subject === subject ? heldRead : heldListPending<TaskWithPeople>();
  return {
    tasks: read.rows,
    loading: read.loading,
    /** The refused read's sentence, or null. Already in a person's words. */
    error: read.error,
    /** `loading | unavailable | stale | ready` — see `lib/listReadState.ts`. */
    view: listReadView(read),
    refetch: fetchTasks,
  };
}
