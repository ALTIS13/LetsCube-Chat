"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, getRealtimeClient } from "@/lib/supabase/client";
import { registerChannel, unregisterChannel } from "@/lib/dev/instrumentation";
import {
  RECURRING_TASKS_REQUIRED_MESSAGE,
  isRecurringTasksMissingError,
  isRecurringTasksPermissionError,
  mapRecurringTaskError,
} from "@/lib/recurringTasks";
import type { Database, TaskRecurrence, TaskRecurrenceFrequency } from "@/types/database";

export type RecurringFeatureStatus = "loading" | "available" | "missing" | "denied" | "error";

interface RecurringFeatureState {
  status: RecurringFeatureStatus;
  available: boolean;
  checked: boolean;
  loading: boolean;
  message: string | null;
  refetch: () => Promise<void>;
}

export interface RecurrenceCreateInput {
  templateTaskId: string;
  frequency: TaskRecurrenceFrequency;
  intervalCount: number;
  byWeekday: number[] | null;
  byMonthday: number | null;
  startsAt: string;
  endAt: string | null;
  maxOccurrences: number | null;
}

type RecurrenceCreateArgs = Database["public"]["Functions"]["task_recurrence_create"]["Args"];
type RecurrenceUpdateArgs = Database["public"]["Functions"]["task_recurrence_update"]["Args"];

let availabilityCache: Pick<RecurringFeatureState, "status" | "message" | "checked"> | null = null;

export function useRecurringTasksAvailability(enabled = true): RecurringFeatureState {
  const supabase = useMemo(() => createClient(), []);
  const cached = enabled ? availabilityCache : null;
  const [status, setStatus] = useState<RecurringFeatureStatus>(cached?.status ?? (enabled ? "loading" : "missing"));
  const [message, setMessage] = useState<string | null>(cached?.message ?? (enabled ? null : RECURRING_TASKS_REQUIRED_MESSAGE));
  const [checked, setChecked] = useState(cached?.checked ?? false);

  const probe = useCallback(async () => {
    if (!enabled) {
      availabilityCache = null;
      setStatus("missing");
      setMessage(RECURRING_TASKS_REQUIRED_MESSAGE);
      setChecked(true);
      return;
    }

    if (availabilityCache) {
      setStatus(availabilityCache.status);
      setMessage(availabilityCache.message);
      setChecked(availabilityCache.checked);
      return;
    }

    setStatus("loading");
    setMessage(null);
    const { error } = await supabase
      .from("task_recurrences")
      .select("id")
      .limit(1);

    if (!error) {
      availabilityCache = { status: "available", message: null, checked: true };
      setStatus("available");
      setMessage(null);
      setChecked(true);
      return;
    }

    if (isRecurringTasksMissingError(error)) {
      availabilityCache = { status: "missing", message: RECURRING_TASKS_REQUIRED_MESSAGE, checked: true };
      setStatus("missing");
      setMessage(RECURRING_TASKS_REQUIRED_MESSAGE);
    } else if (isRecurringTasksPermissionError(error)) {
      availabilityCache = { status: "denied", message: "Недостаточно прав для просмотра повторяемых задач.", checked: true };
      setStatus("denied");
      setMessage("Недостаточно прав для просмотра повторяемых задач.");
    } else {
      setStatus("error");
      setMessage("Не удалось загрузить повторяемые задачи. Попробуйте ещё раз.");
      if (import.meta.env.DEV) console.warn("[recurring-tasks] probe failed", error);
    }
    setChecked(true);
  }, [enabled, supabase]);

  useEffect(() => {
    void probe();
  }, [probe]);

  return {
    status,
    available: status === "available",
    checked,
    loading: status === "loading",
    message,
    refetch: probe,
  };
}

