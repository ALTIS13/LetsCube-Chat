"use client";

import { useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { mapPgError } from "@/lib/errors";
import type { Json } from "@/types/database";

type ErrorLike = { message?: unknown; code?: unknown; details?: unknown; hint?: unknown } | null | undefined;

export interface BulkSoftDeleteResult {
  deletedCount: number;
  failedCount: number;
  error: string | null;
}

export const TASK_DELETE_MIGRATION_REQUIRED = "Удаление задач требует обновления базы данных.";

export function useTaskSoftDelete() {
  const supabase = useMemo(() => createClient(), []);

  const softDeleteTask = useCallback(async (taskId: string, reason: string | null = null): Promise<{ error: string | null }> => {
    const { error } = await supabase.rpc("task_soft_delete", {
      p_task_id: taskId,
      p_reason: reason,
    });
    if (error) {
      if (import.meta.env.DEV) console.warn("[task-soft-delete] failed", error);
      return { error: mapTaskSoftDeleteError(error) };
    }
    return { error: null };
  }, [supabase]);

  const bulkSoftDeleteTasks = useCallback(async (
    taskIds: string[],
    reason: string | null = null,
  ): Promise<BulkSoftDeleteResult> => {
    if (taskIds.length === 0) return { deletedCount: 0, failedCount: 0, error: null };
    const { data, error } = await supabase.rpc("task_bulk_soft_delete", {
      p_task_ids: taskIds,
      p_reason: reason,
    });
    if (error) {
      if (import.meta.env.DEV) console.warn("[task-soft-delete] bulk failed", error);
      return { deletedCount: 0, failedCount: taskIds.length, error: mapTaskSoftDeleteError(error) };
    }
    const result = parseBulkResult(data);
    if (result.failedCount > 0) {
      return {
        ...result,
        error: result.deletedCount > 0
          ? "Часть задач не удалось удалить."
          : "Не удалось удалить выбранные задачи.",
      };
    }
    return { ...result, error: null };
  }, [supabase]);

  return { softDeleteTask, bulkSoftDeleteTasks };
}

export function mapTaskSoftDeleteError(err: ErrorLike): string {
  const message = typeof err?.message === "string" ? err.message : "";
  const code = typeof err?.code === "string" ? err.code : "";
  const text = `${code} ${message}`.toLowerCase();

  if (
    text.includes("task_soft_delete") ||
    text.includes("task_bulk_soft_delete") ||
    text.includes("task_restore") ||
    text.includes("schema cache") ||
    text.includes("could not find the function")
  ) {
    return TASK_DELETE_MIGRATION_REQUIRED;
  }
  if (text.includes("active_recurrence_template_delete_blocked")) {
    return "Нельзя удалить шаблон активного повторения. Сначала остановите повторение.";
  }
  if (text.includes("task_already_deleted")) return "Задача уже удалена.";
  if (text.includes("forbidden") || code === "42501" || text.includes("permission denied")) {
    return "Недостаточно прав для удаления задачи.";
  }
  return mapPgError(err);
}

function parseBulkResult(data: Json | null): { deletedCount: number; failedCount: number } {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { deletedCount: 0, failedCount: 0 };
  }
  const record = data as Record<string, Json | undefined>;
  const deletedCount = typeof record.deleted_count === "number" ? record.deleted_count : 0;
  const failedCount = typeof record.failed_count === "number" ? record.failed_count : 0;
  return { deletedCount, failedCount };
}
