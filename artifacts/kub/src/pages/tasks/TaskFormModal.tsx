"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { KubButton, KubIcon, KubInput, KubModal } from "@/components/kub";
import { ChatAvatar, UserAvatar } from "@/components/ui/ChatAvatar";
import { getChatDisplayInfo, getChatSecondaryLine } from "@/lib/chatDisplay";
import { useAppStore } from "@/store/app.store";
import {
  createTaskRecurrence,
  useRecurringTasksAvailability,
  type RecurrenceCreateInput,
} from "@/hooks/useRecurringTasks";
import { useTaskRouting } from "@/hooks/useTaskRouting";
import type {
  ChatMember,
  ChatWithLastMessage,
  Profile,
  TaskAssignmentScope,
  TaskPriority,
  TaskRecurrenceFrequency,
  TaskTargetRole,
  TaskVisibility,
  TaskWithPeople,
} from "@/types/database";
import {
  PRIORITIES,
  TASK_ASSIGNMENT_SCOPE_META,
  TASK_PRIORITY_META,
  TASK_VISIBILITY_META,
} from "./taskMeta";
import { cn } from "@/lib/utils";
import { mapPgError } from "@/lib/errors";
import {
  RECURRENCE_FREQUENCY_LABEL,
  RECURRING_TASKS_REQUIRED_MESSAGE,
  WEEKDAY_OPTIONS,
  formatRecurrenceSummary,
} from "@/lib/recurringTasks";
import {
  LOCATION_ROLE_LABEL,
  LOCATION_ROUTING_REQUIRED_MESSAGE,
  TASK_TARGET_ROLE_LABEL,
  mapLocationRoutingError,
} from "@/lib/locationRouting";

type ChatOption = ChatWithLastMessage;
type RecurrenceEndMode = "never" | "date" | "count";

interface TaskFormModalProps {
  /**
   * When provided, the modal renders in EDIT mode and calls `task_update`
   * on submit; otherwise it stays in CREATE mode and calls `task_create`.
   */
  task?: TaskWithPeople | null;
  onClose: () => void;
  /** Fired with the task id after a successful create OR update. */
  onDone: (taskId: string) => void;
}

/**
 * Admin/manager-only modal for creating OR editing a task.  All writes go
 * through SECURITY DEFINER RPCs (`task_create` / `task_update`); the
 * `tasks` table itself rejects direct INSERT/UPDATE.
 */
