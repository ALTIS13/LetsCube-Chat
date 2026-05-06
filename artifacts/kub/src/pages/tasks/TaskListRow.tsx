"use client";

import type { TaskWithPeople } from "@/types/database";
import { KubBadge, KubIcon } from "@/components/kub";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import {
  TASK_ASSIGNMENT_SCOPE_META,
  TASK_PRIORITY_META,
  TASK_STATUS_META,
  TASK_VISIBILITY_META,
  formatTaskDueDate,
  getTaskDeadlineState,
} from "./taskMeta";
import { cn } from "@/lib/utils";

interface TaskListRowProps {
  task: TaskWithPeople;
  nowMs: number;
  onClick: () => void;
}

export function TaskListRow({ task, nowMs, onClick }: TaskListRowProps) {
  const status = TASK_STATUS_META[task.status];
  const priority = TASK_PRIORITY_META[task.priority];
  const visibility = TASK_VISIBILITY_META[task.visibility];
  const assignmentScope = TASK_ASSIGNMENT_SCOPE_META[task.assignment_scope];
  const deadline = getTaskDeadlineState(task, nowMs);
  const assigneeName = task.assignee?.full_name ?? task.assignee?.username ?? "Исполнитель";

  return (
    <button
      type="button"
      onClick={onClick}
      className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 py-2.5 text-left transition-colors hover:border-[color:var(--kub-cyan)]/40 sm:grid-cols-[minmax(180px,1.5fr)_minmax(140px,0.8fr)_minmax(160px,1fr)_minmax(160px,0.8fr)_auto]"
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-[color:var(--kub-text)]">{task.title}</div>
        {task.description && (
          <div className="mt-0.5 truncate text-xs text-[color:var(--kub-muted)]">{task.description}</div>
        )}
        <div className="mt-1 flex min-w-0 items-center gap-1.5 sm:hidden">
          <KubBadge tone={status.tone} pill>{status.label}</KubBadge>
          <span
            className={cn(
              "min-w-0 truncate text-[11px] font-medium",
              deadline.isOverdue && "text-[color:var(--kub-danger)]",
              deadline.isDueSoon && !deadline.isOverdue && "text-[color:var(--kub-warn)]",
              !deadline.isOverdue && !deadline.isDueSoon && "text-[color:var(--kub-muted)]",
            )}
          >
            {deadline.timeLabel}
          </span>
        </div>
      </div>

      <div className="hidden min-w-0 items-center gap-1.5 sm:flex">
        {task.assignee ? (
          <>
            <UserAvatar user={task.assignee} size="sm" />
            <span className="truncate text-xs font-medium text-[color:var(--kub-text)]">{assigneeName}</span>
          </>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[color:var(--kub-warn)]">
            <KubIcon name="userPlus" size={12} />
            Без исполнителя
          </span>
        )}
      </div>

      <div className="hidden min-w-0 sm:block">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span
            className={cn(
              "min-w-0 truncate font-medium",
              deadline.isOverdue && "text-[color:var(--kub-danger)]",
              deadline.isDueSoon && !deadline.isOverdue && "text-[color:var(--kub-warn)]",
              !deadline.isOverdue && !deadline.isDueSoon && "text-[color:var(--kub-text)]",
            )}
          >
            {deadline.timeLabel}
          </span>
          {task.due_at && (
            <span className="shrink-0 text-[11px] text-[color:var(--kub-muted)]">
              {formatTaskDueDate(task.due_at)}
            </span>
          )}
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--kub-border-color)_65%,transparent)]">
          {deadline.fillPercent !== null && (
            <div
              className={cn("h-full rounded-full transition-[width] duration-300", deadlineFillClass(deadline.urgencyLevel))}
              style={{ width: `${deadline.fillPercent}%` }}
            />
          )}
        </div>
      </div>

      <div className="hidden min-w-0 flex-wrap items-center gap-1 sm:flex">
        <KubBadge tone={status.tone} pill>{status.label}</KubBadge>
        <KubBadge tone={priority.tone} pill dot>{priority.label}</KubBadge>
        <KubBadge tone={visibility.tone} pill>{visibility.label}</KubBadge>
        {task.assignment_scope !== "user" && (
          <KubBadge tone={assignmentScope.tone} pill>{assignmentScope.label}</KubBadge>
        )}
      </div>

      <div className="flex items-center justify-end">
        <KubIcon name="chevronRight" size={16} className="text-[color:var(--kub-muted)]" />
      </div>
    </button>
  );
}

function deadlineFillClass(level: ReturnType<typeof getTaskDeadlineState>["urgencyLevel"]): string {
  switch (level) {
    case "safe":
      return "bg-[var(--kub-online)]";
    case "lime":
      return "bg-[color-mix(in_srgb,var(--kub-warn)_55%,var(--kub-online))]";
    case "orange":
      return "bg-[var(--kub-warn)]";
    case "red":
      return "bg-[color-mix(in_srgb,var(--kub-danger)_72%,var(--kub-warn))]";
    case "danger":
      return "bg-[var(--kub-danger)]";
    default:
      return "bg-[color:var(--kub-border-color)]";
  }
}
