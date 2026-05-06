"use client";

import type { TaskWithPeople } from "@/types/database";
import { KubBadge, KubIcon, KubPanel } from "@/components/kub";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import {
  TASK_ASSIGNMENT_SCOPE_META,
  TASK_PRIORITY_META,
  TASK_STATUS_META,
  TASK_VISIBILITY_META,
  formatTaskDueDate,
  formatRelative,
  getTaskDeadlineState,
} from "./taskMeta";
import { cn } from "@/lib/utils";

interface TaskCardProps {
  task: TaskWithPeople;
  nowMs: number;
  onClick: () => void;
}

export function TaskCard({ task, nowMs, onClick }: TaskCardProps) {
  const status = TASK_STATUS_META[task.status];
  const priority = TASK_PRIORITY_META[task.priority];
  const visibility = TASK_VISIBILITY_META[task.visibility];
  const assignmentScope = TASK_ASSIGNMENT_SCOPE_META[task.assignment_scope];
  const isPoolAvailable = task.assignment_scope !== "user" && !task.assignee_id;
  const deadline = getTaskDeadlineState(task, nowMs);

  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left w-full focus:outline-none"
    >
      <KubPanel
        padded={false}
        className="p-3 flex flex-col gap-2.5 hover:border-[color:var(--kub-cyan)]/40 transition-colors cursor-pointer"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-[color:var(--kub-text)] truncate">
              {task.title}
            </h3>
            {task.description && (
              <p className="mt-1 text-xs text-[color:var(--kub-muted)] line-clamp-1">
                {task.description}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1 items-end flex-shrink-0">
            <KubBadge tone={status.tone} pill>{status.label}</KubBadge>
            <KubBadge tone={priority.tone} pill dot>
              {priority.label}
            </KubBadge>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 min-w-0">
          <KubBadge tone={visibility.tone} pill>{visibility.label}</KubBadge>
          {task.assignment_scope !== "user" && (
            <KubBadge tone={assignmentScope.tone} pill>
              {assignmentScope.label}
            </KubBadge>
          )}
          {isPoolAvailable && (
            <KubBadge tone="online" pill>
              Доступна для взятия
            </KubBadge>
          )}
          {deadline.badgeLabel && (
            <KubBadge tone={deadline.tone} pill>
              {deadline.badgeLabel}
            </KubBadge>
          )}
        </div>

        <div className="rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-2.5 py-2">
          <div className="flex min-w-0 items-center justify-between gap-2 text-[11px]">
            <span className={cn(
              "flex min-w-0 items-center gap-1.5 font-medium",
              deadline.isOverdue && "text-[color:var(--kub-danger)]",
              deadline.isDueSoon && !deadline.isOverdue && "text-[color:var(--kub-warn)]",
              !deadline.isOverdue && !deadline.isDueSoon && "text-[color:var(--kub-text)]",
            )}>
              <KubIcon name={deadline.isOverdue || deadline.isDueSoon ? "warning" : "clock"} size={12} />
              <span className="truncate">{deadline.timeLabel}</span>
            </span>
            {task.due_at && (
              <span className="shrink-0 text-[color:var(--kub-muted)]">
                {formatTaskDueDate(task.due_at)}
              </span>
            )}
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--kub-border-color)_65%,transparent)]">
            {deadline.urgencyRatio !== null ? (
              <div
                className={cn("h-full rounded-full transition-[width] duration-300", deadlineFillClass(deadline.urgencyLevel))}
                style={{ width: `${deadline.fillPercent ?? 0}%` }}
              />
            ) : (
              <div className="h-full w-0" />
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-[color:var(--kub-muted)]">
          {task.assignee ? (
            <span className="flex max-w-full items-center gap-1.5 min-w-0">
              <UserAvatar user={task.assignee} size="sm" />
              <span className="truncate text-[color:var(--kub-text)]">
                {task.assignee.full_name ?? "Исполнитель"}
              </span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[color:var(--kub-warn)]">
              <KubIcon name="userPlus" size={12} />
              Без исполнителя
            </span>
          )}

          <span className="sm:ml-auto flex items-center gap-1">
            <KubIcon name="clock" size={12} />
            {formatRelative(task.updated_at)}
          </span>

        </div>
      </KubPanel>
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