export function TaskFormModal({ task, onClose, onDone }: TaskFormModalProps) {
  const supabase = createClient();
  const isEdit = !!task;
  const currentUserId = useAppStore((s) => s.currentUser?.id ?? null);
  const routing = useTaskRouting({ enabled: true, includeMembers: true });
  const recurring = useRecurringTasksAvailability(true);

  // ── Form state, prefilled in edit mode ─────────────────────────────────
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "normal");
  const [dueAt, setDueAt] = useState<string>(toLocalInput(task?.due_at));
  const [visibility, setVisibility] = useState<TaskVisibility>(task?.visibility ?? "staff");
  const [assignmentScope, setAssignmentScope] = useState<TaskAssignmentScope>(task?.assignment_scope ?? "user");
  const [locationId, setLocationId] = useState<string>((task?.location_id as string | null | undefined) ?? "");
  const [targetRole, setTargetRole] = useState<TaskTargetRole | "">((task?.target_role as TaskTargetRole | null | undefined) ?? "");
  const [routeAdminId, setRouteAdminId] = useState<string>((task?.route_admin_id as string | null | undefined) ?? "");
  const [createdForAdmin, setCreatedForAdmin] = useState(Boolean(task?.created_for_admin));
  const taskAlreadyRecurring = Boolean(task?.recurrence_id && !task?.recurrence_template_task_id);
  const isRecurrenceOccurrence = Boolean(task?.recurrence_template_task_id);
  const [recurringEnabled, setRecurringEnabled] = useState(false);
  const [recurrenceFrequency, setRecurrenceFrequency] = useState<TaskRecurrenceFrequency>("daily");
  const [recurrenceInterval, setRecurrenceInterval] = useState(1);
  const [recurrenceWeekdays, setRecurrenceWeekdays] = useState<number[]>([]);
  const [recurrenceMonthday, setRecurrenceMonthday] = useState(() => new Date().getDate());
  const [recurrenceStartsAt, setRecurrenceStartsAt] = useState<string>(() => toLocalInput(task?.due_at) || toLocalInput(new Date().toISOString()));
  const [recurrenceEndMode, setRecurrenceEndMode] = useState<RecurrenceEndMode>("never");
  const [recurrenceEndAt, setRecurrenceEndAt] = useState("");
  const [recurrenceMaxOccurrences, setRecurrenceMaxOccurrences] = useState(10);

  const [assignee, setAssignee] = useState<Profile | null>(task?.assignee ?? null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);

  // Chat binding (optional). RLS already filters the chat list to ones the
  // caller can see — no extra client-side guard needed.
  const [chats, setChats] = useState<ChatOption[]>([]);
  const [chatId, setChatId] = useState<string | null>(task?.chat_id ?? null);
  const [chatSearch, setChatSearch] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdTaskId, setCreatedTaskId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("chats")
      .select("*, members:chat_members(user_id, role, last_read_at, profile:profiles(*))")
      .order("name", { ascending: true, nullsFirst: false })
      .limit(200)
      .then(({ data }) => {
        if (cancelled) return;
        setChats((data ?? []) as ChatOption[]);
      });
    return () => { cancelled = true; };
  }, [supabase]);

  // Debounced user search by full_name / username (RLS lets staff read all
  // profiles; non-staff would never see this modal).
  useEffect(() => {
    if (!search.trim() || assignee) { setResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      const q = search.trim();
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .or(`full_name.ilike.%${q}%,username.ilike.%${q}%`)
        .limit(8);
      setResults((data ?? []) as Profile[]);
      setSearching(false);
    }, 250);
    return () => clearTimeout(t);
  }, [search, assignee, supabase]);

  const visibleChats = useMemo(() => {
    const query = chatSearch.trim().toLocaleLowerCase("ru-RU");
    return chats.filter((chat) => {
      const display = getChatDisplayInfo(chat, currentUserId);
      if (!query) return true;
      return [display.title, display.subtitle, display.typeLabel]
        .join(" ")
        .toLocaleLowerCase("ru-RU")
        .includes(query);
    });
  }, [chats, chatSearch, currentUserId]);

  const selectedChat = useMemo(
    () => chats.find((chat) => chat.id === chatId) ?? null,
    [chats, chatId],
  );

  const selectedLocationMembers = useMemo(
    () => routing.members.filter((member) => member.location_id === locationId),
    [routing.members, locationId],
  );
  const selectedLocationAdmins = useMemo(
    () => selectedLocationMembers.filter((member) => ["owner", "admin", "manager"].includes(member.role)),
    [selectedLocationMembers],
  );

  const selectedLocationName = useMemo(
    () => routing.locations.find((location) => location.id === locationId)?.name ?? null,
    [routing.locations, locationId],
  );

  const recurrenceSummary = useMemo(
    () => formatRecurrenceSummary(
      recurrenceFrequency,
      recurrenceInterval,
      recurrenceFrequency === "weekly" ? recurrenceWeekdays : null,
      recurrenceFrequency === "monthly" ? recurrenceMonthday : null,
    ),
    [recurrenceFrequency, recurrenceInterval, recurrenceWeekdays, recurrenceMonthday],
  );

  const handleSubmit = async () => {
    if (createdTaskId) {
      onDone(createdTaskId);
      return;
    }
    if (!title.trim()) { setError("Укажите название задачи"); return; }
    setError(null);
    const due_iso =
      dueAt && !isNaN(new Date(dueAt).getTime())
        ? new Date(dueAt).toISOString()
        : null;
    const recurrenceValidation = validateRecurrenceDraft({
      enabled: recurringEnabled && !taskAlreadyRecurring && !isRecurrenceOccurrence,
      featureAvailable: recurring.available,
      frequency: recurrenceFrequency,
      intervalCount: recurrenceInterval,
      byWeekday: recurrenceWeekdays,
      byMonthday: recurrenceMonthday,
      startsAt: recurrenceStartsAt,
      endMode: recurrenceEndMode,
      endAt: recurrenceEndAt,
      maxOccurrences: recurrenceMaxOccurrences,
      dueAt: due_iso,
    });
    if (recurrenceValidation.error) {
      setError(recurrenceValidation.error);
      return;
    }
    setSubmitting(true);

    const effectiveAssigneeId = assignmentScope === "user" ? assignee?.id ?? null : null;
    const useRoutingRpc = routing.available;
    const recurrenceInput = recurrenceValidation.input;

    if (createdForAdmin && !locationId) {
      setSubmitting(false);
      setError("Нужно выбрать локацию для задачи администратору.");
      return;
    }

    if (assignmentScope !== "user" && assignee) {
      setAssignee(null);
    }

    if (isEdit && task) {
      const { error: rpcError } = useRoutingRpc
        ? await supabase.rpc("task_update_v3", {
            p_task_id: task.id,
            p_title: title.trim(),
            p_description: description.trim() || null,
            p_priority: priority,
            p_due_at: due_iso,
            p_assignee_id: effectiveAssigneeId,
            p_chat_id: chatId,
            p_visibility: visibility,
            p_assignment_scope: assignmentScope,
            p_location_id: locationId || null,
            p_target_role: targetRole || null,
            p_route_admin_id: routeAdminId || null,
            p_created_for_admin: createdForAdmin,
          })
        : await supabase.rpc("task_update", {
        p_task_id: task.id,
        p_title: title.trim(),
        p_description: description.trim() || null,
        p_priority: priority,
        p_due_at: due_iso,
        p_assignee_id: effectiveAssigneeId,
        p_chat_id: chatId,
      });
      if (rpcError) {
        setSubmitting(false);
        setError(useRoutingRpc ? mapLocationRoutingError(rpcError) : mapPgError(rpcError));
        return;
      }
      if (recurrenceInput) {
        const { error: recurrenceError } = await createTaskRecurrence({
          templateTaskId: task.id,
          ...recurrenceInput,
        });
        if (recurrenceError) {
          setSubmitting(false);
          setError(recurrenceError);
          return;
        }
      }
      setSubmitting(false);
      onDone(task.id);
      return;
    }

    const { data, error: rpcError } = useRoutingRpc
      ? await supabase.rpc("task_create_v3", {
          p_title: title.trim(),
          p_description: description.trim() || null,
          p_assignee_id: effectiveAssigneeId,
          p_priority: priority,
          p_due_at: due_iso,
          p_chat_id: chatId,
          p_visibility: visibility,
          p_assignment_scope: assignmentScope,
          p_location_id: locationId || null,
          p_target_role: targetRole || null,
          p_route_admin_id: routeAdminId || null,
          p_created_for_admin: createdForAdmin,
        })
      : await supabase.rpc("task_create", {
          p_title: title.trim(),
          p_description: description.trim() || null,
          p_assignee_id: effectiveAssigneeId,
          p_priority: priority,
          p_due_at: due_iso,
          p_chat_id: chatId,
        });
    if (rpcError) {
      setSubmitting(false);
      setError(useRoutingRpc ? mapLocationRoutingError(rpcError) : mapPgError(rpcError));
      return;
    }
    const newTaskId = data as string;
    if (recurrenceInput) {
      const { error: recurrenceError } = await createTaskRecurrence({
        templateTaskId: newTaskId,
        ...recurrenceInput,
      });
      if (recurrenceError) {
        setCreatedTaskId(newTaskId);
        setSubmitting(false);
        setError(`Задача создана, но повторение не сохранено. ${recurrenceError}`);
        return;
      }
    }
    setSubmitting(false);
    onDone(newTaskId);
  };

  return (
    <KubModal
      open
      onClose={onClose}
      title={isEdit ? "Редактирование задачи" : "Новая задача"}
      icon={<KubIcon name="tasks" size={15} />}
      size="md"
      contentClassName="px-5 py-4 space-y-4"
      footer={
        <>
          <KubButton variant="ghost" onClick={onClose}>Отмена</KubButton>
          <KubButton variant="primary" loading={submitting} onClick={handleSubmit}>
            {createdTaskId ? "Открыть задачу" : isEdit ? "Сохранить" : "Создать"}
          </KubButton>
        </>
      }
    >
      <KubInput
        label="Название"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Что нужно сделать?"
        autoFocus
      />

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wider mb-2 block text-[color:var(--kub-cyan)]">
          Описание
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Детали, шаги, ссылки…"
          className="w-full rounded-xl px-3 py-2 text-sm outline-none resize-none bg-[var(--kub-surface-2)] text-[color:var(--kub-text)] border border-[color:var(--kub-border-color)] focus:border-[color:var(--kub-cyan)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--kub-cyan)_15%,transparent)] transition-all"
        />
      </div>

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wider mb-2 block text-[color:var(--kub-cyan)]">
          Приоритет
        </label>
        <div className="grid grid-cols-4 gap-1.5">
          {PRIORITIES.map((p) => {
            const meta = TASK_PRIORITY_META[p];
            const active = priority === p;
            return (
              <button
                type="button"
                key={p}
                onClick={() => setPriority(p)}
                className={cn(
                  "px-3 py-2 rounded-lg text-xs font-semibold transition-colors border",
                  active
                    ? "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] border-[var(--kub-cyan)] kub-glow-soft"
                    : "bg-[var(--kub-surface-2)] text-[color:var(--kub-text)] border-[color:var(--kub-border-color)]",
                )}
              >
                {meta.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wider mb-2 block text-[color:var(--kub-cyan)]">
          Срок (необязательно)
        </label>
        <input
          type="datetime-local"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          className="w-full rounded-xl px-3 py-2 text-sm outline-none bg-[var(--kub-surface-2)] text-[color:var(--kub-text)] border border-[color:var(--kub-border-color)] focus:border-[color:var(--kub-cyan)] transition-all"
        />
      </div>

      <div className="rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] p-3">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--kub-cyan)]">
              Повторение
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-[color:var(--kub-muted)]">
              Повтор создаёт отдельные задачи с теми же локацией, получателем, видимостью и маршрутом администратора.
            </p>
          </div>
          {recurring.loading && <KubIcon name="spinner" size={14} tone="accent" className="shrink-0" />}
        </div>

        {taskAlreadyRecurring ? (
          <div className="rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 py-2 text-xs leading-relaxed text-[color:var(--kub-muted)]">
            Для этой задачи уже настроено повторение. Пауза, возобновление и остановка доступны в карточке задачи.
          </div>
        ) : isRecurrenceOccurrence ? (
          <div className="rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 py-2 text-xs leading-relaxed text-[color:var(--kub-muted)]">
            Это отдельный экземпляр повторяемой задачи. Повторение настраивается у исходной задачи.
          </div>
        ) : recurring.available ? (
          <div className="grid gap-3">
            <label className="flex items-start gap-2 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 py-2 text-sm text-[color:var(--kub-text)]">
              <input
                type="checkbox"
                checked={recurringEnabled}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setRecurringEnabled(checked);
                  if (checked && !recurrenceStartsAt) {
                    setRecurrenceStartsAt(dueAt || toLocalInput(new Date().toISOString()));
                  }
                }}
                className="mt-0.5 h-4 w-4 accent-[var(--kub-cyan)]"
              />
              <span className="min-w-0">
                <span className="block font-semibold">Повторять задачу</span>
                <span className="block text-xs leading-relaxed text-[color:var(--kub-muted)]">
                  Экземпляр будет создан только после наступления рассчитанного срока.
                </span>
              </span>
            </label>

            {recurringEnabled && (
              <div className="grid gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="min-w-0 text-xs font-medium text-[color:var(--kub-muted)]">
                    <span className="mb-1.5 block uppercase tracking-wide">Частота</span>
                    <select
                      value={recurrenceFrequency}
                      onChange={(event) => setRecurrenceFrequency(event.target.value as TaskRecurrenceFrequency)}
                      className="h-10 w-full min-w-0 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 text-sm text-[color:var(--kub-text)] outline-none focus:border-[color:var(--kub-cyan)]"
                    >
                      {(Object.keys(RECURRENCE_FREQUENCY_LABEL) as TaskRecurrenceFrequency[]).map((value) => (
                        <option key={value} value={value}>{RECURRENCE_FREQUENCY_LABEL[value]}</option>
                      ))}
                    </select>
                  </label>

                  <label className="min-w-0 text-xs font-medium text-[color:var(--kub-muted)]">
                    <span className="mb-1.5 block uppercase tracking-wide">Интервал</span>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={recurrenceInterval}
                      onChange={(event) => setRecurrenceInterval(Math.max(1, Number(event.target.value) || 1))}
                      className="h-10 w-full rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 text-sm text-[color:var(--kub-text)] outline-none focus:border-[color:var(--kub-cyan)]"
                    />
                  </label>
                </div>

                {recurrenceFrequency === "weekly" && (
                  <div>
                    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--kub-muted)]">
                      Дни недели
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                      {WEEKDAY_OPTIONS.map((day) => {
                        const active = recurrenceWeekdays.includes(day.value);
                        return (
                          <button
                            type="button"
                            key={day.value}
                            onClick={() => setRecurrenceWeekdays((prev) =>
                              active ? prev.filter((value) => value !== day.value) : [...prev, day.value].sort(),
                            )}
                            className={cn(
                              "h-9 rounded-lg border text-xs font-semibold transition-colors",
                              active
                                ? "border-[var(--kub-cyan)] bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]"
                                : "border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)]",
                            )}
                          >
                            {day.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {recurrenceFrequency === "monthly" && (
                  <label className="min-w-0 text-xs font-medium text-[color:var(--kub-muted)]">
                    <span className="mb-1.5 block uppercase tracking-wide">День месяца</span>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={recurrenceMonthday}
                      onChange={(event) => setRecurrenceMonthday(clampNumber(Number(event.target.value) || 1, 1, 31))}
                      className="h-10 w-full rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 text-sm text-[color:var(--kub-text)] outline-none focus:border-[color:var(--kub-cyan)]"
                    />
                  </label>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="min-w-0 text-xs font-medium text-[color:var(--kub-muted)]">
                    <span className="mb-1.5 block uppercase tracking-wide">Начало</span>
                    <input
                      type="datetime-local"
                      value={recurrenceStartsAt}
                      onChange={(event) => setRecurrenceStartsAt(event.target.value)}
                      className="h-10 w-full rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 text-sm text-[color:var(--kub-text)] outline-none focus:border-[color:var(--kub-cyan)]"
                    />
                  </label>

                  <label className="min-w-0 text-xs font-medium text-[color:var(--kub-muted)]">
                    <span className="mb-1.5 block uppercase tracking-wide">Завершение</span>
                    <select
                      value={recurrenceEndMode}
                      onChange={(event) => setRecurrenceEndMode(event.target.value as RecurrenceEndMode)}
                      className="h-10 w-full rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 text-sm text-[color:var(--kub-text)] outline-none focus:border-[color:var(--kub-cyan)]"
                    >
                      <option value="never">Никогда</option>
                      <option value="date">До даты</option>
                      <option value="count">После N повторов</option>
                    </select>
                  </label>
                </div>

                {recurrenceEndMode === "date" && (
                  <label className="min-w-0 text-xs font-medium text-[color:var(--kub-muted)]">
                    <span className="mb-1.5 block uppercase tracking-wide">Дата завершения</span>
                    <input
                      type="datetime-local"
                      value={recurrenceEndAt}
                      onChange={(event) => setRecurrenceEndAt(event.target.value)}
                      className="h-10 w-full rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 text-sm text-[color:var(--kub-text)] outline-none focus:border-[color:var(--kub-cyan)]"
                    />
                  </label>
                )}

                {recurrenceEndMode === "count" && (
                  <label className="min-w-0 text-xs font-medium text-[color:var(--kub-muted)]">
                    <span className="mb-1.5 block uppercase tracking-wide">Количество повторов</span>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={recurrenceMaxOccurrences}
                      onChange={(event) => setRecurrenceMaxOccurrences(Math.max(1, Number(event.target.value) || 1))}
                      className="h-10 w-full rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 text-sm text-[color:var(--kub-text)] outline-none focus:border-[color:var(--kub-cyan)]"
                    />
                  </label>
                )}

                <div className="rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 py-2 text-xs leading-relaxed text-[color:var(--kub-muted)]">
                  {recurrenceSummary}. Следующее выполнение будет рассчитано сервером.
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 py-2 text-xs leading-relaxed text-[color:var(--kub-muted)]">
            {recurring.message ?? RECURRING_TASKS_REQUIRED_MESSAGE} Существующее создание задач продолжит работать без повторения.
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] p-3">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--kub-cyan)]">
              Маршрутизация по локации
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-[color:var(--kub-muted)]">
              Выберите клуб, роль получателя и администратора, через которого проходит задача.
            </p>
          </div>
          {routing.loading && <KubIcon name="spinner" size={14} tone="accent" className="shrink-0" />}
        </div>

        {routing.available ? (
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="min-w-0 text-xs font-medium text-[color:var(--kub-muted)]">
                <span className="mb-1.5 block uppercase tracking-wide">Локация</span>
                <select
                  value={locationId}
                  onChange={(event) => {
                    setLocationId(event.target.value);
                    setRouteAdminId("");
                  }}
                  className="h-10 w-full min-w-0 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 text-sm text-[color:var(--kub-text)] outline-none focus:border-[color:var(--kub-cyan)]"
                >
                  <option value="">Без локации</option>
                  {routing.locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}{location.is_active ? "" : " · архив"}
                    </option>
                  ))}
                </select>
              </label>

              <label className="min-w-0 text-xs font-medium text-[color:var(--kub-muted)]">
                <span className="mb-1.5 block uppercase tracking-wide">Получатель</span>
                <select
                  value={targetRole}
                  onChange={(event) => setTargetRole(event.target.value as TaskTargetRole | "")}
                  className="h-10 w-full min-w-0 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 text-sm text-[color:var(--kub-text)] outline-none focus:border-[color:var(--kub-cyan)]"
                >
                  <option value="">По текущему назначению</option>
                  {(Object.keys(TASK_TARGET_ROLE_LABEL) as TaskTargetRole[]).map((role) => (
                    <option key={role} value={role}>{TASK_TARGET_ROLE_LABEL[role]}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="min-w-0 text-xs font-medium text-[color:var(--kub-muted)]">
                <span className="mb-1.5 block uppercase tracking-wide">Видимость</span>
                <select
                  value={visibility}
                  onChange={(event) => setVisibility(event.target.value as TaskVisibility)}
                  className="h-10 w-full min-w-0 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 text-sm text-[color:var(--kub-text)] outline-none focus:border-[color:var(--kub-cyan)]"
                >
                  {(Object.keys(TASK_VISIBILITY_META) as TaskVisibility[]).map((value) => (
                    <option key={value} value={value}>{TASK_VISIBILITY_META[value].label}</option>
                  ))}
                </select>
              </label>

              <label className="min-w-0 text-xs font-medium text-[color:var(--kub-muted)]">
                <span className="mb-1.5 block uppercase tracking-wide">Тип назначения</span>
                <select
                  value={assignmentScope}
                  onChange={(event) => {
                    const next = event.target.value as TaskAssignmentScope;
                    setAssignmentScope(next);
                    if (next !== "user") setAssignee(null);
                  }}
                  className="h-10 w-full min-w-0 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 text-sm text-[color:var(--kub-text)] outline-none focus:border-[color:var(--kub-cyan)]"
                >
                  {(Object.keys(TASK_ASSIGNMENT_SCOPE_META) as TaskAssignmentScope[]).map((value) => (
                    <option key={value} value={value}>{TASK_ASSIGNMENT_SCOPE_META[value].label}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="min-w-0 text-xs font-medium text-[color:var(--kub-muted)]">
              <span className="mb-1.5 block uppercase tracking-wide">Администратор клуба</span>
              <select
                value={routeAdminId}
                onChange={(event) => setRouteAdminId(event.target.value)}
                disabled={!locationId || selectedLocationAdmins.length === 0}
                className="h-10 w-full min-w-0 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 text-sm text-[color:var(--kub-text)] outline-none focus:border-[color:var(--kub-cyan)] disabled:opacity-50"
              >
                <option value="">Не выбран</option>
                {selectedLocationAdmins.map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {getPersonName(member.profile, "Пользователь")} · {LOCATION_ROLE_LABEL[member.role]}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-start gap-2 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 py-2 text-sm text-[color:var(--kub-text)]">
              <input
                type="checkbox"
                checked={createdForAdmin}
                onChange={(event) => {
                  setCreatedForAdmin(event.target.checked);
                  if (event.target.checked && !targetRole) setTargetRole("admin");
                }}
                className="mt-0.5 h-4 w-4 accent-[var(--kub-cyan)]"
              />
              <span className="min-w-0">
                <span className="block font-semibold">Задача для администратора</span>
                <span className="block text-xs leading-relaxed text-[color:var(--kub-muted)]">
                  Обычные работники не увидят эту задачу. {selectedLocationName ? `Локация: ${selectedLocationName}.` : "Выберите локацию."}
                </span>
              </span>
            </label>
          </div>
        ) : (
          <div className="rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 py-2 text-xs leading-relaxed text-[color:var(--kub-muted)]">
            {routing.error ?? LOCATION_ROUTING_REQUIRED_MESSAGE} Старое создание задач продолжит работать без этих полей.
          </div>
        )}
      </div>

      <div>
        <label
          htmlFor="task-chat-select"
          className="text-[10px] font-semibold uppercase tracking-wider mb-2 block text-[color:var(--kub-cyan)]"
        >
          Связанный чат (необязательно)
        </label>
        <div className="rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] p-2">
          <button
            type="button"
            id="task-chat-select"
            onClick={() => setChatId(null)}
            className={cn(
              "mb-2 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors",
              chatId === null
                ? "bg-[color-mix(in_srgb,var(--kub-cyan)_14%,transparent)] text-[color:var(--kub-cyan)]"
                : "text-[color:var(--kub-muted)] hover:bg-[var(--kub-surface-3)]",
            )}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--kub-surface)]">
              <KubIcon name="close" size={14} />
            </span>
            <span className="min-w-0 flex-1">Без привязки к чату</span>
          </button>

          <div className="mb-2 flex h-9 items-center gap-2 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-2">
            <KubIcon name="search" size={13} className="shrink-0 text-[color:var(--kub-muted)]" />
            <input
              type="text"
              value={chatSearch}
              onChange={(e) => setChatSearch(e.target.value)}
              placeholder="Найти чат…"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none text-[color:var(--kub-text)] placeholder:text-[color:var(--kub-muted)]"
            />
          </div>

          <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
            {visibleChats.map((chat) => {
              const display = getChatDisplayInfo(chat, currentUserId);
              const active = chat.id === chatId;
              return (
                <button
                  type="button"
                  key={chat.id}
                  onClick={() => setChatId(chat.id)}
                  className={cn(
                    "flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors",
                    active
                      ? "bg-[color-mix(in_srgb,var(--kub-cyan)_14%,transparent)]"
                      : "hover:bg-[var(--kub-surface-3)]",
                  )}
                >
                  <ChatAvatar
                    chat={{ id: chat.id, name: display.title, avatar_url: chat.avatar_url, type: chat.type }}
                    size="sm"
                    isSaved={display.isSaved}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-[color:var(--kub-text)]">
                      {display.title}
                    </span>
                    <span className="block truncate text-[11px] text-[color:var(--kub-muted)]">
                      {getChatSecondaryLine(display, formatChatContext(chat, display.subtitle))}
                    </span>
                  </span>
                  {active && <KubIcon name="check" size={14} tone="accent" className="shrink-0" />}
                </button>
              );
            })}
            {visibleChats.length === 0 && (
              <div className="px-2 py-3 text-center text-xs text-[color:var(--kub-muted)]">
                Чаты не найдены
              </div>
            )}
          </div>
        </div>
        <p className="mt-1.5 text-[11px] text-[color:var(--kub-muted)]">
          {selectedChat
            ? `Выбрано: ${getChatDisplayInfo(selectedChat, currentUserId).title}`
            : "Только чаты, в которых вы состоите."}
        </p>
      </div>

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wider mb-2 block text-[color:var(--kub-cyan)]">
          Исполнитель
        </label>
        {assignmentScope !== "user" ? (
          <div className="rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2 text-xs leading-relaxed text-[color:var(--kub-muted)]">
            Для задач из пула конкретный исполнитель не назначается сразу. Работник возьмёт задачу в работу сам.
          </div>
        ) : assignee ? (
          <div className="flex items-center gap-3 rounded-xl px-3 py-2 bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)]">
            <UserAvatar user={assignee} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold truncate text-sm text-[color:var(--kub-text)]">
                {assignee.full_name ?? "Без имени"}
              </div>
              {assignee.username && (
                <div className="text-xs truncate text-[color:var(--kub-muted)]">
                  @{assignee.username}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => { setAssignee(null); setSearch(""); }}
              className="p-1.5 rounded-lg hover:bg-[var(--kub-surface-3)] text-[color:var(--kub-muted)]"
              aria-label="Убрать"
            >
              <KubIcon name="close" size={14} />
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 rounded-xl px-3 h-10 bg-[var(--kub-surface-2)] border border-[color:var(--kub-border-color)] focus-within:border-[color:var(--kub-cyan)] transition-all">
              <KubIcon name="search" size={14} className="text-[color:var(--kub-muted)]" />
              <input
                type="text"
                placeholder="Поиск по имени или @username…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 bg-transparent text-sm outline-none text-[color:var(--kub-text)] placeholder:text-[color:var(--kub-muted)]"
              />
              {searching && <KubIcon name="spinner" size={14} className="text-[color:var(--kub-cyan)]" />}
            </div>
            {results.length > 0 && (
              <div className="mt-2 max-h-40 overflow-y-auto rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)]">
                {results.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => { setAssignee(p); setSearch(""); setResults([]); }}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-[var(--kub-surface-3)] text-left"
                  >
                    <UserAvatar user={p} size="sm" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate text-[color:var(--kub-text)]">
                        {p.full_name ?? "Без имени"}
                      </div>
                      {p.username && (
                        <div className="text-[11px] truncate text-[color:var(--kub-muted)]">
                          @{p.username}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
            <p className="mt-1.5 text-[11px] text-[color:var(--kub-muted)]">
              {isEdit
                ? "Можно убрать исполнителя — задача станет неназначенной."
                : "Можно создать задачу без исполнителя — назначить позже."}
            </p>
          </>
        )}
      </div>

      {error && (
        <div className="rounded-xl px-3 py-2 text-xs bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] text-[color:var(--kub-danger)] border border-[color:var(--kub-danger)]/30">
          {error}
        </div>
      )}
    </KubModal>
  );
}

/** ISO timestamp → `YYYY-MM-DDTHH:mm` for `<input type="datetime-local">`. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function formatChatContext(chat: ChatOption, fallback: string): string {
  if (chat.type !== "group") return fallback;
  const members = chat.members as (ChatMember & { profile?: Profile | null })[] | undefined;
  const names = members
    ?.map((member) => member.profile?.full_name ?? member.profile?.username)
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");
  return names || fallback;
}

function getPersonName(person: Profile | null | undefined, fallback: string): string {
  return person?.full_name?.trim() || person?.username?.trim() || fallback;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

interface RecurrenceDraftValidationInput {
  enabled: boolean;
  featureAvailable: boolean;
  frequency: TaskRecurrenceFrequency;
  intervalCount: number;
  byWeekday: number[];
  byMonthday: number;
  startsAt: string;
  endMode: RecurrenceEndMode;
  endAt: string;
  maxOccurrences: number;
  dueAt: string | null;
}

type RecurrencePayload = Omit<RecurrenceCreateInput, "templateTaskId">;

function validateRecurrenceDraft(input: RecurrenceDraftValidationInput): {
  input: RecurrencePayload | null;
  error: string | null;
} {
  if (!input.enabled) return { input: null, error: null };
  if (!input.featureAvailable) {
    return { input: null, error: RECURRING_TASKS_REQUIRED_MESSAGE };
  }

  const intervalCount = Math.floor(input.intervalCount);
  if (!Number.isFinite(intervalCount) || intervalCount < 1) {
    return { input: null, error: "Интервал должен быть больше нуля." };
  }

  const startsAtIso = toIsoFromLocal(input.startsAt || (input.dueAt ? toLocalInput(input.dueAt) : ""));
  if (!startsAtIso) {
    return { input: null, error: "Нужно выбрать дату начала." };
  }

  const byWeekday =
    input.frequency === "weekly"
      ? input.byWeekday.length > 0
        ? input.byWeekday
        : [getIsoWeekday(startsAtIso)]
      : null;
  const byMonthday =
    input.frequency === "monthly"
      ? clampNumber(Math.floor(input.byMonthday), 1, 31)
      : null;

  let endAt: string | null = null;
  let maxOccurrences: number | null = null;
  if (input.endMode === "date") {
    endAt = toIsoFromLocal(input.endAt);
    if (!endAt) return { input: null, error: "Нужно выбрать дату завершения." };
    if (new Date(endAt).getTime() <= new Date(startsAtIso).getTime()) {
      return { input: null, error: "Дата завершения должна быть позже даты начала." };
    }
  } else if (input.endMode === "count") {
    maxOccurrences = Math.floor(input.maxOccurrences);
    if (!Number.isFinite(maxOccurrences) || maxOccurrences < 1) {
      return { input: null, error: "Количество повторов должно быть больше нуля." };
    }
  }

  return {
    input: {
      frequency: input.frequency,
      intervalCount,
      byWeekday,
      byMonthday,
      startsAt: startsAtIso,
      endAt,
      maxOccurrences,
    },
    error: null,
  };
}

function toIsoFromLocal(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function getIsoWeekday(iso: string): number {
  const day = new Date(iso).getDay();
  return day === 0 ? 7 : day;
}
