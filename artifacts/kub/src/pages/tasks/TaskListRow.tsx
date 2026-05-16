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
  const isRecurringTemplate = Boolean(task.recurrence_id && !task.recurrence_template_task_id);
  const isRecurringOccurrence = Boolean(task.recurrence_template_task_id);
  const isDeleted = Boolean(task.deleted_at);
  const assigneeName = getPersonName(task.assignee, "Без исполнителя");
  const creatorName = getPersonName(task.creator, "Неизвестно");

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 py-2.5 text-left transition-colors hover:border-[color:var(--kub-cyan)]/40 sm:grid-cols-[minmax(180px,1.5fr)_minmax(140px,0.8fr)_minmax(160px,1fr)_minmax(160px,0.8fr)_auto]",
        isDeleted && "opacity-70 border-[color:var(--kub-danger)]/35",
      )}
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-[color:var(--kub-text)]">{task.title}</div>
        {task.description && (
          <div className="mt-0.5 truncate text-xs text-[color:var(--kub-muted)]">{task.description}</div>
        )}
        <div className="mt-1 flex min-w-0 items-center gap-1.5 sm:hidden">
          <KubBadge tone={status.tone} pill>{status.label}</KubBadge>
          {isDeleted && <KubBadge tone="danger" pill>Удалена</KubBadge>}
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
        <div className="mt-1 grid min-w-0 grid-cols-1 gap-0.5 text-[11px] text-[color:var(--kub-muted)] sm:hidden">
          <MetaText label="Исполнитель" value={assigneeName} warn={!task.assignee} />
          <MetaText label="Создал" value={creatorName} />
        </div>
      </div>

      <div className="hidden min-w-0 flex-col justify-center gap-1 sm:flex">
        {task.assignee ? (
          <PersonLine label="Исполнитель" name={assigneeName} avatar={task.assignee} />
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[color:var(--kub-warn)]">
            <KubIcon name="userPlus" size={12} />
            Без исполнителя
          </span>
        )}
        <PersonLine label="Создал" name={creatorName} avatar={task.creator ?? null} muted />
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
        {isRecurringTemplate && <KubBadge tone="cyan" pill>Повторяется</KubBadge>}
        {isRecurringOccurrence && <KubBadge tone="muted" pill>Экземпляр повтора</KubBadge>}
        {isDeleted && <KubBadge tone="danger" pill>Удалена</KubBadge>}
      </div>

      <div className="flex items-center justify-end">
        <KubIcon name="chevronRight" size={16} className="text-[color:var(--kub-muted)]" />
      </div>
    </button>
  );
}

function getPersonName(
  person: TaskWithPeople["assignee"] | TaskWithPeople["creator"] | null | undefined,
  fallback: string,
): string {
  return person?.full_name?.trim() || person?.username?.trim() || fallback;
}

function MetaText({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <span className="min-w-0 truncate">
      <span className="text-[color:var(--kub-muted)]">{label}: </span>
      <span className={cn("font-medium", warn ? "text-[color:var(--kub-warn)]" : "text-[color:var(--kub-text)]")}>
        {value}
      </span>
    </span>
  );
}

function PersonLine({
  label,
  name,
  avatar,
  muted = false,
}: {
  label: string;
  name: string;
  avatar: TaskWithPeople["assignee"] | TaskWithPeople["creator"] | null;
  muted?: boolean;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={`${label}: ${name}`}>
      {avatar ? <UserAvatar user={avatar} size="sm" /> : <KubIcon name="user" size={12} />}
      <span className="min-w-0">
        <span className="block text-[10px] uppercase leading-none tracking-wide text-[color:var(--kub-muted)]">
          {label}
        </span>
        <span className={cn("block truncate text-xs font-medium", muted ? "text-[color:var(--kub-muted)]" : "text-[color:var(--kub-text)]")}>
          {name}
        </span>
      </span>
    </span>
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
