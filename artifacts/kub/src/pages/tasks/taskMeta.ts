import type {
  TaskAssignmentScope,
  TaskEventKind,
  TaskPriority,
  TaskStatus,
  Task,
  TaskVisibility,
} from "@/types/database";

type Tone = "cyan" | "pink" | "muted" | "online" | "danger" | "warn";

interface StatusMeta {
  label: string;
  tone: Tone;
}
interface PriorityMeta {
  label: string;
  tone: Tone;
}
interface VisibilityMeta {
  label: string;
  tone: Tone;
}
interface AssignmentScopeMeta {
  label: string;
  tone: Tone;
}

export const TASK_STATUS_META: Record<TaskStatus, StatusMeta> = {
  new:                  { label: "Новая",            tone: "muted"  },
  assigned:             { label: "Назначена",        tone: "cyan"   },
  accepted:             { label: "Принята",          tone: "cyan"   },
  in_progress:          { label: "В работе",         tone: "pink"   },
  waiting_confirmation: { label: "На подтверждении", tone: "warn"   },
  confirmed:            { label: "Подтверждена",     tone: "online" },
  rejected:             { label: "Отклонена",        tone: "danger" },
  cancelled:            { label: "Отменена",         tone: "muted"  },
};

export const TASK_PRIORITY_META: Record<TaskPriority, PriorityMeta> = {
  low:    { label: "Низкий",   tone: "muted"  },
  normal: { label: "Обычный",  tone: "cyan"   },
  high:   { label: "Высокий",  tone: "warn"   },
  urgent: { label: "Срочный",  tone: "danger" },
};

export const TASK_VISIBILITY_META: Record<TaskVisibility, VisibilityMeta> = {
  staff:   { label: "Для сотрудников", tone: "cyan"  },
  private: { label: "Приватная",       tone: "pink"  },
  chat:    { label: "Чат",             tone: "muted" },
};

export const TASK_ASSIGNMENT_SCOPE_META: Record<TaskAssignmentScope, AssignmentScopeMeta> = {
  user:         { label: "Назначена пользователю", tone: "muted" },
  manager_pool: { label: "Пул менеджеров",         tone: "warn"  },
  staff_pool:   { label: "Пул сотрудников",        tone: "cyan"  },
};

export const TASK_EVENT_LABEL: Record<TaskEventKind, string> = {
  create:                "создал(а) задачу",
  assign:                "назначил(а) исполнителя",
  accept:                "принял(а) задачу",
  start:                 "взял(а) в работу",
  send_for_confirmation: "отправил(а) на подтверждение",
  confirm:               "подтвердил(а) выполнение",
  reject:                "отклонил(а) выполнение",
  cancel:                "отменил(а) задачу",
  comment:               "оставил(а) комментарий",
  update:                "изменил(а) задачу",
  return_to_work:        "вернул(а) задачу в работу",
};

export const PRIORITIES: TaskPriority[] = ["low", "normal", "high", "urgent"];

const ACTIVE_DEADLINE_STATUSES: TaskStatus[] = [
  "new",
  "assigned",
  "accepted",
  "in_progress",
  "waiting_confirmation",
];

const DEADLINE_SOON_MS = 3 * 60 * 60 * 1000;
const DEADLINE_ALMOST_MS = 15 * 60 * 1000;

export interface TaskDeadlineState {
  hasDueDate: boolean;
  isActive: boolean;
  isOverdue: boolean;
  isDueSoon: boolean;
  timeLabel: string;
  detailLabel: string;
  badgeLabel: string | null;
  urgencyRatio: number | null;
  fillPercent: number | null;
  urgencyLevel: "none" | "safe" | "lime" | "orange" | "red" | "danger";
  tone: Tone;
}

/**
 * This bar shows remaining deadline time, not task completion progress.
 * More time means a longer calm bar; close deadlines become shorter and warmer.
 */
