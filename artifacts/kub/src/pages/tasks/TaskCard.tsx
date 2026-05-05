"use client";

import type { TaskWithPeople } from "@/types/database";
import { KubBadge, KubIcon, KubPanel } from "@/components/kub";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import {
  TASK_ASSIGNMENT_SCOPE_META,
  TASK_PRIORITY_META,
  TASK_STATUS_META,
  TASK_VISIBILITY_META,
  formatRelative,
} from "./taskMeta";
import { cn } from "@/lib/utils";

interface TaskCardProps {
  task: TaskWithPeople;
  onClick: () => void;
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  const status = TASK_STATUS_META[task.status];
  const priority = TASK_PRIORITY_META[task.priority];
  const visibility = TASK_VISIBILITY_META[task.visibility];
  const assignmentScope = TASK_ASSIGNMENT_SCOPE_META[task.assignment_scope];
  const isPoolAvailable = task.assignment_scope !== "user" && !task.assignee_id;
  const overdue =
    task.due_at &&
    new Date(task.due_at).getTime() < Date.now() &&
    !["confirmed", "rejected", "cancelled"].includes(task.status);

  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left w-full focus:outline-none"
    >
      <KubPanel
        padded={false}
        className="p-4 flex flex-col gap-3 hover:border-[color:var(--kub-cyan)]/40 transition-colors cursor-pointer"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-[color:var(--kub-text)] truncate">
              {task.title}
            </h3>
            {task.description && (
              <p className="mt-1 text-xs text-[color:var(--kub-muted)] line-clamp-2">
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

          {task.due_at && (
            <span
              className={cn(
                "flex items-center gap-1",
                overdue && "text-[color:var(--kub-danger)] font-semibold"
              )}
            >
              <KubIcon name="warning" size={12} />
              {new Date(task.due_at).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })}
            </span>
          )}
        </div>
      </KubPanel>
    </button>
  );
}
