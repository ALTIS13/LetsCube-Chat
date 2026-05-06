"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAppStore } from "@/store/app.store";
import { useIsManagerOrAdmin } from "@/hooks/useRole";
import { useTasks, type TasksFilter } from "@/hooks/useTasks";
import {
  KubButton,
  KubEmptyState,
  KubHeader,
  KubIcon,
  KubInput,
} from "@/components/kub";
import { TaskCard } from "./TaskCard";
import { TaskDetailModal } from "./TaskDetailModal";
import { TaskFormModal } from "./TaskFormModal";
import {
  TASK_ASSIGNMENT_SCOPE_META,
  TASK_PRIORITY_META,
  TASK_STATUS_META,
  TASK_VISIBILITY_META,
  getTaskDeadlineState,
} from "./taskMeta";
import type { TaskStatus, TaskWithPeople } from "@/types/database";
import { cn } from "@/lib/utils";

interface Tab {
  id: string;
  label: string;
  filter: TasksFilter;
}

const STAFF_TABS: Tab[] = [
  { id: "mine", label: "Мои", filter: { mine: "assigned" } },
  { id: "available", label: "Доступные",
    filter: {
      mine: "all",
      statuses: ["new"],
      assignmentScopes: ["manager_pool", "staff_pool"],
      assignee: "unassigned",
    } },
  { id: "review",  label: "На подтверждении",
    filter: { mine: "all", statuses: ["waiting_confirmation"] } },
  { id: "urgent",  label: "Срочные",       filter: { mine: "all" } },
  { id: "private", label: "Приватные",     filter: { mine: "all", visibilities: ["private"] } },
  { id: "chat",    label: "Чатовые",       filter: { mine: "all", visibilities: ["chat"] } },
  { id: "unassigned", label: "Без исполнителя", filter: { mine: "all", assignee: "unassigned" } },
  { id: "all",     label: "Все",           filter: { mine: "all" } },
  { id: "created", label: "Я создал",      filter: { mine: "created" } },
];

const ASSIGNEE_TABS: Tab[] = [
  { id: "mine",     label: "Мои", filter: { mine: "assigned" } },
  { id: "new",      label: "Мои новые",
    filter: { mine: "assigned", statuses: ["assigned" as TaskStatus] } },
  { id: "active",   label: "В работе",
    filter: { mine: "assigned", statuses: ["accepted", "in_progress"] as TaskStatus[] } },
  { id: "review",   label: "На подтверждении",
    filter: { mine: "assigned", statuses: ["waiting_confirmation" as TaskStatus] } },
  { id: "urgent",   label: "Срочные", filter: { mine: "assigned" } },
];

/**
 * /tasks — role-aware tabs page.
 *
 * Staff (admin/manager): "Я создал", "На подтверждении", "Все" + create button.
 * Employee (user role):  "Мои новые", "В работе", "На подтверждении".
 */