export function useTaskRecurrence(recurrenceId: string | null | undefined) {
  const supabase = useMemo(() => createClient(), []);
  const rt = useMemo(() => getRealtimeClient(), []);
  const [recurrence, setRecurrence] = useState<TaskRecurrence | null>(null);
  const [status, setStatus] = useState<RecurringFeatureStatus>(recurrenceId ? "loading" : "missing");
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!recurrenceId) {
      setRecurrence(null);
      setStatus("missing");
      setMessage(null);
      return;
    }

    setStatus("loading");
    setMessage(null);
    const { data, error } = await supabase
      .from("task_recurrences")
      .select("*")
      .eq("id", recurrenceId)
      .maybeSingle();

    if (!error) {
      setRecurrence((data ?? null) as TaskRecurrence | null);
      setStatus("available");
      return;
    }

    setRecurrence(null);
    if (isRecurringTasksMissingError(error)) {
      setStatus("missing");
      setMessage(RECURRING_TASKS_REQUIRED_MESSAGE);
    } else if (isRecurringTasksPermissionError(error)) {
      setStatus("denied");
      setMessage("Недостаточно прав для просмотра повторения.");
    } else {
      setStatus("error");
      setMessage("Не удалось загрузить повторение.");
      if (import.meta.env.DEV) console.warn("[task-recurrence] load failed", error);
    }
  }, [recurrenceId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!recurrenceId || status !== "available") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void load();
      }, 250);
    };
    const channelName = `task-recurrence:${recurrenceId}`;
    const channel = rt
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_recurrences", filter: `id=eq.${recurrenceId}` }, debounced)
      .subscribe((nextStatus: string) => {
        if (import.meta.env.DEV) console.debug("[task-recurrence]", recurrenceId, nextStatus);
      });
    registerChannel(channelName);
    return () => {
      if (timer) clearTimeout(timer);
      rt.removeChannel(channel);
      unregisterChannel(channelName);
    };
  }, [recurrenceId, rt, load, status]);

  return { recurrence, status, message, refetch: load };
}

export async function createTaskRecurrence(input: RecurrenceCreateInput) {
  const supabase = createClient();
  const args: RecurrenceCreateArgs = {
    p_template_task_id: input.templateTaskId,
    p_frequency: input.frequency,
    p_interval_count: input.intervalCount,
    p_by_weekday: input.byWeekday,
    p_by_monthday: input.byMonthday,
    p_starts_at: input.startsAt,
    p_end_at: input.endAt,
    p_max_occurrences: input.maxOccurrences,
  };
  const { data, error } = await supabase.rpc("task_recurrence_create", args);
  return { data: data as string | null, error: error ? mapRecurringTaskError(error) : null };
}

export async function updateTaskRecurrence(recurrenceId: string, input: Omit<RecurrenceCreateInput, "templateTaskId" | "startsAt"> & {
  nextRunAt: string | null;
}) {
  const supabase = createClient();
  const args: RecurrenceUpdateArgs = {
    p_recurrence_id: recurrenceId,
    p_frequency: input.frequency,
    p_interval_count: input.intervalCount,
    p_by_weekday: input.byWeekday,
    p_by_monthday: input.byMonthday,
    p_next_run_at: input.nextRunAt,
    p_end_at: input.endAt,
    p_max_occurrences: input.maxOccurrences,
  };
  const { error } = await supabase.rpc("task_recurrence_update", args);
  return { error: error ? mapRecurringTaskError(error) : null };
}

export async function pauseTaskRecurrence(recurrenceId: string) {
  const supabase = createClient();
  const { error } = await supabase.rpc("task_recurrence_pause", { p_recurrence_id: recurrenceId });
  return { error: error ? mapRecurringTaskError(error) : null };
}

export async function resumeTaskRecurrence(recurrenceId: string) {
  const supabase = createClient();
  const { error } = await supabase.rpc("task_recurrence_resume", { p_recurrence_id: recurrenceId });
  return { error: error ? mapRecurringTaskError(error) : null };
}

export async function stopTaskRecurrence(recurrenceId: string) {
  const supabase = createClient();
  const { error } = await supabase.rpc("task_recurrence_stop", { p_recurrence_id: recurrenceId });
  return { error: error ? mapRecurringTaskError(error) : null };
}