export function getTaskDeadlineState(
  task: Pick<Task, "due_at" | "status">,
  nowMs: number = Date.now(),
): TaskDeadlineState {
  if (!task.due_at) {
    return {
      hasDueDate: false,
      isActive: false,
      isOverdue: false,
      isDueSoon: false,
      timeLabel: "Без срока",
      detailLabel: "Для задачи не задан срок выполнения.",
      badgeLabel: null,
      urgencyRatio: null,
      fillPercent: null,
      urgencyLevel: "none",
      tone: "muted",
    };
  }

  const dueMs = new Date(task.due_at).getTime();
  const isActive = ACTIVE_DEADLINE_STATUSES.includes(task.status) && Number.isFinite(dueMs);
  if (!isActive) {
    const completedLabel =
      task.status === "cancelled"
        ? "Отменена"
        : task.status === "rejected"
          ? "Отклонена"
          : "Завершена";
    return {
      hasDueDate: true,
      isActive: false,
      isOverdue: false,
      isDueSoon: false,
      timeLabel: completedLabel,
      detailLabel: `${completedLabel}. Дедлайн больше не требует срочного действия.`,
      badgeLabel: null,
      urgencyRatio: null,
      fillPercent: null,
      urgencyLevel: "none",
      tone: "muted",
    };
  }

  const remainingMs = dueMs - nowMs;
  const isOverdue = remainingMs < 0;
  const isDueSoon =
    !isOverdue &&
    remainingMs <= DEADLINE_SOON_MS &&
    (task.status === "new" || task.status === "assigned");
  const isAlmostDue =
    !isOverdue &&
    remainingMs <= DEADLINE_ALMOST_MS &&
    (task.status === "new" || task.status === "assigned");
  const { level: urgencyLevel, fillPercent } = getDeadlineVisual(remainingMs, isOverdue);
  const urgencyRatio = fillPercent === null ? null : fillPercent / 100;
  const tone: Tone =
    urgencyLevel === "danger" || urgencyLevel === "red"
      ? "danger"
      : urgencyLevel === "orange" || urgencyLevel === "lime"
        ? "warn"
        : "online";

  if (isOverdue) {
    const overdue = formatDuration(Math.abs(remainingMs));
    return {
      hasDueDate: true,
      isActive: true,
      isOverdue: true,
      isDueSoon: false,
      timeLabel: `Просрочено на ${overdue}`,
      detailLabel: `Задача просрочена на ${overdue}.`,
      badgeLabel: "Просрочена",
      urgencyRatio,
      fillPercent,
      urgencyLevel,
      tone,
    };
  }

  const left = formatDuration(remainingMs);
  return {
    hasDueDate: true,
    isActive: true,
    isOverdue: false,
    isDueSoon,
    timeLabel: `Осталось: ${left}`,
    detailLabel: `До срока осталось ${left}.`,
    badgeLabel: isAlmostDue ? "Почти просрочена" : null,
    urgencyRatio,
    fillPercent,
    urgencyLevel,
    tone,
  };
}

export function formatTaskDueDate(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Human-friendly Russian relative date used inside cards/event log. */
export function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = Math.round((d.getTime() - now) / 1000); // seconds, signed
  const abs = Math.abs(diff);
  const fmt = (n: number, unit: string) => `${n} ${unit}`;
  if (abs < 60) return diff < 0 ? "только что" : "через несколько секунд";
  const m = Math.round(abs / 60);
  if (abs < 3600) return diff < 0 ? `${fmt(m, "мин назад")}` : `через ${fmt(m, "мин")}`;
  const h = Math.round(abs / 3600);
  if (abs < 86400) return diff < 0 ? `${fmt(h, "ч назад")}` : `через ${fmt(h, "ч")}`;
  const days = Math.round(abs / 86400);
  if (abs < 7 * 86400) return diff < 0 ? `${fmt(days, "дн назад")}` : `через ${fmt(days, "дн")}`;
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  if (totalMinutes < 1) return "меньше минуты";
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}д ${hours}ч`;
  if (hours > 0) return `${hours}ч ${minutes}м`;
  return `${minutes}м`;
}

function getDeadlineVisual(
  remainingMs: number,
  isOverdue: boolean,
): { level: TaskDeadlineState["urgencyLevel"]; fillPercent: number } {
  const hour = 60 * 60 * 1000;
  const minute = 60 * 1000;
  if (isOverdue) return { level: "danger", fillPercent: 100 };
  if (remainingMs < 15 * minute) return { level: "danger", fillPercent: 8 };
  if (remainingMs < hour) return { level: "red", fillPercent: 16 };
  if (remainingMs < 3 * hour) return { level: "red", fillPercent: 30 };
  if (remainingMs < 12 * hour) return { level: "orange", fillPercent: 55 };
  if (remainingMs < 24 * hour) return { level: "lime", fillPercent: 75 };
  return { level: "safe", fillPercent: 100 };
}
