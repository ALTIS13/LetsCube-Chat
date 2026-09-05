"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAppStore } from "@/store/app.store";
import { useAnyLocationPermissionAccess, usePermissionAccess } from "@/hooks/useRole";
import { useTaskRouting } from "@/hooks/useTaskRouting";
import {
  TASK_ACCESS_PERMISSION_KEYS,
  TASK_ADMIN_VIEW_PERMISSION_KEYS,
  TASK_BULK_DELETE_PERMISSION_KEYS,
  TASK_CREATE_PERMISSION_KEYS,
  TASK_RESTORE_PERMISSION_KEYS,
  TASK_VIEW_PERMISSION_KEYS,
  getUserTaskLocationIds,
} from "@/hooks/useTaskAccess";
import { useTasks, type TasksFilter } from "@/hooks/useTasks";
import { useTaskSoftDelete } from "@/hooks/useTaskSoftDelete";
import { KubButton, KubEmptyState, KubFilterButton, KubFilterSummary, KubHeader, KubIcon, KubInput, type ActiveFilter } from "@/components/kub";
import { BulkSelectControl } from "@/components/ui/BulkSelectControl";
import { TaskCard } from "./TaskCard";
import { TaskListRow } from "./TaskListRow";
import { TaskDetailModal } from "./TaskDetailModal";
import { TaskDeleteModal } from "./TaskDeleteModal";
import { TaskFormModal } from "./TaskFormModal";
import {
  TASK_ASSIGNMENT_SCOPE_META,
  TASK_PRIORITY_META,
  TASK_STATUS_META,
  TASK_VISIBILITY_META,
  getTaskDeadlineState,
} from "./taskMeta";
import type { TaskWithPeople } from "@/types/database";
import { cn } from "@/lib/utils";

interface Tab {
  id: string;
  label: string;
  filter: TasksFilter;
}

type TaskViewMode = "cards" | "list";
type AssigneeFilter = "all" | "me" | "unassigned" | string;
type LocationFilter = "all" | "my" | string;
type RecipientFilter = "all" | "admin" | "staff";

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

/**
 * /tasks is gated by dynamic global permissions plus location permissions.
 * Legacy profile roles remain only a fallback while the DB backfill is rolling
 * out; club staff access comes from location_members.role_id.
 */
