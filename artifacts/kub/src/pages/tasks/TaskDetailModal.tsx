"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { KubBadge, KubButton, KubIcon, KubModal } from "@/components/kub";
import { UserAvatar } from "@/components/ui/ChatAvatar";
import { useAppStore } from "@/store/app.store";
import { useIsManagerOrAdmin } from "@/hooks/useRole";
import { useTask } from "@/hooks/useTask";
import {
  TASK_EVENT_LABEL,
  TASK_ASSIGNMENT_SCOPE_META,
  TASK_PRIORITY_META,
  TASK_STATUS_META,
  TASK_VISIBILITY_META,
  formatTaskDueDate,
  formatRelative,
  getTaskDeadlineState,
} from "./taskMeta";
import { TaskAssignModal } from "./TaskAssignModal";
import { TaskConfirmModal } from "./TaskConfirmModal";
import { TaskFormModal } from "./TaskFormModal";
import { TaskRejectModal } from "./TaskRejectModal";
import { mapPgError } from "@/lib/errors";

interface Props {
  taskId: string;
  nowMs?: number;
  onClose: () => void;
}

type Subdialog = null | "confirm" | "reject" | "cancel" | "assign" | "edit";

/**
 * Task detail with full event timeline + comment composer + role-aware
 * action buttons.  Every state-changing button calls a SECURITY DEFINER RPC
 * — the modal never updates `tasks` directly.
 */
