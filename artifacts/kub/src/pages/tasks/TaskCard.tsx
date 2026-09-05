"use client";

import type { ReactNode } from "react";
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
  selected?: boolean;
  selectionControl?: ReactNode;
}

export function TaskCard({ task, nowMs, onClick, selected = false, selectionControl }: TaskCardProps) {
  const status = TASK_STATUS_META[task.status];
  const priority = TASK_PRIORITY_META[task.priority];
  const visibility = TASK_VISIBILITY_META[task.visibility];
  const assignmentScope = TASK_ASSIGNMENT_SCOPE_META[task.assignment_scope];
  const isPoolAvailable = task.assignment_scope !== "user" && !task.assignee_id;
  const isRecurringTemplate = Boolean(task.recurrence_id && !task.recurrence_template_task_id);
  const isRecurringOccurrence = Boolean(task.recurrence_template_task_id);
  const isDeleted = Boolean(task.deleted_at);
  const deadline = getTaskDeadlineState(task, nowMs);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      className="text-left w-full rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
    >
      {/* Every edge state here is drawn with `outline`, and that is not a
          preference. `.kub-panel` sets `background`, `box-shadow` and the
          `border` shorthand, and it sits outside any cascade layer, so it beats
          Tailwind's utilities no matter what they say — an unlayered rule wins
          over a layered one regardless of order or specificity. Measured on the
          built stylesheet: a selected card composited to rgb(16,39,67) in the
          dark theme and a plain one to rgb(16,39,67) as well, a ratio of 1.000.
          The fill, the ring and the border colour were all present in the markup
          and none of them reached a pixel, so bulk selection in card mode was
          invisible while looking perfectly correct in the source.

          `outline` is the one edge property the panel does not claim. It follows
          `border-radius`, and a negative offset tucks it inside the card so the
          grid gap does not change. */}
      <KubPanel
        padded={false}
        className={cn(
          "p-3 flex flex-col gap-2.5 transition-colors cursor-pointer",
          "hover:outline-1 hover:-outline-offset-1 hover:outline-[color:var(--kub-cyan)]/40",
          selected && "outline-2 -outline-offset-1 outline-[color:var(--kub-cyan)]/65",
          isDeleted && "opacity-70 outline-1 -outline-offset-1 outline-[color:var(--kub-danger)]/35",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            {selectionControl}
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
          </div>
          <div className="flex flex-col gap-1 items-end flex-shrink-0">
            <KubBadge tone={status.tone} pill>{status.label}</KubBadge>
            <KubBadge tone={priority.tone} pill dot>
              {priority.label}
            </KubBadge>
            {isDeleted && <KubBadge tone="danger" pill>Удалена</KubBadge>}
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
          {isRecurringTemplate && (
            <KubBadge tone="cyan" pill>
              <KubIcon name="clock" size={11} className="mr-1" />
              Повторяется
            </KubBadge>
          )}
          {isRecurringOccurrence && (
            <KubBadge tone="muted" pill>
              Экземпляр повтора
            </KubBadge>
          )}
          {deadline.badgeLabel && (
            <KubBadge tone={deadline.tone} pill>
              {deadline.badgeLabel}
            </KubBadge>
          )}
          {isDeleted && (
            <KubBadge tone="danger" pill>
              Удалена
            </KubBadge>
          )}
        </div>

        <div className="kub-raise rounded-lg px-2.5 py-2">
          <div className="flex min-w-0 items-center justify-between gap-2 text-[12px]">
            <span className={cn(
              "flex min-w-0 items-center gap-1.5 font-medium",
              deadline.isOverdue && "text-[color:var(--kub-danger-text)]",
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

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-[color:var(--kub-muted)]">
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
    </div>
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