export function TasksPage() {
  const [location, setLocation] = useLocation();
  const currentUser = useAppStore((s) => s.currentUser);
  const taskAccess = usePermissionAccess(TASK_ACCESS_PERMISSION_KEYS);
  const { bulkSoftDeleteTasks } = useTaskSoftDelete();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<TaskViewMode>(() => {
    if (typeof window === "undefined") return "cards";
    const saved = window.localStorage.getItem("kub.taskViewMode");
    return saved === "list" || saved === "cards" ? saved : "cards";
  });
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>("all");
  const [locationFilter, setLocationFilter] = useState<LocationFilter>("all");
  const [recipientFilter, setRecipientFilter] = useState<RecipientFilter>("all");
  const [showDeleted, setShowDeleted] = useState(false);
  // Three selects and a checkbox sat open above the list at all times. The view
  // toggle stays out — it is not a filter, it changes how the same set is drawn.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() => new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);
  const [bulkDeleteNotice, setBulkDeleteNotice] = useState<string | null>(null);
  const routing = useTaskRouting({ enabled: Boolean(currentUser), includeMembers: true });
  const myLocationIds = useMemo(
    () => new Set(currentUser?.id ? getUserTaskLocationIds(routing.members, currentUser.id) : []),
    [currentUser?.id, routing.members],
  );
  const myLocationIdList = useMemo(
    () => Array.from(myLocationIds).sort(),
    [myLocationIds],
  );
  const locationTaskAccess = useAnyLocationPermissionAccess(TASK_ACCESS_PERMISSION_KEYS, myLocationIdList, {
    enabled: routing.available && myLocationIdList.length > 0,
  });
  const canViewTasks =
    taskAccess.hasAnyPermission(TASK_VIEW_PERMISSION_KEYS) ||
    locationTaskAccess.hasAnyPermission(TASK_VIEW_PERMISSION_KEYS);
  const canCreateTasks =
    taskAccess.hasAnyPermission(TASK_CREATE_PERMISSION_KEYS) ||
    locationTaskAccess.hasAnyPermission(TASK_CREATE_PERMISSION_KEYS);
  const canViewAllLocations = taskAccess.hasAnyPermission(["system.manage", "tasks.view_all_locations", "tasks.manage_all_locations"]);
  const canViewDeletedTasks = taskAccess.hasAnyPermission(TASK_RESTORE_PERMISSION_KEYS);
  const canBulkDeleteTasks = taskAccess.hasAnyPermission(TASK_BULK_DELETE_PERMISSION_KEYS);
  const canFilterAdminTasks =
    taskAccess.hasAnyPermission(TASK_ADMIN_VIEW_PERMISSION_KEYS) ||
    locationTaskAccess.hasAnyPermission(TASK_ADMIN_VIEW_PERMISSION_KEYS);
  const taskChecking =
    taskAccess.checking ||
    (Boolean(currentUser) && routing.loading && !routing.checked) ||
    locationTaskAccess.checking;

  const tabs = STAFF_TABS;
  const [tabId, setTabId] = useState(tabs[0].id);
  const activeTab = tabs.find((t) => t.id === tabId) ?? tabs[0];

  const baseFilter: TasksFilter = { mine: "all" };
  const { tasks, loading, refetch } = useTasks(baseFilter, { enabled: canViewTasks && !taskChecking });

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

  useEffect(() => {
    window.localStorage.setItem("kub.taskViewMode", viewMode);
  }, [viewMode]);

  const closeTaskModal = () => {
    setOpenTaskId(null);
    if (taskIdFromUrl) setLocation("/tasks", { replace: true });
  };
  const toggleTaskSelection = (taskId: string, checked: boolean) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
    setBulkDeleteNotice(null);
  };
  const toggleVisibleSelection = (checked: boolean) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        for (const id of visibleDeletableTaskIds) next.add(id);
      } else {
        for (const id of visibleDeletableTaskIds) next.delete(id);
      }
      return next;
    });
    setBulkDeleteNotice(null);
  };
  const confirmBulkDelete = async (reason: string | null) => {
    const ids = Array.from(selectedTaskIds);
    if (ids.length === 0) return;
    setBulkDeleteLoading(true);
    setBulkDeleteError(null);
    const result = await bulkSoftDeleteTasks(ids, reason);
    setBulkDeleteLoading(false);
    if (result.error && result.deletedCount === 0) {
      setBulkDeleteError(result.error);
      return;
    }
    setBulkDeleteOpen(false);
    setSelectedTaskIds(new Set());
    setBulkDeleteNotice(
      result.failedCount > 0
        ? `Удалено задач: ${result.deletedCount}. Не удалось удалить: ${result.failedCount}.`
        : `Удалено задач: ${result.deletedCount}.`,
    );
    await refetch();
  };

  const visibleTasks = useMemo(
    () => applyClientFilters(
      tasks,
      activeTab.id,
      search,
      nowMs,
      currentUser?.id ?? null,
      assigneeFilter,
      routing.available ? locationFilter : "all",
      routing.available ? recipientFilter : "all",
      myLocationIds,
      showDeleted && canViewDeletedTasks,
    ),
    [tasks, activeTab.id, search, nowMs, currentUser?.id, assigneeFilter, routing.available, myLocationIds, locationFilter, recipientFilter, showDeleted, canViewDeletedTasks],
  );
  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tab of tabs) {
      counts[tab.id] = applyClientFilters(
        tasks,
        tab.id,
        "",
        nowMs,
        currentUser?.id ?? null,
        assigneeFilter,
        routing.available ? locationFilter : "all",
        routing.available ? recipientFilter : "all",
        myLocationIds,
        showDeleted && canViewDeletedTasks,
      ).length;
    }
    return counts;
  }, [tabs, tasks, nowMs, currentUser?.id, assigneeFilter, routing.available, myLocationIds, locationFilter, recipientFilter, showDeleted, canViewDeletedTasks]);
  const visibleDeletableTaskIds = useMemo(
    () => visibleTasks.filter((task) => !task.deleted_at).map((task) => task.id),
    [visibleTasks],
  );
  const allVisibleSelected =
    visibleDeletableTaskIds.length > 0 &&
    visibleDeletableTaskIds.every((id) => selectedTaskIds.has(id));
  const selectedCount = selectedTaskIds.size;

  useEffect(() => {
    if (canViewDeletedTasks) return;
    setShowDeleted(false);
  }, [canViewDeletedTasks]);

  useEffect(() => {
    if (!canBulkDeleteTasks && selectedTaskIds.size > 0) {
      setSelectedTaskIds(new Set());
      return;
    }
    const allowed = new Set(visibleDeletableTaskIds);
    setSelectedTaskIds((prev) => {
      const next = new Set(Array.from(prev).filter((id) => allowed.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [canBulkDeleteTasks, selectedTaskIds.size, visibleDeletableTaskIds]);

  const assigneeOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const task of tasks) {
      if (!task.assignee_id || !task.assignee) continue;
      map.set(
        task.assignee_id,
        task.assignee.full_name ?? task.assignee.username ?? "Пользователь",
      );
    }
    return Array.from(map, ([id, label]) => ({ id, label })).sort((a, b) =>
      a.label.localeCompare(b.label, "ru-RU"),
    );
  }, [tasks]);

  const activeTaskFilters = useMemo<ActiveFilter[]>(() => {
    const active: ActiveFilter[] = [];
    if (search.trim()) {
      active.push({ id: "search", label: `Поиск: ${search.trim()}`, onRemove: () => setSearch("") });
    }
    if (assigneeFilter !== "all") {
      const named = assigneeOptions.find((option) => option.id === assigneeFilter);
      const label =
        assigneeFilter === "me"
          ? "Я"
          : assigneeFilter === "unassigned"
            ? "Без исполнителя"
            : (named?.label ?? assigneeFilter);
      active.push({ id: "assignee", label: `Исполнитель: ${label}`, onRemove: () => setAssigneeFilter("all") });
    }
    if (locationFilter !== "all") {
      const named = routing.locations.find((location) => location.id === locationFilter);
      const label = locationFilter === "my" ? "Мои локации" : (named?.name ?? locationFilter);
      active.push({ id: "location", label: `Локация: ${label}`, onRemove: () => setLocationFilter("all") });
    }
    if (recipientFilter !== "all") {
      const label = recipientFilter === "staff" ? "Для работников" : "Для админов";
      active.push({ id: "recipient", label: `Получатель: ${label}`, onRemove: () => setRecipientFilter("all") });
    }
    if (showDeleted) {
      active.push({ id: "deleted", label: "Показаны удалённые", onRemove: () => setShowDeleted(false) });
    }
    return active;
  }, [assigneeFilter, assigneeOptions, locationFilter, recipientFilter, routing.locations, search, showDeleted]);

  const resetTaskFilters = () => {
    setSearch("");
    setAssigneeFilter("all");
    setLocationFilter("all");
    setRecipientFilter("all");
    setShowDeleted(false);
  };

  const visibleLocationOptions = useMemo(() => {
    if (!routing.available) return [];
    if (canViewAllLocations) return routing.locations;
    return routing.locations.filter((location) => myLocationIds.has(location.id));
  }, [canViewAllLocations, myLocationIds, routing.available, routing.locations]);

  useEffect(() => {
    if (assigneeFilter === "all" || assigneeFilter === "me" || assigneeFilter === "unassigned") return;
    if (!assigneeOptions.some((option) => option.id === assigneeFilter)) setAssigneeFilter("all");
  }, [assigneeFilter, assigneeOptions]);

  useEffect(() => {
    if (locationFilter === "all" || locationFilter === "my") return;
    if (!visibleLocationOptions.some((option) => option.id === locationFilter)) setLocationFilter("all");
  }, [locationFilter, visibleLocationOptions]);

  useEffect(() => {
    if (recipientFilter === "admin" && !canFilterAdminTasks) setRecipientFilter("all");
  }, [canFilterAdminTasks, recipientFilter]);

  // The "Все" tab is intentionally unbounded inside the RLS-visible task set.
  // when the visible list is large.
  const summary = useMemo(() => {
    if (loading) return "";
    return `${visibleTasks.length} ${pluralizeTasks(visibleTasks.length)}`;
  }, [visibleTasks.length, loading]);

  if (!currentUser) return null;

  if (taskChecking) {
    return (
      <div className="flex flex-col h-[100dvh]">
        <KubHeader
          title="Задачи"
          subtitle="Проверяем права доступа"
          leading={
            <button
              type="button"
              onClick={() => setLocation("/")}
              className="kub-icon-action kub-interactive rounded-lg kub-raise-hover text-[color:var(--kub-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]"
              aria-label="Назад"
            >
              <KubIcon name="back" size={18} />
            </button>
          }
        />
        <div className="flex flex-1 items-center justify-center">
          <KubIcon name="spinner" size={24} tone="accent" label="Загрузка" />
        </div>
      </div>
    );
  }

  if (!canViewTasks) {
    return (
      <div className="flex flex-col h-[100dvh]">
        <KubHeader
          title="Задачи"
          subtitle="Раздел доступен по ролям и правам"
          leading={
            <button
              type="button"
              onClick={() => setLocation("/")}
              className="kub-icon-action kub-interactive rounded-lg kub-raise-hover text-[color:var(--kub-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]"
              aria-label="Назад"
            >
              <KubIcon name="back" size={18} />
            </button>
          }
        />
        <div className="flex flex-1 items-center justify-center px-4">
          <KubEmptyState
            icon={<KubIcon name="shield" size={28} />}
            title="Раздел задач доступен только сотрудникам локации"
            description="Если вам нужен доступ к задачам, обратитесь к администратору локации."
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

  // No background on the page root, in any of its three states. Unlike the bots
  // page — where the fill only ever showed as a strip behind the header — this
  // one really was the ground the task list stood on, because the scroller
  // carries no fill of its own. That is the point: every row brings its own
  // surface (`kub-panel` in card mode, --kub-surface in list mode), so the list
  // lies on the ambient exactly the way the message feed does, and the header
  // above it gets something other than one flat colour to blur.
  //
  // The tab strip and the filter toolbar below the header are chrome, so they
  // are the panel material. The class goes on the elements themselves: the four
  // modals are siblings of both bars at the page root, so no backdrop-filter
  // here can become the containing block of anything fixed.
  return (
    <div className="flex flex-col h-[100dvh]">
      <KubHeader
        title="Задачи"
        subtitle={canCreateTasks ? "Управление задачами локации" : "Ваши задачи"}
        leading={
          <button
            type="button"
            onClick={() => setLocation("/")}
            className="kub-icon-action kub-interactive rounded-lg kub-raise-hover text-[color:var(--kub-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]"
            aria-label="Назад"
          >
            <KubIcon name="back" size={18} />
          </button>
        }
        trailing={
          canCreateTasks ? (
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
      <div className="kub-glass flex-shrink-0 border-b border-[color:var(--kub-border-color)] overflow-x-auto">
        <div className="flex items-stretch gap-1 px-3">
          {tabs.map((t) => {
            const active = t.id === tabId;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTabId(t.id)}
                className={cn(
                  "kub-button kub-interactive relative px-4 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]",
                  active
                    ? "text-[color:var(--kub-accent-text)]"
                    : "text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)]",
                )}
              >
                {t.label}
                {tabCounts[t.id] > 0 && (
                  <span
                    className={cn(
                      "ml-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] leading-none",
                      t.id === "urgent"
                        ? "bg-[color-mix(in_srgb,var(--kub-danger)_18%,transparent)] text-[color:var(--kub-danger-text)]"
                        : t.id === "review"
                          ? "bg-[color-mix(in_srgb,var(--kub-warn)_18%,transparent)] text-[color:var(--kub-warn)]"
                          : t.id === "available"
                            ? "bg-[color-mix(in_srgb,var(--kub-online)_12%,transparent)] text-[color:var(--kub-online-text)]"
                            : "kub-raise text-[color:var(--kub-muted)]",
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

      <div className="kub-glass flex-shrink-0 border-b border-[color:var(--kub-border-color)] px-3 sm:px-5 py-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
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
                  className="shrink-0 rounded-md p-1 text-[color:var(--kub-muted)] kub-raise-hover hover:text-[color:var(--kub-text)]"
                  aria-label="Очистить поиск задач"
                >
                  <KubIcon name="close" size={14} />
                </button>
              ) : null
            }
            containerClassName="lg:max-w-xl"
          />

          <div className="flex min-w-0 w-full flex-wrap items-center gap-2 lg:w-auto">
            <KubFilterButton
              count={activeTaskFilters.length}
              open={filtersOpen}
              onToggle={() => setFiltersOpen((open) => !open)}
              className="h-9"
            />

            <div className={cn("flex min-w-0 flex-wrap items-center gap-2", !filtersOpen && "hidden")}>
            <label className="sr-only" htmlFor="task-assignee-filter">Исполнитель</label>
            <select
              id="task-assignee-filter"
              value={assigneeFilter}
              onChange={(event) => setAssigneeFilter(event.target.value)}
              className="h-9 min-w-0 w-full max-w-full rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-inset)] px-2.5 text-xs font-medium text-[color:var(--kub-text)] sm:w-auto sm:max-w-[220px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
              style={{ width: "min(100%, 220px)", maxWidth: "100%", minWidth: 0 }}
            >
              <option value="all">Все исполнители</option>
              <option value="me">Я</option>
              <option value="unassigned">Без исполнителя</option>
              {assigneeOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>

            {routing.available && (
              <>
                <label className="sr-only" htmlFor="task-location-filter">Локация</label>
                <select
                  id="task-location-filter"
                  value={locationFilter}
                  onChange={(event) => setLocationFilter(event.target.value)}
                  className="h-9 min-w-0 w-full max-w-full rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-inset)] px-2.5 text-xs font-medium text-[color:var(--kub-text)] sm:w-auto sm:max-w-[220px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
                  style={{ width: "min(100%, 220px)", maxWidth: "100%", minWidth: 0 }}
                >
                  <option value="all">Все доступные локации</option>
                  <option value="my">Мои локации</option>
                  {visibleLocationOptions.map((location) => (
                    <option key={location.id} value={location.id}>{location.name}</option>
                  ))}
                </select>

                <label className="sr-only" htmlFor="task-recipient-filter">Получатель</label>
                <select
                  id="task-recipient-filter"
                  value={recipientFilter}
                  onChange={(event) => setRecipientFilter(event.target.value as RecipientFilter)}
                  className="h-9 min-w-0 w-full max-w-full rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-inset)] px-2.5 text-xs font-medium text-[color:var(--kub-text)] sm:w-auto sm:max-w-[220px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
                  style={{ width: "min(100%, 220px)", maxWidth: "100%", minWidth: 0 }}
                >
                  <option value="all">Все получатели</option>
                  <option value="staff">Для работников</option>
                  {canFilterAdminTasks && <option value="admin">Для админов</option>}
                </select>
              </>
            )}

            {canViewDeletedTasks && (
              <label className="inline-flex h-9 max-w-full items-center gap-2 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-inset)] px-2.5 text-xs font-medium text-[color:var(--kub-text)]">
                <input
                  type="checkbox"
                  checked={showDeleted}
                  onChange={(event) => setShowDeleted(event.target.checked)}
                  className="h-4 w-4 rounded border-[color:var(--kub-border-color)] accent-[var(--kub-cyan)]"
                />
                <span className="truncate">Показать удалённые</span>
              </label>
            )}
            </div>

            {/* The designed height is a floor, not a clamp. Its segments carry
                `kub-button focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]`, so a coarse pointer grows them to the 44px a finger
                needs (D-015); a fixed `h-9` track could not contain that and the
                active segment's pill broke 11px out through the bottom border.
                Same mistake `KubSwitch` documents — a fixed decorative size
                sitting on the element that has to grow — and the same fix: the
                track keeps its 36px on a cursor and follows its segments on a
                finger. See D-013. */}
            <div className="inline-flex min-h-9 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-inset)] p-0.5">
              <button
                type="button"
                onClick={() => setViewMode("cards")}
                className={cn(
                  "kub-button kub-interactive inline-flex items-center gap-1 rounded-md px-2.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]",
                  viewMode === "cards"
                    ? "kub-raise text-[color:var(--kub-accent-text)]"
                    : "text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)]",
                )}
                aria-pressed={viewMode === "cards"}
              >
                <KubIcon name="tasks" size={13} />
                Карточки
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={cn(
                  "kub-button kub-interactive inline-flex items-center gap-1 rounded-md px-2.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]",
                  viewMode === "list"
                    ? "kub-raise text-[color:var(--kub-accent-text)]"
                    : "text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)]",
                )}
                aria-pressed={viewMode === "list"}
              >
                <KubIcon name="menu" size={13} />
                Список
              </button>
            </div>
          </div>
        </div>

        {/* Every filter here runs on the loaded set, so the count is exact and
            the line needs no note about pages. */}
        <KubFilterSummary
          matched={visibleTasks.length}
          total={tasks.length}
          filters={activeTaskFilters}
          onReset={resetTaskFilters}
          noun="задач"
          className="mt-2"
        />

        {canBulkDeleteTasks && visibleDeletableTaskIds.length > 0 && (
          <div className="mt-3 rounded-2xl border border-[color:var(--kub-border-color)] bg-[color-mix(in_srgb,var(--kub-cyan)_10%,transparent)] px-3 py-2.5 text-xs shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <BulkSelectControl
                  checked={allVisibleSelected}
                  onChange={toggleVisibleSelection}
                  label="Выбрать видимые задачи"
                  className="h-7 w-7 rounded-lg"
                />
                <div className="min-w-0">
                  <div className="font-semibold text-[color:var(--kub-text)]">
                    {selectedCount > 0 ? `Выбрано: ${selectedCount}` : "Пакетный выбор"}
                  </div>
                  <div className="truncate text-[11px] text-[color:var(--kub-muted)]">
                    Выберите видимые задачи для удаления без перезагрузки списка.
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <KubButton variant="secondary" size="sm" onClick={() => toggleVisibleSelection(!allVisibleSelected)}>
                  {allVisibleSelected ? "Снять видимые" : "Выбрать видимые"}
                </KubButton>
                {selectedCount > 0 && (
                  <KubButton variant="secondary" size="sm" onClick={() => setSelectedTaskIds(new Set())}>
                    Очистить
                  </KubButton>
                )}
                {selectedCount > 0 && (
                  <KubButton
                    variant="danger"
                    size="sm"
                    leftIcon={<KubIcon name="delete" size={13} />}
                    onClick={() => {
                      setBulkDeleteError(null);
                      setBulkDeleteOpen(true);
                    }}
                  >
                    Удалить выбранные
                  </KubButton>
                )}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {bulkDeleteNotice && (
                <span className="text-[color:var(--kub-online-text)]">{bulkDeleteNotice}</span>
              )}
            </div>
          </div>
        )}
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
            description={getEmptyDescription(activeTab.id, canCreateTasks)}
            action={
              canCreateTasks && (
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
          viewMode === "list" ? (
            <div className="space-y-2">
              {visibleTasks.map((t) => {
                const canSelect = canBulkDeleteTasks && !t.deleted_at;
                const selected = selectedTaskIds.has(t.id);
                return (
                  <TaskListRow
                    key={t.id}
                    task={t}
                    nowMs={nowMs}
                    selected={selected}
                    selectionControl={canSelect ? (
                      <BulkSelectControl
                        checked={selected}
                        onChange={(checked) => toggleTaskSelection(t.id, checked)}
                        label={`Выбрать задачу: ${t.title}`}
                      />
                    ) : null}
                    onClick={() => setOpenTaskId(t.id)}
                  />
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-4 gap-3">
              {visibleTasks.map((t) => {
                const canSelect = canBulkDeleteTasks && !t.deleted_at;
                const selected = selectedTaskIds.has(t.id);
                return (
                  <TaskCard
                    key={t.id}
                    task={t}
                    nowMs={nowMs}
                    selected={selected}
                    selectionControl={canSelect ? (
                      <BulkSelectControl
                        checked={selected}
                        onChange={(checked) => toggleTaskSelection(t.id, checked)}
                        label={`Выбрать задачу: ${t.title}`}
                      />
                    ) : null}
                    onClick={() => setOpenTaskId(t.id)}
                  />
                );
              })}
            </div>
          )
        )}
        {!loading && visibleTasks.length > 0 && (
          <div className="mt-4 text-center text-[11px] uppercase tracking-wide text-[color:var(--kub-muted)]">
            {summary}
          </div>
        )}
      </div>

      {openTaskId && (
        <TaskDetailModal
          taskId={openTaskId}
          nowMs={nowMs}
          onClose={closeTaskModal}
          onDeleted={() => { void refetch(); }}
        />
      )}
      {showCreate && (
        <TaskFormModal
          onClose={() => setShowCreate(false)}
          onDone={(id) => { setShowCreate(false); setOpenTaskId(id); }}
        />
      )}
      {bulkDeleteOpen && (
        <TaskDeleteModal
          open
          count={selectedCount}
          loading={bulkDeleteLoading}
          error={bulkDeleteError}
          onClose={() => {
            if (!bulkDeleteLoading) setBulkDeleteOpen(false);
          }}
          onConfirm={(reason) => void confirmBulkDelete(reason)}
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

function getEmptyDescription(tabId: string, canCreateTasks: boolean): string {
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
      return canCreateTasks
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
  assigneeFilter: AssigneeFilter,
  locationFilter: LocationFilter,
  recipientFilter: RecipientFilter,
  myLocationIds: Set<string>,
  showDeleted: boolean,
): TaskWithPeople[] {
  const query = normalizeSearch(search);
  return tasks.filter((task) => {
    if (!showDeleted && task.deleted_at) return false;
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
    if (assigneeFilter === "me" && task.assignee_id !== userId) return false;
    if (assigneeFilter === "unassigned" && task.assignee_id !== null) return false;
    if (assigneeFilter !== "all" && assigneeFilter !== "me" && assigneeFilter !== "unassigned" && task.assignee_id !== assigneeFilter) {
      return false;
    }
    if (locationFilter !== "all") {
      const taskLocationId = task.location_id ?? null;
      if (locationFilter === "my") {
        if (!taskLocationId || !myLocationIds.has(taskLocationId)) return false;
      } else if (taskLocationId !== locationFilter) {
        return false;
      }
    }
    if (recipientFilter === "admin" && !isAdminRoutedTask(task)) return false;
    if (recipientFilter === "staff" && !isStaffRoutedTask(task)) return false;
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

function isAdminRoutedTask(task: TaskWithPeople): boolean {
  return Boolean(
    task.created_for_admin ||
    task.target_role === "admin" ||
    task.target_role === "manager" ||
    task.target_role === "owner",
  );
}

function isStaffRoutedTask(task: TaskWithPeople): boolean {
  return Boolean(
    !task.created_for_admin &&
    (task.target_role === "staff" || task.assignment_scope === "staff_pool"),
  );
}