export function TasksPage() {
  const [location, setLocation] = useLocation();
  const currentUser = useAppStore((s) => s.currentUser);
  const isStaff = useIsManagerOrAdmin();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [search, setSearch] = useState("");

  const tabs = isStaff ? STAFF_TABS : ASSIGNEE_TABS;
  const [tabId, setTabId] = useState(tabs[0].id);
  const activeTab = tabs.find((t) => t.id === tabId) ?? tabs[0];

  const baseFilter: TasksFilter = isStaff ? { mine: "all" } : { mine: "assigned" };
  const { tasks, loading } = useTasks(baseFilter, { enabled: isStaff });

  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const taskIdFromUrl = useMemo(() => {
    const query = location.includes("?")
      ? location.slice(location.indexOf("?") + 1)
      : window.location.search.replace(/^\?/, "");
    return new URLSearchParams(query).get("task");
  }, [location]);

  useEffect(() => {
    if (taskIdFromUrl) setOpenTaskId(taskIdFromUrl);
  }, [taskIdFromUrl]);

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === tabId)) setTabId(tabs[0].id);
  }, [tabId, tabs]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const closeTaskModal = () => {
    setOpenTaskId(null);
    if (taskIdFromUrl) setLocation("/tasks", { replace: true });
  };

  const visibleTasks = useMemo(
    () => applyClientFilters(tasks, activeTab.id, search, nowMs, currentUser?.id ?? null),
    [tasks, activeTab.id, search, nowMs, currentUser?.id],
  );
  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tab of tabs) {
      counts[tab.id] = applyClientFilters(tasks, tab.id, "", nowMs, currentUser?.id ?? null).length;
    }
    return counts;
  }, [tabs, tasks, nowMs, currentUser?.id]);

  // The "Все" tab on staff is intentionally unbounded — show a small hint
  // when the visible list is large.
  const summary = useMemo(() => {
    if (loading) return "";
    return `${visibleTasks.length} ${pluralizeTasks(visibleTasks.length)}`;
  }, [visibleTasks.length, loading]);

  if (!currentUser) return null;

  if (!isStaff) {
    return (
      <div className="flex flex-col h-[100dvh] bg-[var(--kub-bg)]">
        <KubHeader
          title="Задачи"
          subtitle="Раздел для сотрудников клуба"
          leading={
            <button
              type="button"
              onClick={() => setLocation("/")}
              className="p-2 rounded-lg hover:bg-[var(--kub-surface-2)] text-[color:var(--kub-muted)]"
              aria-label="Назад"
            >
              <KubIcon name="back" size={18} />
            </button>
          }
        />
        <div className="flex flex-1 items-center justify-center px-4">
          <KubEmptyState
            icon={<KubIcon name="shield" size={28} />}
            title="Раздел задач доступен только сотрудникам клуба"
            description="Если вам нужен доступ к задачам, обратитесь к администратору или управляющему."
            action={
              <KubButton variant="secondary" onClick={() => setLocation("/")}>
                Вернуться к чатам
              </KubButton>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[100dvh] bg-[var(--kub-bg)]">
      <KubHeader
        title="Задачи"
        subtitle={isStaff ? "Управление задачами клуба" : "Ваши задачи"}
        leading={
          <button
            type="button"
            onClick={() => setLocation("/")}
            className="p-2 rounded-lg hover:bg-[var(--kub-surface-2)] text-[color:var(--kub-muted)]"
            aria-label="Назад"
          >
            <KubIcon name="back" size={18} />
          </button>
        }
        trailing={
          isStaff ? (
            <KubButton
              variant="primary"
              size="sm"
              leftIcon={<KubIcon name="create" size={14} />}
              onClick={() => setShowCreate(true)}
            >
              Новая
            </KubButton>
          ) : null
        }
      />

      {/* Tabs */}
      <div className="flex-shrink-0 border-b border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] overflow-x-auto">
        <div className="flex items-stretch gap-1 px-3">
          {tabs.map((t) => {
            const active = t.id === tabId;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTabId(t.id)}
                className={cn(
                  "relative px-4 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap transition-colors",
                  active
                    ? "text-[color:var(--kub-cyan)]"
                    : "text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)]",
                )}
              >
                {t.label}
                {tabCounts[t.id] > 0 && (
                  <span
                    className={cn(
                      "ml-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] leading-none",
                      t.id === "urgent"
                        ? "bg-[color-mix(in_srgb,var(--kub-danger)_18%,transparent)] text-[color:var(--kub-danger)]"
                        : t.id === "review"
                          ? "bg-[color-mix(in_srgb,var(--kub-warn)_18%,transparent)] text-[color:var(--kub-warn)]"
                          : t.id === "available"
                            ? "bg-[color-mix(in_srgb,var(--kub-online)_18%,transparent)] text-[color:var(--kub-online)]"
                            : "bg-[var(--kub-surface-2)] text-[color:var(--kub-muted)]",
                    )}
                  >
                    {tabCounts[t.id] > 99 ? "99+" : tabCounts[t.id]}
                  </span>
                )}
                {active && (
                  <span className="absolute left-2 right-2 bottom-0 h-0.5 rounded-full bg-[var(--kub-cyan)] kub-glow-soft" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-shrink-0 border-b border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 sm:px-5 py-3">
        <KubInput
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Поиск по задачам…"
          leftIcon={<KubIcon name="search" size={15} />}
          rightSlot={
            search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="shrink-0 rounded-md p-1 text-[color:var(--kub-muted)] hover:bg-[var(--kub-surface)] hover:text-[color:var(--kub-text)]"
                aria-label="Очистить поиск задач"
              >
                <KubIcon name="close" size={14} />
              </button>
            ) : null
          }
          containerClassName="max-w-2xl"
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <KubIcon name="spinner" size={24} tone="accent" label="Загрузка" />
          </div>
        ) : visibleTasks.length === 0 ? (
          <KubEmptyState
            icon={<KubIcon name="tasks" size={26} />}
            title={search.trim() ? "Задачи не найдены" : getEmptyTitle(activeTab.id)}
            description={getEmptyDescription(activeTab.id, isStaff)}
            action={
              isStaff && (
                <KubButton
                  variant="primary"
                  leftIcon={<KubIcon name="create" size={14} />}
                  onClick={() => setShowCreate(true)}
                >
                  Создать задачу
                </KubButton>
              )
            }
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
            {visibleTasks.map((t) => (
              <TaskCard key={t.id} task={t} nowMs={nowMs} onClick={() => setOpenTaskId(t.id)} />
            ))}
          </div>
        )}
        {!loading && visibleTasks.length > 0 && (
          <div className="mt-4 text-center text-[11px] uppercase tracking-wide text-[color:var(--kub-muted)]">
            {summary}
          </div>
        )}
      </div>

      {openTaskId && (
        <TaskDetailModal taskId={openTaskId} nowMs={nowMs} onClose={closeTaskModal} />
      )}
      {showCreate && (
        <TaskFormModal
          onClose={() => setShowCreate(false)}
          onDone={(id) => { setShowCreate(false); setOpenTaskId(id); }}
        />
      )}
    </div>
  );
}

function pluralizeTasks(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "задача";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "задачи";
  return "задач";
}

function getEmptyTitle(tabId: string): string {
  switch (tabId) {
    case "new":
      return "Нет назначенных задач";
    case "active":
      return "Нет задач в работе";
    case "review":
      return "Нет задач на подтверждении";
    case "available":
      return "Нет доступных задач";
    case "urgent":
      return "Нет срочных задач";
    case "private":
      return "Нет приватных задач";
    case "chat":
      return "Нет чатовых задач";
    case "unassigned":
      return "Нет задач без исполнителя";
    case "created":
      return "Вы пока не создали задач";
    default:
      return "Здесь пока пусто";
  }
}

function getEmptyDescription(tabId: string, isStaff: boolean): string {
  switch (tabId) {
    case "new":
      return "Новые назначенные задачи появятся здесь сразу после назначения.";
    case "active":
      return "Принятые задачи и задачи в работе будут собраны в этом разделе.";
    case "review":
      return "Здесь появятся задачи, которые ждут подтверждения выполнения.";
    case "available":
      return "Здесь появятся задачи из общего пула, которые можно взять в работу.";
    case "urgent":
      return "Здесь будут задачи с близким сроком или просроченным дедлайном.";
    case "private":
      return "Приватные задачи отображаются только тем, кому их разрешает RLS.";
    case "chat":
      return "Задачи с видимостью чата появятся здесь, если они доступны вам по RLS.";
    case "unassigned":
      return "Здесь будут задачи без назначенного исполнителя.";
    case "created":
      return "Создайте первую задачу — она появится у выбранного исполнителя.";
    default:
      return isStaff
        ? "Пока нет задач, доступных по текущему фильтру."
        : "Когда вам назначат задачу, она появится здесь.";
  }
}

function applyClientFilters(
  tasks: TaskWithPeople[],
  tabId: string,
  search: string,
  nowMs: number,
  userId: string | null,
): TaskWithPeople[] {
  const query = normalizeSearch(search);
  return tasks.filter((task) => {
    if (tabId === "mine" && task.assignee_id !== userId) return false;
    if (tabId === "available") {
      if (task.status !== "new" || task.assignment_scope === "user" || task.assignee_id !== null) return false;
    }
    if (tabId === "review" && task.status !== "waiting_confirmation") return false;
    if (tabId === "private" && task.visibility !== "private") return false;
    if (tabId === "chat" && task.visibility !== "chat") return false;
    if (tabId === "unassigned" && task.assignee_id !== null) return false;
    if (tabId === "created" && task.created_by !== userId) return false;
    if (tabId === "new" && (task.assignee_id !== userId || task.status !== "assigned")) return false;
    if (tabId === "active" && (task.assignee_id !== userId || !["accepted", "in_progress"].includes(task.status))) return false;
    if (tabId === "urgent") {
      const deadline = getTaskDeadlineState(task, nowMs);
      if (!deadline.isOverdue && !deadline.isDueSoon) return false;
    }

    if (!query) return true;
    const deadline = getTaskDeadlineState(task, nowMs);
    const haystack = [
      task.title,
      task.description,
      task.assignee?.full_name,
      task.assignee?.username,
      task.creator?.full_name,
      task.creator?.username,
      TASK_STATUS_META[task.status].label,
      TASK_PRIORITY_META[task.priority].label,
      TASK_VISIBILITY_META[task.visibility].label,
      TASK_ASSIGNMENT_SCOPE_META[task.assignment_scope].label,
      deadline.timeLabel,
      deadline.badgeLabel,
    ]
      .filter(Boolean)
      .map((value) => normalizeSearch(String(value)))
      .join(" ");

    return haystack.includes(query);
  });
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU");
}