export function TaskDetailModal({ taskId, nowMs = Date.now(), onClose }: Props) {
  const supabase = createClient();
  const currentUser = useAppStore((s) => s.currentUser);
  const isStaff = useIsManagerOrAdmin();
  const { task, events, loading, refetch } = useTask(taskId);

  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [sub, setSub] = useState<Subdialog>(null);

  if (loading || !task) {
    return (
      <KubModal open onClose={onClose} title="Задача" size="lg" contentClassName="px-5 py-10">
        {loading ? (
          <div className="flex items-center justify-center">
            <KubIcon name="spinner" size={24} tone="accent" label="Загрузка" />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 text-center">
            <KubIcon name="tasks" size={26} tone="muted" />
            <div className="text-sm font-semibold text-[color:var(--kub-text)]">
              Задача недоступна или была удалена.
            </div>
            <p className="max-w-sm text-xs leading-relaxed text-[color:var(--kub-muted)]">
              Возможно, у вас нет доступа к этой задаче или она больше не существует.
            </p>
            <KubButton variant="secondary" onClick={onClose}>
              Закрыть
            </KubButton>
          </div>
        )}
      </KubModal>
    );
  }

  const status = TASK_STATUS_META[task.status];
  const priority = TASK_PRIORITY_META[task.priority];
  const visibility = TASK_VISIBILITY_META[task.visibility];
  const assignmentScope = TASK_ASSIGNMENT_SCOPE_META[task.assignment_scope];
  const deadline = getTaskDeadlineState(task, nowMs);
  const isPoolAvailable = task.assignment_scope !== "user" && !task.assignee_id;
  const isAssignee = currentUser?.id === task.assignee_id;
  const isCreator  = currentUser?.id === task.created_by;
  const canConfirmReject = isStaff && task.status === "waiting_confirmation" && !isAssignee;
  const canCancel =
    isStaff &&
    !["confirmed", "rejected", "cancelled"].includes(task.status);
  // Staff can (re)assign while the task hasn't been picked up yet. Server
  // RPC `task_assign` enforces both the role and the source-status check.
  const canAssign = isStaff && (task.status === "new" || task.status === "assigned");
  const canClaim =
    isStaff &&
    task.status === "new" &&
    task.assignment_scope !== "user" &&
    !task.assignee_id;
  // Creator OR staff can edit a task that hasn't been finalised. Server
  // RPC `task_update` re-checks this and the manager-can't-touch-admin
  // guard if the assignee changes.
  const canEdit =
    (isCreator || isStaff) &&
    !["confirmed", "cancelled"].includes(task.status);
  const hasTaskActions =
    canClaim ||
    canAssign ||
    canEdit ||
    canCancel ||
    canConfirmReject ||
    (isAssignee && ["assigned", "accepted", "in_progress", "rejected"].includes(task.status)) ||
    (isStaff && task.status === "waiting_confirmation" && isAssignee);

  // supabase.rpc(...) returns a thenable PostgrestBuilder, not a real Promise,
  // so we type the callback as `PromiseLike` and await it.
  const runRpc = async (
    key: string,
    fn: () => PromiseLike<{ error: { message: string } | null }>,
    successMessage?: string,
  ) => {
    setActionError(null);
    setActionNotice(null);
    setActionLoading(key);
    try {
      const { error } = await fn();
      if (error) {
        setActionError(mapPgError(error));
        return;
      }
      if (successMessage) setActionNotice(successMessage);
      refetch();
    } catch (err: unknown) {
      setActionError(mapPgError(err));
    } finally {
      setActionLoading(null);
    }
  };

  const onClaim  = () => runRpc("claim",  () =>
    supabase.rpc("task_claim", { p_task_id: task.id }), "Задача назначена вам.");
  const onAccept = () => runRpc("accept", () => supabase.rpc("task_accept", { p_task_id: task.id }));
  const onStart  = () => runRpc("start",  () => supabase.rpc("task_start",  { p_task_id: task.id }));
  const onSend   = () => runRpc("send",   () =>
    supabase.rpc("task_send_for_confirmation", { p_task_id: task.id, p_note: null }));
  const onReturn = () => runRpc("return", () =>
    supabase.rpc("task_return_to_work", { p_task_id: task.id, p_note: null }));

  const submitComment = async () => {
    if (!comment.trim()) return;
    setPosting(true); setActionError(null);
    const { error } = await supabase.rpc("task_comment", {
      p_task_id: task.id, p_text: comment.trim(),
    });
    setPosting(false);
    if (error) { setActionError(mapPgError(error)); return; }
    setComment("");
  };

  const eventPayloadText = (kind: string, payload: Record<string, unknown>) => {
    const note = payload.note as string | undefined;
    const reason = payload.reason as string | undefined;
    const text = payload.text as string | undefined;
    if (kind === "comment" && text) return text;
    if (kind === "reject" && reason) return `Причина: ${reason}`;
    if (kind === "cancel" && reason) return `Причина: ${reason}`;
    if (kind === "confirm" && note)  return note;
    if (kind === "send_for_confirmation" && note) return note;
    return null;
  };

  const latestRejectReason =
    task.status === "rejected"
      ? [...events]
          .reverse()
          .map((ev) => {
            if (ev.kind !== "reject") return null;
            const reason = (ev.payload as Record<string, unknown>).reason;
            return typeof reason === "string" && reason.trim() ? reason.trim() : null;
          })
          .find(Boolean) ?? null
      : null;

  return (
    <>
      <KubModal
        open
        onClose={onClose}
        title={task.title}
        icon={<KubIcon name="tasks" size={15} />}
        size="lg"
        contentClassName="px-5 py-4 space-y-4"
      >
        {/* meta strip */}
        <div className="flex flex-wrap gap-2 items-center">
          <KubBadge tone={status.tone} pill>{status.label}</KubBadge>
          <KubBadge tone={priority.tone} pill dot>{priority.label}</KubBadge>
          <KubBadge tone={visibility.tone} pill>{visibility.label}</KubBadge>
          <KubBadge tone={assignmentScope.tone} pill>
            {assignmentScope.label}
          </KubBadge>
          {isPoolAvailable && (
            <KubBadge tone="online" pill>
              Доступна для взятия
            </KubBadge>
          )}
          {task.due_at && (
            <KubBadge tone={deadline.tone} pill>
              <KubIcon name="clock" size={11} className="mr-1" />
              {formatTaskDueDate(task.due_at)}
            </KubBadge>
          )}
          {deadline.badgeLabel && (
            <KubBadge tone={deadline.tone} pill>
              {deadline.badgeLabel}
            </KubBadge>
          )}
        </div>

        {task.description && (
          <p className="text-sm text-[color:var(--kub-text)] whitespace-pre-wrap leading-relaxed">
            {task.description}
          </p>
        )}

        <div className="rounded-2xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--kub-text)]">
                <KubIcon
                  name={deadline.isOverdue || deadline.isDueSoon ? "warning" : "clock"}
                  size={16}
                  tone={deadline.tone === "cyan" ? "accent" : deadline.tone}
                />
                <span>{deadline.timeLabel}</span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-[color:var(--kub-muted)]">
                {deadline.detailLabel}
              </p>
            </div>
            {task.due_at && (
              <div className="shrink-0 rounded-lg border border-[color:var(--kub-border-color)] px-2.5 py-1.5 text-xs font-medium text-[color:var(--kub-text)]">
                {formatTaskDueDate(task.due_at)}
              </div>
            )}
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--kub-border-color)_65%,transparent)]">
            {deadline.urgencyRatio !== null ? (
              <div
                className="h-full rounded-full bg-gradient-to-r from-[color:var(--kub-online)] via-[color:var(--kub-warn)] to-[color:var(--kub-danger)] transition-[width] duration-300"
                style={{ width: `${Math.max(5, Math.round(deadline.urgencyRatio * 100))}%` }}
              />
            ) : (
              <div className="h-full w-0" />
            )}
          </div>
        </div>

        {task.status === "waiting_confirmation" && (
          <div className="flex items-start gap-2 rounded-xl border border-[color:var(--kub-warn)]/30 bg-[color-mix(in_srgb,var(--kub-warn)_12%,transparent)] px-3 py-2">
            <KubIcon name="warning" size={16} tone="warn" className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[color:var(--kub-text)]">
                Задача ждёт подтверждения
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-[color:var(--kub-muted)]">
                Менеджер или администратор должен подтвердить результат либо вернуть задачу на доработку.
              </p>
            </div>
          </div>
        )}

        {latestRejectReason && (
          <div className="flex items-start gap-2 rounded-xl border border-[color:var(--kub-danger)]/30 bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] px-3 py-2">
            <KubIcon name="reject" size={16} tone="danger" className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[color:var(--kub-text)]">
                Причина отклонения
              </div>
              <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-[color:var(--kub-text)]">
                {latestRejectReason}
              </p>
            </div>
          </div>
        )}

        {isPoolAvailable && (
          <div className="flex items-start gap-2 rounded-xl border border-[color:var(--kub-online)]/30 bg-[color-mix(in_srgb,var(--kub-online)_12%,transparent)] px-3 py-2">
            <KubIcon name="userPlus" size={16} tone="online" className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[color:var(--kub-text)]">
                Задача доступна из общего пула
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-[color:var(--kub-muted)]">
                Сотрудник с правами может взять её в работу, после чего задача будет назначена ему.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider font-semibold mb-1 text-[color:var(--kub-muted)]">
              Исполнитель
            </div>
            {task.assignee ? (
              <div className="flex items-center gap-2">
                <UserAvatar user={task.assignee} size="sm" />
                <span className="text-sm font-medium text-[color:var(--kub-text)]">
                  {task.assignee.full_name ?? "Без имени"}
                </span>
              </div>
            ) : (
              <span className="text-xs text-[color:var(--kub-warn)]">Не назначен</span>
            )}
          </div>
          <div className="rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider font-semibold mb-1 text-[color:var(--kub-muted)]">
              Создал
            </div>
            {task.creator ? (
              <div className="flex items-center gap-2">
                <UserAvatar user={task.creator} size="sm" />
                <span className="text-sm font-medium text-[color:var(--kub-text)]">
                  {task.creator.full_name ?? "Без имени"}
                </span>
              </div>
            ) : (
              <span className="text-xs text-[color:var(--kub-muted)]">—</span>
            )}
          </div>
          <div className="rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider font-semibold mb-1 text-[color:var(--kub-muted)]">
              Видимость
            </div>
            <div className="flex flex-wrap gap-1.5">
              <KubBadge tone={visibility.tone} pill>{visibility.label}</KubBadge>
            </div>
          </div>
          <div className="rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider font-semibold mb-1 text-[color:var(--kub-muted)]">
              Тип назначения
            </div>
            <div className="flex flex-wrap gap-1.5">
              <KubBadge tone={assignmentScope.tone} pill>
                {assignmentScope.label}
              </KubBadge>
              {isPoolAvailable && (
                <KubBadge tone="online" pill>
                  Доступна для взятия
                </KubBadge>
              )}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        {hasTaskActions && (
          <div className="rounded-2xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] p-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="w-full text-[10px] font-semibold uppercase tracking-wider text-[color:var(--kub-cyan)]">
            Действия
          </div>
          {canClaim && (
            <div className="flex min-w-[180px] flex-col gap-1">
              <KubButton
                variant="primary"
                loading={actionLoading === "claim"}
                disabled={actionLoading !== null}
                leftIcon={<KubIcon name="check" size={14} />}
                onClick={onClaim}
              >
                Взять задачу
              </KubButton>
              <span className="text-[11px] leading-snug text-[color:var(--kub-muted)]">
                Задача из общего пула будет назначена вам
              </span>
            </div>
          )}
          {canAssign && (
            <KubButton
              variant="secondary"
              leftIcon={<KubIcon name="userPlus" size={14} />}
              onClick={() => setSub("assign")}
            >
              {task.assignee_id ? "Переназначить" : "Назначить исполнителя"}
            </KubButton>
          )}
          {isAssignee && task.status === "assigned" && (
            <KubButton
              variant="primary"
              loading={actionLoading === "accept"}
              leftIcon={<KubIcon name="check" size={14} />}
              onClick={onAccept}
            >
              Принять
            </KubButton>
          )}
          {isAssignee && task.status === "accepted" && (
            <KubButton
              variant="primary"
              loading={actionLoading === "start"}
              leftIcon={<KubIcon name="play" size={14} />}
              onClick={onStart}
            >
              Взять в работу
            </KubButton>
          )}
          {isAssignee && task.status === "in_progress" && (
            <KubButton
              variant="primary"
              loading={actionLoading === "send"}
              leftIcon={<KubIcon name="send" size={14} />}
              onClick={onSend}
            >
              На подтверждение
            </KubButton>
          )}
          {isAssignee && task.status === "rejected" && (
            <KubButton
              variant="primary"
              loading={actionLoading === "return"}
              leftIcon={<KubIcon name="play" size={14} />}
              onClick={onReturn}
            >
              Вернуть в работу
            </KubButton>
          )}
          {canConfirmReject && (
            <>
              <KubButton
                variant="primary"
                leftIcon={<KubIcon name="checkCircle" size={14} />}
                onClick={() => setSub("confirm")}
              >
                Подтвердить
              </KubButton>
              <KubButton
                variant="danger"
                leftIcon={<KubIcon name="reject" size={14} />}
                onClick={() => setSub("reject")}
              >
                Отклонить
              </KubButton>
            </>
          )}
          {isStaff && task.status === "waiting_confirmation" && isAssignee && (
            <span className="text-[11px] self-center text-[color:var(--kub-muted)]">
              Подтвердить должен другой администратор или менеджер
            </span>
          )}
          {canEdit && (
            <KubButton
              variant="secondary"
              leftIcon={<KubIcon name="edit" size={14} />}
              onClick={() => setSub("edit")}
            >
              Редактировать
            </KubButton>
          )}
          {canCancel && (
            <KubButton
              variant="ghost"
              leftIcon={<KubIcon name="ban" size={14} />}
              onClick={() => setSub("cancel")}
              className="text-[color:var(--kub-danger)] hover:bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)]"
            >
              Отменить задачу
            </KubButton>
          )}
          </div>
        )}

        {actionError && (
          <div className="rounded-xl px-3 py-2 text-xs bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] text-[color:var(--kub-danger)] border border-[color:var(--kub-danger)]/30">
            {actionError}
          </div>
        )}
        {actionNotice && (
          <div className="rounded-xl px-3 py-2 text-xs bg-[color-mix(in_srgb,var(--kub-online)_12%,transparent)] text-[color:var(--kub-online)] border border-[color:var(--kub-online)]/30">
            {actionNotice}
          </div>
        )}

        {/* Timeline */}
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider mb-2 text-[color:var(--kub-cyan)]">
            История
          </div>
          <ol className="relative space-y-3 pl-5 before:content-[''] before:absolute before:left-1.5 before:top-1 before:bottom-1 before:w-px before:bg-[color:var(--kub-border-color)]">
            {events.map((ev) => {
              const detail = eventPayloadText(ev.kind, ev.payload as Record<string, unknown>);
              return (
                <li key={ev.id} className="relative">
                  <span className="absolute -left-[15px] top-1.5 h-2 w-2 rounded-full bg-[var(--kub-cyan)] kub-glow-soft" />
                  <div className="text-xs text-[color:var(--kub-muted)]">
                    <span className="font-semibold text-[color:var(--kub-text)]">
                      {ev.actor?.full_name ?? "Система"}
                    </span>{" "}
                    {TASK_EVENT_LABEL[ev.kind] ?? ev.kind} · {formatRelative(ev.created_at)}
                  </div>
                  {detail && (
                    <div className="mt-1 text-sm text-[color:var(--kub-text)] whitespace-pre-wrap">
                      {detail}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>

        {/* Comment composer */}
        <div className="border-t border-[color:var(--kub-border-color)] pt-3">
          <div className="flex items-end gap-2">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder="Оставьте комментарий…"
              className="flex-1 rounded-xl px-3 py-2 text-sm outline-none resize-none bg-[var(--kub-surface-2)] text-[color:var(--kub-text)] border border-[color:var(--kub-border-color)] focus:border-[color:var(--kub-cyan)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--kub-cyan)_15%,transparent)] transition-all"
            />
            <KubButton
              variant="primary"
              size="md"
              aria-label="Отправить комментарий"
              loading={posting}
              disabled={!comment.trim()}
              onClick={submitComment}
            >
              <KubIcon name="send" size={14} />
            </KubButton>
          </div>
        </div>
      </KubModal>

      {sub === "confirm" && (
        <TaskConfirmModal
          taskId={task.id}
          onClose={() => setSub(null)}
          onDone={() => { setSub(null); refetch(); }}
        />
      )}
      {sub === "reject" && (
        <TaskRejectModal
          taskId={task.id}
          mode="reject"
          onClose={() => setSub(null)}
          onDone={() => { setSub(null); refetch(); }}
        />
      )}
      {sub === "cancel" && (
        <TaskRejectModal
          taskId={task.id}
          mode="cancel"
          onClose={() => setSub(null)}
          onDone={() => { setSub(null); refetch(); }}
        />
      )}
      {sub === "assign" && (
        <TaskAssignModal
          taskId={task.id}
          currentAssignee={task.assignee ?? null}
          onClose={() => setSub(null)}
          onDone={() => { setSub(null); refetch(); }}
        />
      )}
      {sub === "edit" && (
        <TaskFormModal
          task={task}
          onClose={() => setSub(null)}
          onDone={() => { setSub(null); refetch(); }}
        />
      )}
    </>
  );
}
