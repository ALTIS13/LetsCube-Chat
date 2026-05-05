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
} from "@/components/kub";
import { TaskCard } from "./TaskCard";
import { TaskDetailModal } from "./TaskDetailModal";
import { TaskFormModal } from "./TaskFormModal";
import type { TaskStatus } from "@/types/database";
import { cn } from "@/lib/utils";

interface Tab {
  id: string;
  label: string;
  filter: TasksFilter;
}

const STAFF_TABS: Tab[] = [
  { id: "created", label: "Я создал",      filter: { mine: "created" } },
  { id: "available", label: "Доступные",
    filter: {
      mine: "all",
      statuses: ["new"],
      assignmentScopes: ["manager_pool", "staff_pool"],
      assignee: "unassigned",
    } },
  { id: "review",  label: "На подтверждении",
    filter: { mine: "all", statuses: ["waiting_confirmation"] } },
  { id: "all",     label: "Все",           filter: { mine: "all" } },
];

const ASSIGNEE_TABS: Tab[] = [
  { id: "new",      label: "Мои новые",
    filter: { mine: "assigned", statuses: ["assigned" as TaskStatus] } },
  { id: "active",   label: "В работе",
    filter: { mine: "assigned", statuses: ["accepted", "in_progress"] as TaskStatus[] } },
  { id: "review",   label: "На подтверждении",
    filter: { mine: "assigned", statuses: ["waiting_confirmation" as TaskStatus] } },
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

  const tabs = isStaff ? STAFF_TABS : ASSIGNEE_TABS;
  const [tabId, setTabId] = useState(tabs[0].id);
  const activeTab = tabs.find((t) => t.id === tabId) ?? tabs[0];

  const { tasks, loading } = useTasks(activeTab.filter);

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

  const closeTaskModal = () => {
    setOpenTaskId(null);
    if (taskIdFromUrl) setLocation("/tasks", { replace: true });
  };

  // The "Все" tab on staff is intentionally unbounded — show a small hint
  // when the visible list is large.
  const summary = useMemo(() => {
    if (loading) return "";
    return `${tasks.length} ${pluralizeTasks(tasks.length)}`;
  }, [tasks.length, loading]);

  if (!currentUser) return null;

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
                {active && (
                  <span className="absolute left-2 right-2 bottom-0 h-0.5 rounded-full bg-[var(--kub-cyan)] kub-glow-soft" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <KubIcon name="spinner" size={24} tone="accent" label="Загрузка" />
          </div>
        ) : tasks.length === 0 ? (
          <KubEmptyState
            icon={<KubIcon name="tasks" size={26} />}
            title={getEmptyTitle(activeTab.id)}
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
            {tasks.map((t) => (
              <TaskCard key={t.id} task={t} onClick={() => setOpenTaskId(t.id)} />
            ))}
          </div>
        )}
        {!loading && tasks.length > 0 && (
          <div className="mt-4 text-center text-[11px] uppercase tracking-wide text-[color:var(--kub-muted)]">
            {summary}
          </div>
        )}
      </div>

      {openTaskId && (
        <TaskDetailModal taskId={openTaskId} onClose={closeTaskModal} />
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
    case "created":
      return "Создайте первую задачу — она появится у выбранного исполнителя.";
    default:
      return isStaff
        ? "Пока нет задач, доступных по текущему фильтру."
        : "Когда вам назначат задачу, она появится здесь.";
  }
}
